import prisma from "../db.server.js";
import {
  embedText,
  buildRequestText,
  hasEmbeddingKey,
} from "./embeddings.server.js";
import { normalizeRequestTerms } from "./jewelryTerms.js";
import { reasonMatches, verifyBatch, confidenceToScore } from "./reasoningMatch.server.js";
import { isOverBudget, budgetCeiling } from "./budget.js";
import { applyDynamicCap, RETRIEVAL_CEILING } from "./retrievalConfig.js";

// Retrieval candidate count is DYNAMIC — see ./retrievalConfig.js (similarity
// threshold + floor + ceiling). Tiered budget tolerance lives in ./budget.js.

// NOTE: the keep-watching webhook path no longer lives here. products/create|
// update events are queued (instant 200 to Shopify) and processed in batches
// by app/lib/productQueue.server.js — see drainProductQueue.

// Embed (and lazily persist) a request's query vector from its description.
export async function getRequestEmbedding(request) {
  if (Array.isArray(request.embedding) && request.embedding.length) {
    return request.embedding;
  }
  if (!hasEmbeddingKey()) return null;
  const text = buildRequestText(request);
  if (!text.trim()) return null;
  const vec = await embedText(text, "query").catch(() => null);
  if (vec) {
    await prisma.request
      .update({ where: { id: request.id }, data: { embedding: vec } })
      .catch(() => {});
  }
  return vec;
}

function upsertMatch(shop, request, p, fields) {
  return prisma.match.upsert({
    where: { requestId_productId: { requestId: request.id, productId: p.productId } },
    update: {
      score: fields.score,
      confidence: fields.confidence,
      reasoning: fields.reason,
      needsReview: fields.needsReview,
      overBudget: fields.overBudget ?? false,
      productTitle: p.title,
      productPrice: p.price,
      productImage: p.image,
    },
    create: {
      shop,
      requestId: request.id,
      productId: p.productId,
      productTitle: p.title,
      productPrice: p.price,
      productImage: p.image,
      score: fields.score,
      confidence: fields.confidence,
      reasoning: fields.reason,
      needsReview: fields.needsReview,
      overBudget: fields.overBudget ?? false,
      matchedKeywords: [],
      declined: false,
    },
  });
}

/**
 * Create-flow matching: light budget filter → semantic top-K retrieval over the
 * stored (active) catalog → AI reasoning pass. High-confidence matches show
 * directly; medium/low go to the review queue. Sends NO email — matches are
 * announced only by the scheduled digest (/api/digest).
 */
export async function runMatchesForRequest(_admin, request) {
  const reqVec = await getRequestEmbedding(request);
  if (!reqVec) {
    // No query embedding. If we HAVE a key, this is a failure (embedding service
    // down) worth retrying; otherwise it's just an unconfigured no-op.
    if (hasEmbeddingKey()) await setMatchState(request.id, "error", "could not embed request");
    return 0;
  }

  try {
    return await runMatchesInner(request, reqVec);
  } catch (err) {
    console.error("[matchRunner] matching failed for request", request.id, err?.message || err);
    await setMatchState(request.id, "error", String(err?.message || err));
    return 0;
  }
}

// Records the outcome of a matching pass so the UI can distinguish a transient
// failure ("error", offer Retry) from a genuine empty result ("ok", watching).
async function setMatchState(requestId, state, error = null) {
  await prisma.request
    .update({
      where: { id: requestId },
      data: {
        matchState: state,
        matchError: error ? String(error).slice(0, 500) : null,
        ...(state === "ok" ? { matchedAt: new Date() } : {}),
      },
    })
    .catch(() => {});
}

async function runMatchesInner(request, reqVec) {
  const declined = await prisma.match.findMany({
    where: { requestId: request.id, declined: true },
    select: { productId: true },
  });
  const declinedIds = new Set(declined.map((m) => m.productId));

  // Steps 1+2 — HARD FILTER the full catalog (in-stock only + budget), order by
  // cosine similarity, and fetch the top CEILING rows INSIDE Postgres via
  // pgvector. Filtering happens before any cap, so the cap only ever applies to
  // relevant, in-stock, in-budget items (never wasted on junk). This also avoids
  // shipping the whole embedding table (~43 MB) out of Neon per request.
  const ceiling = request.budget ? budgetCeiling(request.budget) : null;
  const vecLiteral = `[${reqVec.join(",")}]`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "productId", title, description, price, image,
            1 - (vec <=> $2::vector) AS sim
       FROM "ProductEmbedding"
      WHERE shop = $1 AND vec IS NOT NULL
        AND "inStock" = true
        AND ($3::float8 IS NULL OR price IS NULL OR price <= $3::float8)
      ORDER BY vec <=> $2::vector
      LIMIT $4`,
    request.shop,
    vecLiteral,
    ceiling,
    RETRIEVAL_CEILING + declinedIds.size,
  );
  // DYNAMIC CAP: keep everything above the similarity threshold, but at least
  // FLOOR and at most CEILING (see retrievalConfig.js). Narrow queries → a small
  // tight set; broad queries → many, up to the ceiling.
  const pool = applyDynamicCap(rows.filter((r) => !declinedIds.has(r.productId)));

  // Step 3 — AI reasoning pass. Jeweler terms in the request (DIA, WG, GS,
  // "diamond by the yard", …) are normalized so the AI gates on the same
  // canonical words the embedding was built from. Refinement notes are passed
  // separately so the AI can interpret their intent (add / relax / prefer).
  const reasoningText = normalizeRequestTerms(request.description || "");
  const notesText = normalizeRequestTerms(request.matchNotes || "");
  const candidates = pool.map((p) => ({
    productId: p.productId,
    title: p.title,
    description: p.description,
    price: p.price,
  }));
  // Reasoning pass proposes matches (1 Sonnet call). Budget is NOT passed — it's
  // a soft ranking factor handled here, never an AI gate.
  let matches = await reasonMatches({
    description: reasoningText,
    notes: notesText,
    budget: null,
    candidates,
  });

  // Batched double-check: ONE Sonnet call re-verifies ALL proposed matches with
  // strict attribute+setting gating (replaces the per-match fan-out of 2×M calls).
  if (matches.length > 0) {
    const cById = new Map(candidates.map((c) => [c.productId, c]));
    const pass = await verifyBatch({
      description: reasoningText,
      notes: notesText,
      candidates: matches.map((m) => cById.get(m.productId)).filter(Boolean),
    });
    matches = matches.filter((m) => pass.has(m.productId));
  }

  // NOTE: zero matches is a valid outcome. We intentionally do NOT surface the
  // closest wrong-attribute items — an absolute gate (metal color, origin,
  // setting, item type, brand) must never be relaxed to avoid an empty result.
  // The request stays active and the keep-watching job matches later inventory.

  const byId = new Map(pool.map((r) => [r.productId, r]));
  const ops = [];
  const keptIds = new Set();
  for (const m of matches) {
    const p = byId.get(m.productId);
    if (!p) continue;
    keptIds.add(m.productId);
    const overBudget = isOverBudget(request.budget, p.price);
    const needsReview = m.confidence !== "high";
    ops.push(
      upsertMatch(request.shop, request, p, {
        score: confidenceToScore(m.confidence),
        confidence: m.confidence,
        reason: m.reason,
        needsReview,
        overBudget,
      }),
    );
  }
  await Promise.all(ops);

  // Reconcile: re-running (e.g. after a refinement note narrowed the request)
  // must REMOVE previously-surfaced matches that no longer qualify. Delete this
  // request's non-declined matches that aren't in the new set. (Declined stay
  // declined so a rejected item never resurfaces.)
  await prisma.match.deleteMany({
    where: {
      requestId: request.id,
      declined: false,
      productId: { notIn: keptIds.size ? [...keptIds] : ["__none__"] },
    },
  });

  // Matching completed successfully — even if zero matches (a genuine "watching"
  // state, NOT an error).
  await setMatchState(request.id, "ok");

  // NO email here. Matches surface in-app/POS immediately; the ONLY routine
  // email is the scheduled digest (/api/digest, see app/lib/digestConfig.js).

  return ops.length;
}


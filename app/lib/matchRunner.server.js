import prisma from "../db.server.js";
import {
  embedText,
  buildRequestText,
  hasEmbeddingKey,
} from "./embeddings.server.js";
import { reasonMatches, verifyBatch, confidenceToScore } from "./reasoningMatch.server.js";
import { isOverBudget, budgetCeiling } from "./budget.js";
import { bumpCounter } from "./aiBudget.server.js";
import { sendMatchSummaryEmail } from "./email.server.js";

// --- Tunables -------------------------------------------------------------
const TOP_K = 50; // candidates sent to the AI reasoning pass

// Tiered budget tolerance (editable config lives in ./budget.js).

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
 * stored (active) catalog → AI reasoning pass. High-confidence matches email the
 * salesperson; medium/low go to the review queue. Never returns an empty screen
 * when stock exists.
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

  // Steps 1+2 — semantic retrieval + budget filter run INSIDE Postgres via
  // pgvector, returning only the top-K rows. This avoids shipping the entire
  // embedding table (~43 MB) out of Neon on every request.
  const ceiling = request.budget ? budgetCeiling(request.budget) : null;
  const vecLiteral = `[${reqVec.join(",")}]`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "productId", title, description, price, image
       FROM "ProductEmbedding"
      WHERE shop = $1 AND vec IS NOT NULL
        AND ($3::float8 IS NULL OR price IS NULL OR price <= $3::float8)
      ORDER BY vec <=> $2::vector
      LIMIT $4`,
    request.shop,
    vecLiteral,
    ceiling,
    TOP_K + declinedIds.size,
  );
  const pool = rows.filter((r) => !declinedIds.has(r.productId)).slice(0, TOP_K);

  // Step 3 — AI reasoning pass.
  const candidates = pool.map((p) => ({
    productId: p.productId,
    title: p.title,
    description: p.description,
    price: p.price,
  }));
  // Reasoning pass proposes matches (1 Sonnet call). Budget is NOT passed — it's
  // a soft ranking factor handled here, never an AI gate.
  let matches = await reasonMatches({
    description: request.description || "",
    budget: null,
    candidates,
  });

  // Batched double-check: ONE Sonnet call re-verifies ALL proposed matches with
  // strict attribute+setting gating (replaces the per-match fan-out of 2×M calls).
  if (matches.length > 0) {
    const cById = new Map(candidates.map((c) => [c.productId, c]));
    const pass = await verifyBatch({
      description: request.description || "",
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
  const notify = [];
  for (const m of matches) {
    const p = byId.get(m.productId);
    if (!p) continue;
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
    // Over-budget items appear in-app (ranked below, labeled) but do not trigger
    // an auto-notify email.
    if (!needsReview && !overBudget) {
      notify.push({
        productTitle: p.title,
        productPrice: p.price,
        productImage: p.image,
        score: confidenceToScore(m.confidence),
        matchedKeywords: [],
        reason: m.reason,
      });
    }
  }
  await Promise.all(ops);
  // Matching completed successfully — even if zero matches (a genuine "watching"
  // state, NOT an error).
  await setMatchState(request.id, "ok");

  if (notify.length > 0 && process.env.RESEND_API_KEY) {
    sendMatchSummaryEmail({
      salespersonName: request.salespersonName,
      salespersonEmail: request.salespersonEmail,
      customerName: request.customerName,
      budget: request.budget,
      matches: notify,
      shop: request.shop,
    })
      .then(async () => {
        // Send-record: a match is emailed at most once, ever.
        const now = new Date();
        await prisma.match
          .updateMany({
            where: { requestId: request.id, notifiedAt: null, needsReview: false, overBudget: false },
            data: { notifiedAt: now },
          })
          .catch(() => {});
        await prisma.request
          .update({
            where: { id: request.id },
            data: { lastReminderAt: now, lastMatchEmailAt: now },
          })
          .catch(() => {});
        await bumpCounter("match_emails").catch(() => {});
      })
      .catch((err) => console.error("[email] summary send failed:", err));
  }

  return ops.length;
}


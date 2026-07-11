import prisma from "../db.server.js";
import { cosineSimilarity } from "./matching.js";
import {
  embedText,
  buildRequestText,
  buildProductText,
  textHash,
  hasEmbeddingKey,
} from "./embeddings.server.js";
import { reasonMatches, verifyBatch, confidenceToScore } from "./reasoningMatch.server.js";
import { withinBudget, isOverBudget, budgetCeiling } from "./budget.js";
import { sendMatchSummaryEmail, sendNewProductMatchEmail } from "./email.server.js";

// --- Tunables -------------------------------------------------------------
const TOP_K = 50; // candidates sent to the AI reasoning pass
const RETRIEVAL_GATE = 0.35; // webhook: min cosine for a new product to be judged for a request

// Tiered budget tolerance (editable config lives in ./budget.js).


// Embed (and lazily persist) a request's query vector from its description.
async function getRequestEmbedding(request) {
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
  if (!reqVec) return 0; // no query embedding → cannot retrieve semantically

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

  if (notify.length > 0 && process.env.RESEND_API_KEY) {
    sendMatchSummaryEmail({
      salespersonName: request.salespersonName,
      salespersonEmail: request.salespersonEmail,
      customerName: request.customerName,
      budget: request.budget,
      matches: notify,
      shop: request.shop,
    })
      .then(() =>
        prisma.request
          .update({ where: { id: request.id }, data: { lastReminderAt: new Date() } })
          .catch(() => {}),
      )
      .catch((err) => console.error("[email] summary send failed:", err));
  }

  return ops.length;
}

/**
 * Keep-watching: a product was created/updated. Embed + store it, then run it
 * against active requests (cosine gate → AI reasoning). New high-confidence
 * pairings email the salesperson; medium/low go to the review queue. Dedupes:
 * a request/product pair already evaluated is never re-alerted.
 */
export async function matchProductAgainstRequests(shop, product) {
  // Inactive/archived/deleted → remove its embedding and non-declined matches.
  if (!product || product.active === false) {
    await prisma.match.deleteMany({ where: { shop, productId: product.id, declined: false } });
    await prisma.productEmbedding.deleteMany({ where: { productId: product.id } }).catch(() => {});
    return 0;
  }

  if (!hasEmbeddingKey()) return 0;

  // Embed + persist the product (skip re-embed when unchanged).
  const text = buildProductText(product);
  const hash = textHash(text);
  const existingEmb = await prisma.productEmbedding.findUnique({
    where: { productId: product.id },
    select: { hash: true, embedding: true },
  });
  let prodVec = existingEmb && existingEmb.hash === hash ? existingEmb.embedding : null;
  if (!prodVec) {
    prodVec = await embedText(text, "document").catch(() => null);
    if (prodVec) {
      await prisma.productEmbedding
        .upsert({
          where: { productId: product.id },
          update: { hash, embedding: prodVec, title: product.title, description: product.description, price: product.price, image: product.image },
          create: { shop, productId: product.id, hash, embedding: prodVec, title: product.title, description: product.description, price: product.price, image: product.image },
        })
        .catch(() => {});
    }
  }
  if (!prodVec) return 0;

  const requests = await prisma.request.findMany({
    where: { shop, status: { in: ["active", "pending", "in_review"] } },
  });
  const existing = await prisma.match.findMany({
    where: { shop, productId: product.id },
    select: { requestId: true },
  });
  const known = new Set(existing.map((m) => m.requestId)); // dedupe accepted
  // Dedupe reasoned pairs (incl. rejected) so we never re-run the AI on an
  // unchanged product for the same request.
  const evals = await prisma.matchEval.findMany({
    where: { shop, productId: product.id },
    select: { requestId: true, productHash: true },
  });
  const evalHash = new Map(evals.map((e) => [e.requestId, e.productHash]));

  const ops = [];
  const evalOps = [];
  const newHigh = [];
  for (const request of requests) {
    if (known.has(request.id)) continue; // already matched this product for this request
    if (evalHash.get(request.id) === hash) continue; // already reasoned this exact product version
    if (!withinBudget(request.budget, product.price)) continue;
    const reqVec = await getRequestEmbedding(request);
    if (!reqVec) continue;
    if (cosineSimilarity(reqVec, prodVec) < RETRIEVAL_GATE) continue;

    const matches = await reasonMatches({
      description: request.description || "",
      budget: null, // budget is a soft ranking factor, never an AI gate
      candidates: [{ productId: product.id, title: product.title, description: product.description, price: product.price }],
    });
    let m = matches.find((x) => x.productId === product.id);
    // Batched strict double-check on this single candidate.
    if (m) {
      const pass = await verifyBatch({
        description: request.description || "",
        candidates: [{ productId: product.id, title: product.title, description: product.description }],
      });
      if (!pass.has(product.id)) m = null;
    }
    // Record that this (request, product-version) pair was reasoned — even a
    // reject — so future webhooks skip it until the product changes.
    evalOps.push(
      prisma.matchEval.upsert({
        where: { requestId_productId: { requestId: request.id, productId: product.id } },
        update: { productHash: hash, matched: !!m },
        create: { shop, requestId: request.id, productId: product.id, productHash: hash, matched: !!m },
      }).catch(() => {}),
    );
    if (!m) continue;

    const overBudget = isOverBudget(request.budget, product.price);
    const needsReview = m.confidence !== "high";
    ops.push(
      upsertMatch(shop, request, { productId: product.id, title: product.title, price: product.price, image: product.image }, {
        score: confidenceToScore(m.confidence),
        confidence: m.confidence,
        reason: m.reason,
        needsReview,
        overBudget,
      }),
    );
    if (!needsReview && !overBudget) newHigh.push({ request, m });
  }
  await Promise.all(ops);

  if (process.env.RESEND_API_KEY) {
    for (const { request, m } of newHigh) {
      sendNewProductMatchEmail({
        salespersonName: request.salespersonName,
        salespersonEmail: request.salespersonEmail,
        customerName: request.customerName,
        budget: request.budget,
        match: {
          productTitle: product.title,
          productPrice: product.price,
          productImage: product.image,
          score: confidenceToScore(m.confidence),
          matchedKeywords: [],
          reason: m.reason,
        },
        shop,
      }).catch((err) => console.error("[email] new-product alert failed:", err));
    }
  }

  return ops.length;
}

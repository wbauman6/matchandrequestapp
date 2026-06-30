import prisma from "../db.server.js";
import { cosineSimilarity } from "./matching.js";
import {
  embedText,
  buildRequestText,
  buildProductText,
  textHash,
  hasEmbeddingKey,
} from "./embeddings.server.js";
import { reasonMatches, verifyMatch, confidenceToScore } from "./reasoningMatch.server.js";
import { sendMatchSummaryEmail, sendNewProductMatchEmail } from "./email.server.js";

// --- Tunables -------------------------------------------------------------
const TOP_K = 50; // candidates sent to the AI reasoning pass
const BUDGET_TOLERANCE = 1.5; // exclude items more than this multiple over budget
const RETRIEVAL_GATE = 0.35; // webhook: min cosine for a new product to be judged for a request
const NEVER_EMPTY_FALLBACK = 5; // if the AI returns nothing, surface this many closest as "low"

function withinBudget(budget, price) {
  if (!budget || price == null) return true;
  return price <= budget * BUDGET_TOLERANCE;
}

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

  const rows = await prisma.productEmbedding.findMany({
    where: { shop: request.shop },
    select: { productId: true, title: true, description: true, price: true, image: true, embedding: true },
  });
  const declined = await prisma.match.findMany({
    where: { requestId: request.id, declined: true },
    select: { productId: true },
  });
  const declinedIds = new Set(declined.map((m) => m.productId));

  // Step 1 — light filter (budget only).
  let pool = rows.filter((p) => !declinedIds.has(p.productId) && withinBudget(request.budget, p.price));

  // Step 2 — semantic retrieval (top K by cosine).
  if (reqVec) {
    pool = pool
      .map((p) => ({ p, sim: cosineSimilarity(reqVec, p.embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, TOP_K)
      .map((x) => x.p);
  } else {
    pool = pool.slice(0, TOP_K);
  }

  // Step 3 — AI reasoning pass.
  const candidates = pool.map((p) => ({
    productId: p.productId,
    title: p.title,
    description: p.description,
    price: p.price,
  }));
  let matches = await reasonMatches({
    description: request.description || "",
    budget: request.budget,
    candidates,
  });

  // Step 3b — double-check: verify each proposed match individually (stricter
  // than judging the whole batch). Drop those that fail; keep on transient error.
  if (matches.length > 0) {
    const byIdC = new Map(candidates.map((c) => [c.productId, c]));
    const checked = await Promise.all(
      matches.map(async (m) => {
        const c = byIdC.get(m.productId);
        if (!c) return null;
        const v = await verifyMatch({ description: request.description || "", product: c });
        return v && v.match === false ? null : m;
      }),
    );
    matches = checked.filter(Boolean);
  }

  // Never empty: if nothing survived, surface the closest candidates.
  if (matches.length === 0 && pool.length > 0) {
    matches = pool.slice(0, NEVER_EMPTY_FALLBACK).map((p) => ({
      productId: p.productId,
      confidence: "low",
      reason: "Closest available item by description similarity.",
    }));
  }

  const byId = new Map(rows.map((r) => [r.productId, r]));
  const ops = [];
  const notify = [];
  for (const m of matches) {
    const p = byId.get(m.productId);
    if (!p) continue;
    const needsReview = m.confidence !== "high";
    ops.push(
      upsertMatch(request.shop, request, p, {
        score: confidenceToScore(m.confidence),
        confidence: m.confidence,
        reason: m.reason,
        needsReview,
      }),
    );
    if (!needsReview) {
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
  const known = new Set(existing.map((m) => m.requestId)); // dedupe

  const ops = [];
  const newHigh = [];
  for (const request of requests) {
    if (known.has(request.id)) continue; // already evaluated this product for this request
    if (!withinBudget(request.budget, product.price)) continue;
    const reqVec = await getRequestEmbedding(request);
    if (!reqVec) continue;
    if (cosineSimilarity(reqVec, prodVec) < RETRIEVAL_GATE) continue;

    const matches = await reasonMatches({
      description: request.description || "",
      budget: request.budget,
      candidates: [{ productId: product.id, title: product.title, description: product.description, price: product.price }],
    });
    const m = matches.find((x) => x.productId === product.id);
    if (!m) continue;

    // Double-check this specific pairing before alerting.
    const v = await verifyMatch({
      description: request.description || "",
      product: { title: product.title, description: product.description, price: product.price },
    });
    if (v && v.match === false) continue;

    const needsReview = m.confidence !== "high";
    ops.push(
      upsertMatch(shop, request, { productId: product.id, title: product.title, price: product.price, image: product.image }, {
        score: confidenceToScore(m.confidence),
        confidence: m.confidence,
        reason: m.reason,
        needsReview,
      }),
    );
    if (!needsReview) newHigh.push({ request, m });
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

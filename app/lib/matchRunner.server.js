import prisma from "../db.server.js";
import {
  computeMatch,
  computeKeywordWeights,
  weightedMatch,
  definingKeywords,
  isSoftCategory,
  cosineSimilarity,
  similarityToScore,
} from "./matching.js";
import { isMustHaveTag } from "./tagTiers.js";
import {
  extractRequestAttributes,
  extractProductAttributes,
  passesHardFilters,
} from "./attributes.js";
import {
  embedText,
  buildRequestText,
  buildProductText,
  textHash,
  hasEmbeddingKey,
} from "./embeddings.server.js";
import { getShopConfig } from "./shopConfig.server.js";
import { judgeMatch } from "./matchJudge.server.js";
import { fetchInStockProducts } from "./inventory.server.js";
import { sendMatchSummaryEmail, sendNewProductMatchEmail } from "./email.server.js";

// Sanity ceiling so a wildly-over-budget item never surfaces.
const BUDGET_SANITY_MULTIPLE = 3;

function passesBudgetSanity(budget, price) {
  if (!budget || price == null) return true;
  return price <= budget * BUDGET_SANITY_MULTIPLE;
}

function routeByScore(score, config) {
  if (score >= config.autoNotifyScore) return "notify";
  if (score >= config.reviewScore) return "review";
  return "drop";
}

// Hard-required (defining) keywords: curated map, then AI, then catalog-rarity.
function requiredKeywords(request, weights, aiRequired) {
  const curated = request.keywords.filter(isMustHaveTag);
  const base =
    curated.length > 0
      ? curated
      : aiRequired && aiRequired.length > 0
        ? aiRequired.filter((k) => request.keywords.includes(k))
        : weights
          ? definingKeywords(request.keywords, weights)
          : [];
  return base.filter((k) => !isSoftCategory(k));
}

// Get (and lazily persist) a request's query embedding.
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

function upsertMatch(shop, request, product, fields) {
  return prisma.match.upsert({
    where: {
      requestId_productId: { requestId: request.id, productId: product.id },
    },
    update: {
      score: fields.score,
      matchedKeywords: fields.matchedKeywords,
      needsReview: fields.needsReview,
      reasoning: fields.reasoning ?? null,
      productTitle: product.title,
      productPrice: product.price,
      productImage: product.image,
    },
    create: {
      shop,
      requestId: request.id,
      productId: product.id,
      productTitle: product.title,
      productPrice: product.price,
      productImage: product.image,
      score: fields.score,
      matchedKeywords: fields.matchedKeywords,
      needsReview: fields.needsReview,
      reasoning: fields.reasoning ?? null,
      declined: false,
    },
  });
}

async function applyStage2(config, request, product, matchedKeywords, route) {
  if (!config.stage2Enabled || route !== "review") return { route, reasoning: null };
  const verdict = await judgeMatch({ request, product, matchedKeywords }).catch(() => null);
  if (!verdict) return { route, reasoning: null };
  if (verdict.match && verdict.confidence >= 0.8) return { route: "notify", reasoning: verdict.reasoning };
  if (!verdict.match && verdict.confidence >= 0.8) return { route: "drop", reasoning: verdict.reasoning };
  return { route: "review", reasoning: verdict.reasoning };
}

/**
 * Create flow: Stage 1 hard filter + Stage 2 semantic ranking over the catalog's
 * stored embeddings. Keyword/IDF scoring is kept only as a fallback for products
 * without an embedding.
 */
export async function runMatchesForRequest(admin, request, aiRequired = null) {
  const products = await fetchInStockProducts(admin);
  const config = await getShopConfig(request.shop);

  const declinedMatches = await prisma.match.findMany({
    where: { requestId: request.id, declined: true },
    select: { productId: true },
  });
  const declinedProductIds = new Set(declinedMatches.map((m) => m.productId));

  // Stage 1 inputs
  const reqAttrs = extractRequestAttributes(request);
  // Fallback keyword scoring inputs (only used when an embedding is missing)
  const weights = computeKeywordWeights(request.keywords, products);
  const required = requiredKeywords(request, weights, aiRequired);

  // Stage 2 inputs
  const reqVec = await getRequestEmbedding(request);
  const embRows = await prisma.productEmbedding.findMany({
    where: { shop: request.shop },
    select: { productId: true, embedding: true },
  });
  const embById = new Map(embRows.map((e) => [e.productId, e.embedding]));

  const ops = [];
  const notifyProducts = [];

  for (const product of products) {
    if (declinedProductIds.has(product.id)) continue;
    if (!passesBudgetSanity(request.budget, product.price)) continue;
    // Stage 1 hard filter
    if (!passesHardFilters(reqAttrs, extractProductAttributes(product)).pass) continue;

    // Keyword overlap, for display chips only (not ranking).
    const overlap = computeMatch(request.keywords, product.tags, product.title);
    let matchedKeywords = overlap.matchedKeywords;

    // Stage 2 ranking
    const prodVec = embById.get(product.id);
    let score;
    if (reqVec && prodVec) {
      score = similarityToScore(cosineSimilarity(reqVec, prodVec));
    } else {
      const wm = weightedMatch(request.keywords, weights, product.tags, product.title, required);
      score = wm.score;
      matchedKeywords = wm.matchedKeywords;
      if (wm.score <= 0 || wm.matchedKeywords.length === 0) continue;
    }

    let route = routeByScore(score, config);
    if (route === "drop") continue;
    let reasoning = null;
    ({ route, reasoning } = await applyStage2(config, request, product, matchedKeywords, route));
    if (route === "drop") continue;

    const needsReview = route === "review";
    ops.push(upsertMatch(request.shop, request, product, { score, matchedKeywords, needsReview, reasoning }));
    if (!needsReview) {
      notifyProducts.push({
        productTitle: product.title,
        productPrice: product.price,
        productImage: product.image,
        score,
        matchedKeywords,
      });
    }
  }

  await Promise.all(ops);

  if (notifyProducts.length > 0 && process.env.RESEND_API_KEY) {
    sendMatchSummaryEmail({
      salespersonName: request.salespersonName,
      salespersonEmail: request.salespersonEmail,
      customerName: request.customerName,
      budget: request.budget,
      matches: notifyProducts,
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

// Embed an incoming product and persist it, returning the vector (or null).
async function upsertProductEmbedding(shop, product) {
  if (!hasEmbeddingKey()) return null;
  const text = buildProductText(product);
  if (!text.trim()) return null;
  const hash = textHash(text);
  const existing = await prisma.productEmbedding.findUnique({
    where: { productId: product.id },
    select: { hash: true, embedding: true },
  });
  if (existing && existing.hash === hash) return existing.embedding;
  const vec = await embedText(text, "document").catch(() => null);
  if (!vec) return existing?.embedding ?? null;
  await prisma.productEmbedding
    .upsert({
      where: { productId: product.id },
      update: { hash, embedding: vec, title: product.title, price: product.price, image: product.image },
      create: { shop, productId: product.id, hash, embedding: vec, title: product.title, price: product.price, image: product.image },
    })
    .catch(() => {});
  return vec;
}

/**
 * Webhook flow: facet/embed the incoming product, hard-filter it against open
 * requests, then rank by semantic similarity. Emails brand-new auto-notify pairs.
 */
export async function matchProductAgainstRequests(shop, product) {
  if (!product || (product.totalInventory != null && product.totalInventory <= 0)) {
    await prisma.match.deleteMany({ where: { shop, productId: product.id, declined: false } });
    await prisma.productEmbedding.deleteMany({ where: { productId: product.id } }).catch(() => {});
    return 0;
  }

  const config = await getShopConfig(shop);
  const requests = await prisma.request.findMany({
    where: { shop, status: { in: ["active", "pending", "in_review"] } },
  });

  const existing = await prisma.match.findMany({
    where: { shop, productId: product.id },
    select: { requestId: true, declined: true },
  });
  const existingByRequestId = new Map(existing.map((m) => [m.requestId, m]));

  const prodAttrs = extractProductAttributes(product);
  const prodVec = await upsertProductEmbedding(shop, product);

  const ops = [];
  const newNotifyPairs = [];

  for (const request of requests) {
    if (existingByRequestId.get(request.id)?.declined) continue;
    if (!passesBudgetSanity(request.budget, product.price)) continue;
    if (!request.keywords || request.keywords.length === 0) continue;
    // Stage 1 hard filter
    if (!passesHardFilters(extractRequestAttributes(request), prodAttrs).pass) continue;

    const overlap = computeMatch(request.keywords, product.tags, product.title);
    let matchedKeywords = overlap.matchedKeywords;
    const required = requiredKeywords(request, null, null);
    if (required.length > 0 && !required.every((k) => matchedKeywords.includes(k))) continue;

    // Stage 2 ranking
    const reqVec = await getRequestEmbedding(request);
    let score;
    if (reqVec && prodVec) {
      score = similarityToScore(cosineSimilarity(reqVec, prodVec));
    } else {
      if (matchedKeywords.length === 0) continue;
      score = Math.round((matchedKeywords.length / request.keywords.length) * 100);
    }

    let route = routeByScore(score, config);
    if (route === "drop") continue;
    let reasoning = null;
    ({ route, reasoning } = await applyStage2(config, request, product, matchedKeywords, route));
    if (route === "drop") continue;

    const needsReview = route === "review";
    ops.push(upsertMatch(shop, request, product, { score, matchedKeywords, needsReview, reasoning }));
    if (!needsReview && !existingByRequestId.has(request.id)) {
      newNotifyPairs.push({ request, score, matchedKeywords });
    }
  }

  await Promise.all(ops);

  if (process.env.RESEND_API_KEY) {
    for (const { request, score, matchedKeywords } of newNotifyPairs) {
      sendNewProductMatchEmail({
        salespersonName: request.salespersonName,
        salespersonEmail: request.salespersonEmail,
        customerName: request.customerName,
        budget: request.budget,
        match: {
          productTitle: product.title,
          productPrice: product.price,
          productImage: product.image,
          score,
          matchedKeywords,
        },
        shop,
      }).catch((err) => console.error("[email] new-product alert failed:", err));
    }
  }

  return ops.length;
}

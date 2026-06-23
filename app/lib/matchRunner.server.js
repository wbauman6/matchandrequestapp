import prisma from "../db.server.js";
import {
  computeMatch,
  computeKeywordWeights,
  weightedMatch,
  definingKeywords,
  isSoftCategory,
  priceProximity,
  blendScore,
} from "./matching.js";
import { isMustHaveTag } from "./tagTiers.js";
import { getShopConfig } from "./shopConfig.server.js";
import { judgeMatch } from "./matchJudge.server.js";
import { fetchInStockProducts } from "./inventory.server.js";
import { sendMatchSummaryEmail, sendNewProductMatchEmail } from "./email.server.js";

// Price is now a soft signal, but keep a sanity ceiling so we never surface a
// wildly-over-budget item (e.g. a $50k watch for a $500 request).
const BUDGET_SANITY_MULTIPLE = 3;

function passesBudgetSanity(budget, price) {
  if (!budget || price == null) return true;
  return price <= budget * BUDGET_SANITY_MULTIPLE;
}

// Decide what to do with a scored candidate given the shop's thresholds.
function routeByScore(score, config) {
  if (score >= config.autoNotifyScore) return "notify";
  if (score >= config.reviewScore) return "review";
  return "drop";
}

// The hard-required (defining) keywords for a request: curated map first, then
// the AI's per-request classification, then catalog-rarity. Soft tags removed.
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
      // NOTE: never reset `declined` or `confirmedAt` — staff decisions stick.
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

// Stage 2: when enabled, ask the LLM to judge a borderline (review-band) match.
// A confident yes promotes it to a direct notification; a no drops it.
// Returns { route, reasoning } — never throws (falls back to the stage-1 route).
async function applyStage2(config, request, product, score, matchedKeywords, route) {
  if (!config.stage2Enabled || route !== "review") return { route, reasoning: null };
  const verdict = await judgeMatch({ request, product, matchedKeywords }).catch(
    () => null,
  );
  if (!verdict) return { route, reasoning: null };
  if (verdict.match && verdict.confidence >= 0.8) {
    return { route: "notify", reasoning: verdict.reasoning };
  }
  if (!verdict.match && verdict.confidence >= 0.8) {
    return { route: "drop", reasoning: verdict.reasoning };
  }
  return { route: "review", reasoning: verdict.reasoning };
}

/**
 * When a new request is created: scan every in-stock product, score with the
 * IDF-weighted matcher, and route each candidate to notify / review / drop.
 * Sends one summary email covering the auto-notify matches only.
 */
export async function runMatchesForRequest(admin, request, aiRequired = null) {
  const products = await fetchInStockProducts(admin);
  const config = await getShopConfig(request.shop);

  const declinedMatches = await prisma.match.findMany({
    where: { requestId: request.id, declined: true },
    select: { productId: true },
  });
  const declinedProductIds = new Set(declinedMatches.map((m) => m.productId));

  const weights = computeKeywordWeights(request.keywords, products);
  const required = requiredKeywords(request, weights, aiRequired);

  const ops = [];
  const notifyProducts = [];

  for (const product of products) {
    if (declinedProductIds.has(product.id)) continue;
    if (!passesBudgetSanity(request.budget, product.price)) continue;

    const { score: kwScore, matchedKeywords } = weightedMatch(
      request.keywords,
      weights,
      product.tags,
      product.title,
      required,
    );
    if (kwScore <= 0 || matchedKeywords.length === 0) continue;

    const priceProx = priceProximity(request.budget, product.price);
    const score = blendScore(kwScore, priceProx);
    let route = routeByScore(score, config);
    if (route === "drop") continue;

    let reasoning = null;
    ({ route, reasoning } = await applyStage2(
      config, request, product, score, matchedKeywords, route,
    ));
    if (route === "drop") continue;

    const needsReview = route === "review";
    ops.push(
      upsertMatch(request.shop, request, product, {
        score,
        matchedKeywords,
        needsReview,
        reasoning,
      }),
    );
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

  // Email covers only the high-confidence (auto-notify) matches. Review-queue
  // matches wait for staff confirmation.
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

/**
 * When a product is created/updated via webhook: check it against open requests
 * and route each candidate. Applies the same HARD facet filter as the create
 * flow (item type / brand / motif / material / gemstone must match), then scores
 * the soft overlap. Emails only brand-new auto-notify pairings.
 */
export async function matchProductAgainstRequests(shop, product) {
  // Out-of-stock or inactive → remove stale non-declined matches silently.
  if (!product || (product.totalInventory != null && product.totalInventory <= 0)) {
    await prisma.match.deleteMany({
      where: { shop, productId: product.id, declined: false },
    });
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

  const ops = [];
  const newNotifyPairs = [];

  for (const request of requests) {
    if (existingByRequestId.get(request.id)?.declined) continue;
    if (!passesBudgetSanity(request.budget, product.price)) continue;
    if (!request.keywords || request.keywords.length === 0) continue;

    // Unweighted soft score (no catalog corpus in the webhook), but apply the
    // deterministic HARD facet filter so a shared common tag can't match.
    const { matchedKeywords } = computeMatch(
      request.keywords,
      product.tags,
      product.title,
    );
    const required = requiredKeywords(request, null, null);
    const satisfiesRequired = required.every((k) => matchedKeywords.includes(k));
    if (required.length > 0 && !satisfiesRequired) continue;
    if (matchedKeywords.length === 0) continue;

    const kwScore = Math.round(
      (matchedKeywords.length / request.keywords.length) * 100,
    );
    const priceProx = priceProximity(request.budget, product.price);
    const score = blendScore(kwScore, priceProx);
    let route = routeByScore(score, config);
    if (route === "drop") continue;

    let reasoning = null;
    ({ route, reasoning } = await applyStage2(
      config, request, product, score, matchedKeywords, route,
    ));
    if (route === "drop") continue;

    const needsReview = route === "review";
    ops.push(
      upsertMatch(shop, request, product, {
        score,
        matchedKeywords,
        needsReview,
        reasoning,
      }),
    );
    if (!needsReview && !existingByRequestId.has(request.id)) {
      newNotifyPairs.push({ request, score, matchedKeywords });
    }
  }

  await Promise.all(ops);

  // Email only brand-new auto-notify pairings.
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

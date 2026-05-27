import prisma from "../db.server.js";
import { computeMatch } from "./matching.js";
import { fetchInStockProducts } from "./inventory.server.js";
import { sendMatchSummaryEmail, sendNewProductMatchEmail } from "./email.server.js";

const MIN_SCORE = 20;
const BUDGET_TOLERANCE = 1.5; // show products up to 50% over budget

/** Returns true when no budget is set OR the product is within tolerance. */
function isWithinBudget(budget, price) {
  if (!budget || price == null) return true;
  return price <= budget * BUDGET_TOLERANCE;
}

function upsertMatch(shop, request, product, score, matchedKeywords) {
  return prisma.match.upsert({
    where: {
      requestId_productId: { requestId: request.id, productId: product.id },
    },
    update: {
      score,
      matchedKeywords,
      productTitle: product.title,
      productPrice: product.price,
      productImage: product.image,
      // NOTE: never reset `declined` — a declined match stays declined
    },
    create: {
      shop,
      requestId: request.id,
      productId: product.id,
      productTitle: product.title,
      productPrice: product.price,
      productImage: product.image,
      score,
      matchedKeywords,
      declined: false,
    },
  });
}

/**
 * When a new request is created: scan every in-stock product and upsert matches.
 * Sends one summary email to the salesperson if any matches are found.
 */
export async function runMatchesForRequest(admin, request) {
  const products = await fetchInStockProducts(admin);

  // Load declined product IDs so we never re-surface them for this request
  const declinedMatches = await prisma.match.findMany({
    where: { requestId: request.id, declined: true },
    select: { productId: true },
  });
  const declinedProductIds = new Set(declinedMatches.map((m) => m.productId));

  const ops = [];
  const matchedProducts = [];

  for (const product of products) {
    if (declinedProductIds.has(product.id)) continue;
    if (!isWithinBudget(request.budget, product.price)) continue;

    const { score, matchedKeywords } = computeMatch(
      request.keywords,
      product.tags,
      product.title,
    );
    if (score >= MIN_SCORE && matchedKeywords.length > 0) {
      ops.push(upsertMatch(request.shop, request, product, score, matchedKeywords));
      matchedProducts.push({
        productTitle: product.title,
        productPrice: product.price,
        productImage: product.image,
        score,
        matchedKeywords,
      });
    }
  }

  await Promise.all(ops);

  // Non-blocking email — a failed send must never break the save.
  if (matchedProducts.length > 0 && process.env.RESEND_API_KEY) {
    sendMatchSummaryEmail({
      salespersonName: request.salespersonName,
      salespersonEmail: request.salespersonEmail,
      customerName: request.customerName,
      budget: request.budget,
      matches: matchedProducts,
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
 * When a product is created/updated via webhook: check it against every open
 * request and email salespeople whose requests get a NEW match (not an update).
 */
export async function matchProductAgainstRequests(shop, product) {
  // Out-of-stock or inactive → remove stale non-declined matches silently.
  if (!product || (product.totalInventory != null && product.totalInventory <= 0)) {
    await prisma.match.deleteMany({
      where: { shop, productId: product.id, declined: false },
    });
    return 0;
  }

  const requests = await prisma.request.findMany({
    where: { shop, status: { in: ["active", "pending"] } },
  });

  // For each request, track existing matches (including declined) for this product
  const existing = await prisma.match.findMany({
    where: { shop, productId: product.id },
    select: { requestId: true, declined: true },
  });
  const existingByRequestId = new Map(existing.map((m) => [m.requestId, m]));

  const ops = [];
  const newMatchPairs = [];

  for (const request of requests) {
    // Skip if this product was declined for this specific request
    if (existingByRequestId.get(request.id)?.declined) continue;

    if (!isWithinBudget(request.budget, product.price)) continue;

    const { score, matchedKeywords } = computeMatch(
      request.keywords,
      product.tags,
      product.title,
    );
    if (score >= MIN_SCORE && matchedKeywords.length > 0) {
      ops.push(upsertMatch(shop, request, product, score, matchedKeywords));
      if (!existingByRequestId.has(request.id)) {
        newMatchPairs.push({ request, score, matchedKeywords });
      }
    }
  }

  await Promise.all(ops);

  // Email only for brand-new pairings.
  if (process.env.RESEND_API_KEY) {
    for (const { request, score, matchedKeywords } of newMatchPairs) {
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

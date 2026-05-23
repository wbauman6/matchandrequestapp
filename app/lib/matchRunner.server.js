import prisma from "../db.server.js";
import { computeMatch } from "./matching.js";
import { fetchInStockProducts } from "./inventory.server.js";
import { sendMatchSummaryEmail, sendNewProductMatchEmail } from "./email.server.js";

const MIN_SCORE = 20;
const BUDGET_TOLERANCE = 1.5; // show products up to 50% over budget

/** Returns true when no budget is set OR the product is within tolerance. */
function isWithinBudget(budget, price) {
  if (!budget || price == null) return true; // no budget entered → never filter
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
    },
  });
}

/**
 * When a new request is created: scan every in-stock product and upsert matches.
 * Sends one summary email to the salesperson if any matches are found.
 */
export async function runMatchesForRequest(admin, request) {
  const products = await fetchInStockProducts(admin);
  const ops = [];
  const matchedProducts = [];

  for (const product of products) {
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
    }).catch((err) => console.error("[email] summary send failed:", err));
  }

  return ops.length;
}

/**
 * When a product is created/updated via webhook: check it against every open
 * request and email salespeople whose requests get a NEW match (not an update).
 */
export async function matchProductAgainstRequests(shop, product) {
  // Out-of-stock or inactive → remove stale matches silently.
  if (!product || (product.totalInventory != null && product.totalInventory <= 0)) {
    await prisma.match.deleteMany({ where: { shop, productId: product.id } });
    return 0;
  }

  const requests = await prisma.request.findMany({
    where: { shop, status: { in: ["active", "pending"] } },
  });

  // Track which requests already have a match for this product so we only
  // email on genuinely new pairings (not score updates).
  const existing = await prisma.match.findMany({
    where: { shop, productId: product.id },
    select: { requestId: true },
  });
  const existingRequestIds = new Set(existing.map((m) => m.requestId));

  const ops = [];
  const newMatchPairs = []; // { request, score, matchedKeywords }

  for (const request of requests) {
    if (!isWithinBudget(request.budget, product.price)) continue;

    const { score, matchedKeywords } = computeMatch(
      request.keywords,
      product.tags,
      product.title,
    );
    if (score >= MIN_SCORE && matchedKeywords.length > 0) {
      ops.push(upsertMatch(shop, request, product, score, matchedKeywords));
      if (!existingRequestIds.has(request.id)) {
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

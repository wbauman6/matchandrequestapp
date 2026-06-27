import { authenticate } from "../shopify.server";
import { matchProductAgainstRequests } from "../lib/matchRunner.server";

/**
 * Handles products/create and products/update webhooks.
 * Whenever a product is added or changed in Shopify, re-evaluate it
 * against every open customer request so new estate inventory
 * automatically flags matches without anyone clicking anything.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook payload uses REST-shaped fields. Build a product object that
  // matches what the matcher expects (mirrors fetchInStockProducts output).
  const numericId = payload.id;
  const gid = payload.admin_graphql_api_id || `gid://shopify/Product/${numericId}`;

  // payload.tags is a comma-separated string
  const tags = String(payload.tags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // Find the lowest variant price (matches priceRangeV2.minVariantPrice)
  const variantPrices = (payload.variants || [])
    .map((v) => parseFloat(v?.price))
    .filter((p) => Number.isFinite(p));
  const price = variantPrices.length ? Math.min(...variantPrices) : null;

  // Sum inventory across variants if present; treat missing/null as 0
  const totalInventory = (payload.variants || []).reduce((sum, v) => {
    const q = Number(v?.inventory_quantity);
    return sum + (Number.isFinite(q) ? q : 0);
  }, 0);

  // First image in the payload's image array (REST shape)
  const image =
    payload.image?.src ||
    (Array.isArray(payload.images) && payload.images[0]?.src) ||
    null;

  // If the product was set to draft/archived, treat as removed
  const isActive = !payload.status || payload.status === "active";

  const product = {
    id: gid,
    title: payload.title || "",
    productType: payload.product_type || "",
    vendor: payload.vendor || "",
    tags,
    price,
    image,
    totalInventory: isActive ? totalInventory : 0,
  };

  try {
    const count = await matchProductAgainstRequests(shop, product);
    console.log(`[${topic}] ${shop} → ${product.title}: ${count} match(es) upserted`);
  } catch (err) {
    console.error(`[${topic}] match failed for ${product.id}:`, err);
  }

  return new Response();
};

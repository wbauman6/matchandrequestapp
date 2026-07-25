import { waitUntil } from "@vercel/functions";
import { authenticate } from "../shopify.server";
import { enqueueProduct, drainProductQueue, screenQueueAvailability } from "../lib/productQueue.server";
import { isDropWindow } from "../lib/dropSchedule.js";

/**
 * Handles products/create and products/update webhooks.
 *
 * INSTANT-ACK: the handler only upserts the event into ProductQueue (fast DB
 * write) and returns 200 within Shopify's 5-second deadline — so Shopify never
 * marks deliveries failed and never retries (the July 13 runaway was a bulk
 * sync × synchronous AI matching × Shopify retry storm). The queued products
 * are then processed in BATCHED AI calls by drainProductQueue, kicked here via
 * waitUntil and backed up by the drain cron.
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

  // Available-inventory FAST-PATH: sold items stay in the catalog at 0
  // available and must never match. The webhook payload only proves "sold"
  // when it actually carries tracked-variant inventory data (these fields can
  // be absent without the read_inventory scope — absence must NOT read as
  // in-stock). inStock === false triggers immediate match removal in
  // enqueueProduct; undefined defers to the drain worker, which bulk-fetches
  // authoritative availability from the Admin API per claim batch.
  const trackedVariants = (payload.variants || []).filter((v) => v?.inventory_management);
  const inStock =
    trackedVariants.length === 0
      ? undefined
      : trackedVariants.reduce((sum, v) => {
          const q = Number(v?.inventory_quantity);
          return sum + (Number.isFinite(q) ? q : 0);
        }, 0) > 0;

  // First image in the payload's image array (REST shape)
  const image =
    payload.image?.src ||
    (Array.isArray(payload.images) && payload.images[0]?.src) ||
    null;

  // If the product was set to draft/archived, treat as removed
  const isActive = !payload.status || payload.status === "active";

  const description = String(payload.body_html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const product = {
    id: gid,
    title: payload.title || "",
    productType: payload.product_type || "",
    vendor: payload.vendor || "",
    description,
    tags,
    price,
    image,
    active: isActive,
    inStock,
    totalInventory,
  };

  try {
    await enqueueProduct(shop, product);
  } catch (err) {
    console.error(`[${topic}] enqueue failed for ${product.id}:`, err);
  }

  // Inventory only changes at the weekly Tuesday-4PM-ET drop. During that
  // window the drop's own webhooks trigger draining (AI matching); the rest of
  // the week a webhook only screens availability (no AI) so a SALE still
  // removes its matches within seconds, and everything else waits queued for
  // Tuesday. The response goes out immediately either way.
  const work = (isDropWindow()
    ? drainProductQueue(shop)
    : screenQueueAvailability(shop, [product.id])
  ).catch((err) => console.error(`[${topic}] background work failed:`, err?.message || err));
  try {
    waitUntil(work);
  } catch {
    void work; // non-Vercel runtime: detached
  }

  return new Response();
};

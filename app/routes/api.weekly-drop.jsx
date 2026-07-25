/**
 * GET /api/weekly-drop
 *
 * Cron backstop for the WEEKLY drop match (Tuesday 4:00 PM Eastern — see
 * app/lib/dropSchedule.js). The drop's own products/create|update webhooks
 * normally trigger draining the moment inventory lands; this cron (Tue 22:00
 * UTC = 5 PM EDT / 6 PM EST, always inside the window) catches anything they
 * missed: it sweeps the catalog for active products with no stored embedding,
 * enqueues them, then drains the whole queue (the week's accumulated events +
 * the drop) in batched AI calls.
 *
 * Outside the drop window it's a no-op (?force=1 overrides, for testing).
 * Protected by CRON_SECRET.
 */
import prisma from "../db.server.js";
import { enqueueProduct, drainProductQueue } from "../lib/productQueue.server.js";
import { isDropWindow } from "../lib/dropSchedule.js";

const API_VERSION = "2025-10";
const MAX_PER_RUN = 400; // weekly bound on brand-new products swept in per run

export const loader = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (token !== secret) return new Response("Unauthorized", { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!isDropWindow() && !force) {
    return Response.json({ ok: true, skipped: "outside weekly drop window" });
  }

  const sessions = await prisma.session.findMany({ where: { isOnline: false } });
  const results = [];

  for (const session of sessions) {
    const shop = session.shop;
    const token = session.accessToken;
    const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
    const QUERY = `query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){ pageInfo{hasNextPage endCursor} edges{ node{ id title description tags totalInventory tracksInventory priceRangeV2{minVariantPrice{amount}} featuredImage{url} } } } }`;

    const embedded = new Set(
      (await prisma.productEmbedding.findMany({ where: { shop }, select: { productId: true } })).map(
        (e) => e.productId,
      ),
    );

    let enqueued = 0;
    let cursor = null;
    let hasNext = true;
    let stop = false;
    try {
      while (hasNext && !stop) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query: QUERY, variables: { cursor } }),
        });
        const json = await res.json();
        if (!json.data?.products) {
          results.push({ shop, error: JSON.stringify(json.errors || "no data").slice(0, 200) });
          break;
        }
        const page = json.data.products;
        for (const { node } of page.edges) {
          if (embedded.has(node.id)) continue; // already known; webhooks queued any changes
          const amount = node.priceRangeV2?.minVariantPrice?.amount;
          await enqueueProduct(shop, {
            id: node.id,
            title: node.title || "",
            description: node.description || "",
            tags: (node.tags || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
            price: amount != null ? parseFloat(amount) : null,
            image: node.featuredImage?.url || null,
            active: true,
            inStock: !node.tracksInventory || (node.totalInventory ?? 0) > 0,
          }).catch((e) => console.error("[weekly-drop] enqueue failed:", e?.message || e));
          enqueued++;
          if (enqueued >= MAX_PER_RUN) { stop = true; break; }
        }
        hasNext = page.pageInfo.hasNextPage;
        cursor = page.pageInfo.endCursor;
      }
    } catch (err) {
      results.push({ shop, error: err?.message || String(err) });
      continue;
    }
    const drained = await drainProductQueue(shop, { force }).catch((e) => {
      console.error("[weekly-drop] drain failed:", e?.message || e);
      return { processed: 0, matched: 0, aborted: true };
    });
    results.push({ shop, newEnqueued: enqueued, drained });
  }

  return Response.json({ ok: true, timestamp: new Date().toISOString(), results });
};

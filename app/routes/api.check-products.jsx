/**
 * GET /api/check-products
 *
 * Daily safety net for keep-watching. Webhooks (products/create, products/update)
 * check every new/changed product against active requests in real time; this
 * cron catches any product a webhook may have missed (delivery failure, downtime)
 * by finding active products that have no stored embedding yet and running them
 * through the same matcher.
 *
 * Protected by CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */
import prisma from "../db.server.js";
import { enqueueProduct, drainProductQueue } from "../lib/productQueue.server.js";

const API_VERSION = "2025-10";
const MAX_PER_RUN = 40; // bound cost/time; repeated daily runs catch up

export const loader = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (token !== secret) return new Response("Unauthorized", { status: 401 });
  }

  const sessions = await prisma.session.findMany({ where: { isOnline: false } });
  const results = [];

  for (const session of sessions) {
    const shop = session.shop;
    const token = session.accessToken;
    const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
    const QUERY = `query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){ pageInfo{hasNextPage endCursor} edges{ node{ id title description tags totalInventory tracksInventory priceRangeV2{minVariantPrice{amount}} featuredImage{url} } } } }`;

    // Existing embeddings = products already processed.
    const embedded = new Set(
      (await prisma.productEmbedding.findMany({ where: { shop }, select: { productId: true } })).map(
        (e) => e.productId,
      ),
    );

    let processed = 0;
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
          if (embedded.has(node.id)) continue; // already processed
          const amount = node.priceRangeV2?.minVariantPrice?.amount;
          const product = {
            id: node.id,
            title: node.title || "",
            description: node.description || "",
            tags: (node.tags || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
            price: amount != null ? parseFloat(amount) : null,
            image: node.featuredImage?.url || null,
            active: true,
            // Untracked inventory = always purchasable; tracked = needs
            // available > 0. Sold (0-available) items never match.
            inStock: !node.tracksInventory || (node.totalInventory ?? 0) > 0,
          };
          await enqueueProduct(shop, product).catch((e) => {
            console.error("[check-products] enqueue failed:", e?.message || e);
          });
          processed++;
          if (processed >= MAX_PER_RUN) { stop = true; break; }
        }
        hasNext = page.pageInfo.hasNextPage;
        cursor = page.pageInfo.endCursor;
      }
    } catch (err) {
      results.push({ shop, error: err?.message || String(err) });
      continue;
    }
    // Drain the queue (covers both what we just enqueued and any backlog the
    // webhook-triggered drains left behind, e.g. after an AI-budget abort).
    const drained = await drainProductQueue(shop).catch((e) => {
      console.error("[check-products] drain failed:", e?.message || e);
      return { processed: 0, matched: 0, aborted: true };
    });
    results.push({ shop, newEnqueued: processed, drained });
  }

  return Response.json({ ok: true, timestamp: new Date().toISOString(), results });
};

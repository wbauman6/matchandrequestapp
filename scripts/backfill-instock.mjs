// Backfill ProductEmbedding.inStock from live Shopify availability, and clean
// up matches/evals referencing now-sold (0-available) products.
// Safe to re-run anytime (idempotent).
import { config } from "dotenv";
config();
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.POSTGRES_URL_NON_POOLING);
const SHOP = "walter-bauman-jewelers.myshopify.com";
const API_VERSION = "2025-10";

const [sess] = await sql.query(
  `SELECT "accessToken" FROM "Session" WHERE shop = $1 AND "isOnline" = false LIMIT 1`,
  [SHOP],
);
if (!sess) throw new Error("no offline session — open the app once to refresh");

const QUERY = `query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){
  pageInfo{hasNextPage endCursor}
  edges{ node{ id totalInventory tracksInventory } } } }`;

const stock = new Map(); // productId -> inStock
let cursor = null;
let hasNext = true;
while (hasNext) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": sess.accessToken },
    body: JSON.stringify({ query: QUERY, variables: { cursor } }),
  });
  const json = await res.json();
  const page = json.data?.products;
  if (!page) throw new Error("GraphQL error: " + JSON.stringify(json.errors || json).slice(0, 300));
  for (const { node } of page.edges) {
    stock.set(node.id, !node.tracksInventory || (node.totalInventory ?? 0) > 0);
  }
  hasNext = page.pageInfo.hasNextPage;
  cursor = page.pageInfo.endCursor;
}
const inStockIds = [...stock.entries()].filter(([, s]) => s).map(([id]) => id);
const soldIds = [...stock.entries()].filter(([, s]) => !s).map(([id]) => id);
console.log(`catalog: ${stock.size} active products — ${inStockIds.length} in stock, ${soldIds.length} sold (0 available)`);

// Update embeddings in chunks.
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
let flippedOut = 0;
for (const ids of chunk(soldIds, 500)) {
  const r = await sql.query(
    `UPDATE "ProductEmbedding" SET "inStock" = false WHERE shop = $1 AND "productId" = ANY($2) AND "inStock" = true`,
    [SHOP, ids],
  );
  flippedOut += r.length ?? 0;
}
for (const ids of chunk(inStockIds, 500)) {
  await sql.query(
    `UPDATE "ProductEmbedding" SET "inStock" = true WHERE shop = $1 AND "productId" = ANY($2) AND "inStock" = false`,
    [SHOP, ids],
  );
}
const counts = await sql.query(`SELECT "inStock", count(*) FROM "ProductEmbedding" WHERE shop = $1 GROUP BY 1`, [SHOP]);
console.log("embedding rows now:", JSON.stringify(counts));

// Sell-through cleanup: existing matches + reasoned-pair records for sold items.
let deletedMatches = 0;
let deletedEvals = 0;
for (const ids of chunk(soldIds, 500)) {
  const m = await sql.query(
    `DELETE FROM "Match" WHERE shop = $1 AND "productId" = ANY($2) AND declined = false RETURNING id`,
    [SHOP, ids],
  );
  deletedMatches += m.length;
  const e = await sql.query(`DELETE FROM "MatchEval" WHERE shop = $1 AND "productId" = ANY($2) RETURNING id`, [SHOP, ids]);
  deletedEvals += e.length;
}
console.log(`removed ${deletedMatches} match(es) and ${deletedEvals} eval record(s) referencing sold products`);

// Spot check: Grand Seiko items.
const gs = await sql.query(
  `SELECT title, "inStock" FROM "ProductEmbedding" WHERE shop = $1 AND title ILIKE '%grand seiko%' ORDER BY "inStock" DESC`,
  [SHOP],
);
console.log("Grand Seiko items:");
gs.forEach((r) => console.log(`  ${r.inStock ? "IN STOCK " : "SOLD     "} ${r.title}`));

import { config } from "dotenv";
config();
import pkg from "pg";
import {
  extractProductAttributes,
  extractRequestAttributes,
  passesHardFilters,
  extractBrand,
  normalizeBrand,
  extractItemType,
  normalizeItemType,
} from "../app/lib/attributes.js";
import { deriveFacets } from "../app/lib/facets.js";

const SHOP = process.argv[2] || "walter-bauman-jewelers.myshopify.com";
const { Client } = pkg;

// Read the offline access token for the shop from the session store.
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();
const res = await db.query('SELECT "accessToken" FROM "Session" WHERE shop = $1', [SHOP]);
await db.end();
if (!res.rows.length) {
  console.error("No session for", SHOP);
  process.exit(1);
}
const token = res.rows[0].accessToken;

const endpoint = `https://${SHOP}/admin/api/2025-10/graphql.json`;
const QUERY = `query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){ pageInfo{hasNextPage endCursor} edges{ node{ id title productType vendor tags totalInventory } } } }`;

const products = [];
let cursor = null, hasNext = true;
while (hasNext) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: QUERY, variables: { cursor } }),
  });
  const j = await r.json();
  if (j.errors) { console.error(JSON.stringify(j.errors)); break; }
  const page = j.data.products;
  for (const { node } of page.edges) {
    if (node.totalInventory > 0) {
      products.push({
        id: node.id,
        title: node.title,
        productType: node.productType || "",
        vendor: node.vendor || "",
        tags: (node.tags || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
      });
    }
  }
  hasNext = page.pageInfo.hasNextPage;
  cursor = page.pageInfo.endCursor;
}

console.log(`\nIn-stock products: ${products.length}\n`);

// ---- Data cleanliness: how many products have unknown metal/type/brand ----
let unkMetal = 0, unkType = 0, unkBrand = 0;
const metalCounts = {};
const typeCounts = {};
const attrs = products.map((p) => {
  const a = extractProductAttributes(p);
  if (a.metal === "unknown") unkMetal++;
  if (!a.itemType) unkType++;
  if (!a.brand) unkBrand++;
  metalCounts[a.metal] = (metalCounts[a.metal] || 0) + 1;
  if (a.itemType) typeCounts[a.itemType] = (typeCounts[a.itemType] || 0) + 1;
  return { p, a };
});

const pct = (n) => `${n} (${Math.round((n / products.length) * 100)}%)`;
console.log("DATA CLEANLINESS (unknown counts):");
console.log("  metal unknown:", pct(unkMetal));
console.log("  item type unknown:", pct(unkType));
console.log("  brand unknown (no recognized brand):", pct(unkBrand));

console.log("\nMETAL DISTRIBUTION:");
for (const [k, v] of Object.entries(metalCounts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k}: ${v}`);

console.log("\nITEM TYPE DISTRIBUTION:");
for (const [k, v] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k}: ${v}`);

// ---- How much does reading the TITLE add over tags? ----
let titleAddsBrand = 0;
let titleAddsType = 0;
for (const p of products) {
  const brandTitle = extractBrand([p.title]);
  const brandTags =
    normalizeBrand(deriveFacets(p.tags).brand) ||
    extractBrand([...p.tags, p.productType, p.vendor]);
  if (brandTitle && !brandTags) titleAddsBrand++;

  const typeTitle = extractItemType([p.title]);
  const typeTags =
    normalizeItemType(deriveFacets(p.tags).item_type) ||
    extractItemType([...p.tags, p.productType]);
  if (typeTitle && !typeTags) titleAddsType++;
}
console.log("\nTITLE READING ADDS (detectable in title, missing from tags):");
console.log("  brand:", pct(titleAddsBrand));
console.log("  item type:", pct(titleAddsType));

// ---- CHECKPOINT: "yellow gold ring" request ----
const req = extractRequestAttributes({
  description: "yellow gold ring",
  keywords: ["yellow gold", "ring"],
});
console.log("\nCHECKPOINT request 'yellow gold ring' ->", JSON.stringify(req));

const survivors = attrs.filter(({ a }) => passesHardFilters(req, a).pass);
const leaks = survivors.filter(
  ({ a }) => a.metal !== "yellow_gold" || a.itemType !== "ring",
);
console.log(`\n  survivors: ${survivors.length} of ${products.length}`);
console.log(`  any non-yellow-gold or non-ring leaks: ${leaks.length}`);
console.log("\n  sample survivors:");
for (const { p, a } of survivors.slice(0, 12))
  console.log(`   - [${a.metal}/${a.itemType}] ${p.title}`);
if (leaks.length) {
  console.log("\n  LEAKS (should be empty):");
  for (const { p, a } of leaks.slice(0, 20))
    console.log(`   - [${a.metal}/${a.itemType}] ${p.title}`);
}

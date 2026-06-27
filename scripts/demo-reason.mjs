import { config } from "dotenv";
config();
import pkg from "pg";
import { embedText } from "../app/lib/embeddings.server.js";
import { cosineSimilarity } from "../app/lib/matching.js";
import { parsePriceRange } from "../app/lib/facets.js";
import { reasonMatches } from "../app/lib/reasoningMatch.server.js";

const SHOP = "walter-bauman-jewelers.myshopify.com";
const TOP_K = 30;
const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();
const rows = (
  await db.query(
    'SELECT "productId", title, description, price, embedding FROM "ProductEmbedding" WHERE shop=$1',
    [SHOP],
  )
).rows;
await db.end();
console.log(`Loaded ${rows.length} product embeddings\n`);

async function demo(query) {
  const pr = parsePriceRange(query);
  const max = pr?.max ?? null;

  // Step 1 — light filter: budget only.
  let pool = rows;
  if (max != null) pool = pool.filter((p) => p.price == null || p.price <= max);

  // Step 2 — semantic retrieval: top K by cosine.
  const qVec = await embedText(query, "query");
  const ranked = pool
    .map((p) => ({ p, sim: cosineSimilarity(qVec, p.embedding) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, TOP_K);

  // Step 3 — AI reasoning pass.
  const candidates = ranked.map(({ p }) => ({
    productId: p.productId,
    title: p.title,
    description: p.description,
    price: p.price,
  }));
  const matches = await reasonMatches({ description: query, budget: max, candidates });
  const byId = new Map(rows.map((r) => [r.productId, r]));

  console.log(`\n======================================================`);
  console.log(`QUERY: "${query}"  ${max != null ? "(budget max $" + max + ")" : ""}`);
  console.log(`  pool after budget filter: ${pool.length} | retrieved top ${ranked.length} | AI matches: ${matches.length}`);
  for (const m of matches.slice(0, 12)) {
    const p = byId.get(m.productId);
    const price = p?.price != null ? `$${p.price}` : "—";
    console.log(`  [${m.confidence.toUpperCase().padEnd(6)}] ${price.padStart(9)}  ${p?.title}`);
    console.log(`           ↳ ${m.reason}`);
  }
}

await demo("grand seiko round dial");
await demo("tiffany heart bracelet");
await demo("diamond cluster ring under $2000");
await demo("yellow gold tennis bracelet");
process.exit(0);

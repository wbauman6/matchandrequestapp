import { config } from "dotenv";
config();
import pkg from "pg";
import { embedText } from "../app/lib/embeddings.server.js";
import {
  extractRequestAttributes,
  extractProductAttributes,
  passesHardFilters,
} from "../app/lib/attributes.js";
import { cosineSimilarity, similarityToScore } from "../app/lib/matching.js";

const SHOP = "walter-bauman-jewelers.myshopify.com";
const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();
const rows = (
  await db.query(
    'SELECT "productId", title, price, embedding FROM "ProductEmbedding" WHERE shop=$1',
    [SHOP],
  )
).rows;
await db.end();
console.log(`Loaded ${rows.length} product embeddings`);

// NOTE: ProductEmbedding stores title only, so style/attrs here come from the
// title alone. The live matcher additionally uses tags + description, so it
// detects MORE styles than this demo.
const products = rows.map((r) => {
  const p = { id: r.productId, title: r.title || "", tags: [], description: "", price: r.price, embedding: r.embedding };
  p.attrs = extractProductAttributes(p);
  return p;
});

// ---- Style data quality ----
const withStyle = products.filter((p) => p.attrs.styles.length > 0);
const styleCounts = {};
for (const p of products) for (const s of p.attrs.styles) styleCounts[s] = (styleCounts[s] || 0) + 1;
console.log(`\nProducts with >=1 detectable defining style (from title): ${withStyle.length} (${Math.round((withStyle.length / products.length) * 100)}%)`);
console.log(`No detectable defining style: ${products.length - withStyle.length} (expected — most pieces have no special setting)`);
console.log("Defining-style distribution:");
for (const [k, v] of Object.entries(styleCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

async function demo(query) {
  const reqAttrs = extractRequestAttributes({ description: query, keywords: [] });
  const qVec = await embedText(query, "query");

  // Stage 1: metal/type/brand
  let pool = products.filter((p) => passesHardFilters(reqAttrs, p.attrs).pass);
  // Stage 1.5: defining-style requirement (AND, with fallback to most specific)
  const reqStyles = reqAttrs.styles || [];
  let note = "";
  if (reqStyles.length > 0) {
    let kept = pool.filter((p) => reqStyles.every((s) => p.attrs.styles.includes(s)));
    if (kept.length === 0 && reqStyles.length > 1) {
      const freq = {};
      for (const p of pool) for (const s of p.attrs.styles) if (reqStyles.includes(s)) freq[s] = (freq[s] || 0) + 1;
      const ms = [...reqStyles].sort((a, b) => (freq[a] || 0) - (freq[b] || 0))[0];
      kept = pool.filter((p) => p.attrs.styles.includes(ms));
      note = ` (fell back to most specific "${ms}")`;
    }
    pool = kept;
  }

  const ranked = pool
    .map((p) => ({ p, score: similarityToScore(cosineSimilarity(qVec, p.embedding)) }))
    .sort((a, b) => b.score - a.score);

  console.log(`\n========================================`);
  console.log(`QUERY: "${query}"`);
  console.log(`  attrs: metal=${reqAttrs.metal} type=${reqAttrs.itemType} brand=${reqAttrs.brand} styles=[${reqStyles.join(", ")}]`);
  console.log(`  survivors after hard + style filter: ${pool.length} of ${products.length}${note}`);
  console.log(`  top 15 by semantic similarity:`);
  for (const { p, score } of ranked.slice(0, 12)) {
    const price = p.price != null ? `$${p.price}` : "—";
    const a = p.attrs;
    console.log(`   ${String(score).padStart(3)}  ${price.padStart(9)}  [brand=${a.brand || "-"} type=${a.itemType || "-"}]  ${p.title}`);
  }
}

await demo("Seiko");
await demo("Grand Seiko");
await demo("Rolex");
await demo("grand seiko snowflake");
await demo("seiko presage automatic"); // title-semantic surfacing on an existing product
process.exit(0);

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

// Everything we need is already in ProductEmbedding (title, price, embedding) —
// no Shopify call required. Hard filter runs off the title.
const rows = (
  await db.query(
    'SELECT "productId", title, price, embedding FROM "ProductEmbedding" WHERE shop=$1',
    [SHOP],
  )
).rows;
await db.end();
console.log(`Loaded ${rows.length} product embeddings`);

const products = rows.map((r) => ({
  id: r.productId,
  title: r.title || "",
  tags: [],
  price: r.price,
  embedding: r.embedding,
}));

async function demo(query) {
  const reqAttrs = extractRequestAttributes({ description: query, keywords: [] });
  const qVec = await embedText(query, "query");

  const survivors = products.filter(
    (p) => passesHardFilters(reqAttrs, extractProductAttributes(p)).pass,
  );
  const ranked = survivors
    .map((p) => ({ p, score: similarityToScore(cosineSimilarity(qVec, p.embedding)) }))
    .sort((a, b) => b.score - a.score);

  console.log(`\n========================================`);
  console.log(`QUERY: "${query}"`);
  console.log(`  request attrs: ${JSON.stringify(reqAttrs)}`);
  console.log(`  hard-filter survivors: ${survivors.length} of ${products.length}`);
  console.log(`  top 15 by semantic similarity:`);
  for (const { p, score } of ranked.slice(0, 15)) {
    const price = p.price != null ? `$${p.price}` : "—";
    console.log(`   ${String(score).padStart(3)}  ${price.padStart(9)}  ${p.title}`);
  }
}

await demo("tiffany heart bracelet");
await demo("cluster ring in yellow gold");
process.exit(0);

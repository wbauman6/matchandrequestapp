import { config } from "dotenv";
config();
import crypto from "node:crypto";
import pkg from "pg";
import {
  embedTexts,
  buildProductText,
  textHash,
  hasEmbeddingKey,
} from "../app/lib/embeddings.server.js";

const SHOP = process.argv[2] || "walter-bauman-jewelers.myshopify.com";
const { Client } = pkg;

if (!hasEmbeddingKey()) {
  console.error("VOYAGE_API_KEY is not set in .env");
  process.exit(1);
}

const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();

const sess = await db.query('SELECT "accessToken" FROM "Session" WHERE shop = $1 LIMIT 1', [SHOP]);
if (!sess.rows.length) {
  console.error("No session for", SHOP);
  process.exit(1);
}
const token = sess.rows[0].accessToken;

const endpoint = `https://${SHOP}/admin/api/2025-10/graphql.json`;
const QUERY = `query($cursor:String){ products(first:250, after:$cursor, query:"status:active"){ pageInfo{hasNextPage endCursor} edges{ node{ id title description productType tags totalInventory priceRangeV2{minVariantPrice{amount}} featuredImage{url} } } } }`;

console.log("Fetching catalog…");
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
  // status:active = available. Estate one-of-a-kind items often have inventory
  // tracking off (totalInventory 0) but are still for sale — include them all.
  for (const { node } of page.edges) {
    const amount = node.priceRangeV2?.minVariantPrice?.amount;
    products.push({
      id: node.id,
      title: node.title,
      description: node.description || "",
      productType: node.productType || "",
      tags: (node.tags || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
      price: amount != null ? parseFloat(amount) : null,
      image: node.featuredImage?.url || null,
    });
  }
  hasNext = page.pageInfo.hasNextPage;
  cursor = page.pageInfo.endCursor;
}
console.log(`In-stock products: ${products.length}`);

const existing = await db.query('SELECT "productId", hash, description FROM "ProductEmbedding" WHERE shop = $1', [SHOP]);
const existingById = new Map(existing.rows.map((e) => [e.productId, e]));

const todo = [];
for (const p of products) {
  const text = buildProductText(p);
  const hash = textHash(text);
  const prev = existingById.get(p.id);
  // Re-process if new/changed OR if we don't yet have the description stored.
  if (!prev || prev.hash !== hash || !prev.description) todo.push({ p, text, hash });
}
console.log(`Need embedding: ${todo.length} (skipping ${products.length - todo.length} unchanged)`);

const UPSERT = `
  INSERT INTO "ProductEmbedding" (id, shop, "productId", hash, embedding, title, description, "productType", price, image, "updatedAt")
  VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, now())
  ON CONFLICT ("productId") DO UPDATE SET
    hash = EXCLUDED.hash, embedding = EXCLUDED.embedding,
    title = EXCLUDED.title, description = EXCLUDED.description,
    "productType" = EXCLUDED."productType",
    price = EXCLUDED.price, image = EXCLUDED.image,
    "updatedAt" = now()`;

const CHUNK = 100;
let done = 0;
for (let i = 0; i < todo.length; i += CHUNK) {
  const slice = todo.slice(i, i + CHUNK);
  const vectors = await embedTexts(slice.map((s) => s.text), "document");
  for (let k = 0; k < slice.length; k++) {
    const s = slice[k];
    await db.query(UPSERT, [
      crypto.randomUUID(),
      SHOP,
      s.p.id,
      s.hash,
      JSON.stringify(vectors[k]),
      s.p.title,
      s.p.description,
      s.p.productType,
      s.p.price,
      s.p.image,
    ]);
  }
  done += slice.length;
  console.log(`  embedded ${done}/${todo.length}`);
}

const total = await db.query('SELECT COUNT(*)::int AS n FROM "ProductEmbedding" WHERE shop = $1', [SHOP]);
console.log(`Done. Stored embeddings for shop: ${total.rows[0].n}`);
await db.end();
process.exit(0);

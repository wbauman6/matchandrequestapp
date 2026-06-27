import { config } from "dotenv";
config();
import crypto from "node:crypto";
import pkg from "pg";
import { embedText, buildRequestText, buildProductText } from "../app/lib/embeddings.server.js";
import { cosineSimilarity } from "../app/lib/matching.js";
import { reasonMatches, confidenceToScore } from "../app/lib/reasoningMatch.server.js";
import { sendNewProductMatchEmail } from "../app/lib/email.server.js";

const SHOP = "walter-bauman-jewelers.myshopify.com";
const SALES_EMAIL = "wbauman6@gmail.com";
const RETRIEVAL_GATE = 0.35;
const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();

// 1) Create a temp ACTIVE saved request (as if a salesperson saved it earlier).
const reqId = "test_kw_" + crypto.randomUUID();
const reqDescription = "grand seiko round dial watch";
await db.query(
  `INSERT INTO "Request" (id, shop, "customerName", "customerEmail", "salespersonName", "salespersonEmail", description, keywords, budget, "createdAt", "updatedAt")
   VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::text[],$8, now(), now())`,
  [reqId, SHOP, "Test Customer", null, "Test Salesperson", SALES_EMAIL, reqDescription, null],
);
console.log("Created active request:", reqDescription, "->", SALES_EMAIL);
const request = { id: reqId, shop: SHOP, description: reqDescription, keywords: [], budget: null, salespersonName: "Test Salesperson", salespersonEmail: SALES_EMAIL, customerName: "Test Customer" };
const reqVec = await embedText(buildRequestText(request), "query");

// 2) Simulate a NEW product arriving via webhook.
const product = {
  id: "gid://shopify/Product/TEST-" + crypto.randomUUID(),
  title: "Estate Grand Seiko SBGA211 Snowflake Automatic Watch",
  description: "Grand Seiko Snowflake automatic Spring Drive men's watch with a round white textured dial and titanium bracelet. Reference SBGA211.",
  tags: [],
  price: 4200,
  image: null,
  active: true,
};
const prodVec = await embedText(buildProductText(product), "document");

// 3) Cosine gate
const sim = cosineSimilarity(reqVec, prodVec);
console.log(`\nStep: cosine(request, new product) = ${sim.toFixed(3)} (gate ${RETRIEVAL_GATE}) -> ${sim >= RETRIEVAL_GATE ? "PASS" : "below gate"}`);

let created = false;
if (sim >= RETRIEVAL_GATE) {
  // 4) AI reasoning
  const matches = await reasonMatches({
    description: request.description,
    budget: request.budget,
    candidates: [{ productId: product.id, title: product.title, description: product.description, price: product.price }],
  });
  const m = matches.find((x) => x.productId === product.id);
  console.log("Step: AI reasoning ->", m ? `${m.confidence.toUpperCase()}: ${m.reason}` : "no match");

  if (m) {
    // 5) Dedupe check + create match row
    const dupe = await db.query('SELECT 1 FROM "Match" WHERE "requestId"=$1 AND "productId"=$2', [reqId, product.id]);
    if (dupe.rowCount) {
      console.log("Step: dedupe -> match already exists, skipping (no re-alert)");
    } else {
      await db.query(
        `INSERT INTO "Match" (id, shop, "requestId", "productId", "productTitle", "productPrice", "productImage", score, "matchedKeywords", "needsReview", reasoning, confidence, "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::text[],$9,$10,$11, now())`,
        [crypto.randomUUID(), SHOP, reqId, product.id, product.title, product.price, null, confidenceToScore(m.confidence), m.confidence !== "high", m.reason, m.confidence],
      );
      created = true;
      console.log("Step: created Match row (needsReview =", m.confidence !== "high", ")");

      // 6) Email the salesperson (only for high-confidence auto-notify)
      if (m.confidence === "high") {
        const { data, error } = await sendNewProductMatchEmail({
          salespersonName: request.salespersonName,
          salespersonEmail: request.salespersonEmail,
          customerName: request.customerName,
          budget: request.budget,
          match: { productTitle: product.title, productPrice: product.price, productImage: null, score: confidenceToScore(m.confidence), matchedKeywords: [], reason: m.reason },
          shop: SHOP,
        }).then((r) => ({ data: r })).catch((e) => ({ error: e }));
        console.log("Step: email ->", error ? "ERROR " + (error.message || error) : "sent to " + SALES_EMAIL);
      } else {
        console.log("Step: email -> skipped (medium/low goes to review queue, no auto-alert)");
      }
    }
  }
}

// Cleanup temp rows
await db.query('DELETE FROM "Match" WHERE "requestId"=$1', [reqId]);
await db.query('DELETE FROM "Request" WHERE id=$1', [reqId]);
console.log("\nCleaned up temp request/match. created=" + created);
await db.end();
process.exit(0);

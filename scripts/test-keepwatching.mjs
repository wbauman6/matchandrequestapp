import { config } from "dotenv";
config();
import crypto from "node:crypto";
import pkg from "pg";
import { embedText, buildRequestText, buildProductText } from "../app/lib/embeddings.server.js";
import { cosineSimilarity } from "../app/lib/matching.js";
import { reasonMatches, confidenceToScore } from "../app/lib/reasoningMatch.server.js";

const SHOP = "walter-bauman-jewelers.myshopify.com";
const SALES_EMAIL = "wbauman6@gmail.com";
const RETRIEVAL_GATE = 0.35;
const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
try {
  await db.connect();
} catch (err) {
  console.log("SKIP: database unreachable from this network (" + (err?.code || err?.message) + ")");
  process.exit(0);
}

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
  let matches;
  try {
    matches = await reasonMatches({
      description: request.description,
      budget: request.budget,
      candidates: [{ productId: product.id, title: product.title, description: product.description, price: product.price }],
    });
  } catch (err) {
    if (err?.status === 400 || err?.status === 401 || err?.status === 403 || err?.budgetExceeded) {
      console.log("SKIP: Anthropic unavailable (" + (err?.status || "budget") + ") — cannot live-test reasoning");
      await db.query('DELETE FROM "Request" WHERE id=$1', [reqId]);
      await db.end();
      process.exit(0);
    }
    throw err;
  }
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

      // 6) No email — matches are announced only by the scheduled digest
      // (/api/digest, Mon+Thu). This match would appear in the next digest.
      console.log("Step: email -> none (digest-only policy; surfaces in next scheduled digest)");
    }
  }
}

// Cleanup temp rows
await db.query('DELETE FROM "Match" WHERE "requestId"=$1', [reqId]);
await db.query('DELETE FROM "Request" WHERE id=$1', [reqId]);
console.log("\nCleaned up temp request/match. created=" + created);
await db.end();
process.exit(0);

import { config } from "dotenv";
config();
import pkg from "pg";
import { embedText } from "../app/lib/embeddings.server.js";
import { cosineSimilarity } from "../app/lib/matching.js";
import { reasonMatches, verifyMatch } from "../app/lib/reasoningMatch.server.js";
import { cleanRequestText } from "../app/lib/requestClean.js";

const SHOP = "walter-bauman-jewelers.myshopify.com";
const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();
const rows = (
  await db.query('SELECT "productId", title, description, price, embedding FROM "ProductEmbedding" WHERE shop=$1', [SHOP])
).rows;
await db.end();
const byId = new Map(rows.map((r) => [r.productId, r]));

async function retrieve(queryText, k) {
  const qv = await embedText(queryText, "query");
  return rows
    .map((p) => ({ p, sim: cosineSimilarity(qv, p.embedding) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
}

async function pass(query, { clean, k }) {
  const text = clean ? cleanRequestText(query) : query;
  const ranked = await retrieve(text, k);
  const candidates = ranked.map(({ p }) => ({ productId: p.productId, title: p.title, description: p.description, price: p.price }));
  let matches = await reasonMatches({ description: query, budget: null, candidates });
  let dropped = [];
  if (clean) {
    const checked = await Promise.all(
      matches.map(async (m) => {
        const c = candidates.find((x) => x.productId === m.productId);
        const v = await verifyMatch({ description: query, product: c });
        if (v && v.match === false) { dropped.push({ m, reason: v.reason }); return null; }
        return m;
      }),
    );
    matches = checked.filter(Boolean);
  }
  return { text, count: matches.length, matches, dropped };
}

function line(m) {
  const p = byId.get(m.productId);
  return `  [${m.confidence}] ${p?.title?.slice(0, 64)}`;
}

for (const query of [
  "designer collection stunning tiffany bracelet",
  "seiko dive watch with blue dial",
  "14k WG diamond cluster engagement ring",
]) {
  console.log(`\n################ "${query}" ################`);
  const before = await pass(query, { clean: false, k: 30 });
  console.log(`\n--- BEFORE (raw query, top 30, no double-check): ${before.count} matches ---`);
  before.matches.slice(0, 12).forEach((m) => console.log(line(m)));

  const after = await pass(query, { clean: true, k: 50 });
  console.log(`\n--- AFTER (cleaned: "${after.text}", top 50, + double-check): ${after.count} matches ---`);
  after.matches.slice(0, 12).forEach((m) => console.log(line(m)));
  if (after.dropped.length) {
    console.log(`  dropped by double-check (${after.dropped.length}):`);
    after.dropped.slice(0, 8).forEach(({ m, reason }) => console.log(`    ✗ ${byId.get(m.productId)?.title?.slice(0, 56)} — ${reason?.slice(0, 70)}`));
  }
}
process.exit(0);

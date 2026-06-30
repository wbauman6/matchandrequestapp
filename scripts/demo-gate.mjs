import { config } from "dotenv";
config();
import pkg from "pg";
import Anthropic from "@anthropic-ai/sdk";
import { embedText } from "../app/lib/embeddings.server.js";
import { cosineSimilarity } from "../app/lib/matching.js";
import { reasonMatches, verifyMatch } from "../app/lib/reasoningMatch.server.js";
import { cleanRequestText } from "../app/lib/requestClean.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// "Before" = the previous verify prompt (no setting gate, looser).
const OLD = `You are an expert jeweler doing a final check on ONE proposed match. Given a request and ONE product (title+description), decide whether to show it. KEEP if right brand (if named), right item type, right key attribute (dial color/gemstone). Do NOT reject for different metal, lab-grown vs natural, or missing sub-type like "dive". REJECT only if clearly the wrong item. Respond ONLY JSON: {"match": true|false, "reason": "short"}`;
function parse(r) { const s = r.indexOf("{"), e = r.lastIndexOf("}"); try { return JSON.parse(r.slice(s, e + 1)); } catch { return null; } }
async function verifyOld(description, p) {
  const r = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 150, system: OLD, messages: [{ role: "user", content: `Request: "${description}"\nProduct: ${JSON.stringify(p.title)} — ${JSON.stringify((p.description || "").slice(0, 900))}\nJSON.` }] });
  const j = parse(r.content[0].text); return !(j && j.match === false);
}

const SHOP = "walter-bauman-jewelers.myshopify.com";
const { Client } = pkg;
const db = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });
await db.connect();
const rows = (await db.query('SELECT "productId", title, description, price, embedding FROM "ProductEmbedding" WHERE shop=$1', [SHOP])).rows;
await db.end();
const byId = new Map(rows.map((r) => [r.productId, r]));
const setting = (t) => (/cluster/i.test(t) ? "CLUSTER" : /solitaire/i.test(t) ? "SOLITAIRE" : /\bhalo\b/i.test(t) ? "HALO" : /eternity/i.test(t) ? "ETERNITY" : /tennis/i.test(t) ? "TENNIS" : "—");

async function run(query) {
  const qv = await embedText(cleanRequestText(query), "query");
  const ranked = rows.map((p) => ({ p, sim: cosineSimilarity(qv, p.embedding) })).sort((a, b) => b.sim - a.sim).slice(0, 50);
  const cands = ranked.map(({ p }) => ({ productId: p.productId, title: p.title, description: p.description, price: p.price }));
  const matches = await reasonMatches({ description: query, budget: null, candidates: cands });
  const after = [], dropped = [];
  await Promise.all(matches.map(async (m) => {
    const c = byId.get(m.productId);
    const n = await verifyMatch({ description: query, product: c });
    if (n && n.match !== false) after.push(c); else dropped.push({ c, reason: n?.reason });
  }));
  console.log(`\n######## "${query}" ########`);
  console.log(`reasoning proposed ${matches.length}  →  AFTER setting-gate kept ${after.length}`);
  after.slice(0, 10).forEach((c) => console.log(`   [${setting(c.title)}] ${c.title.slice(0, 58)}`));
  if (dropped.length) { console.log("dropped by gate:"); dropped.slice(0, 6).forEach(({ c, reason }) => console.log(`   ✗ [${setting(c.title)}] ${c.title.slice(0, 44)} — ${(reason || "").slice(0, 52)}`)); }
}
for (const q of ["14K lab grown diamond cluster ring", "14K diamond cluster ring", "diamond solitaire engagement ring", "cluster ring", "diamond ring"]) await run(q);
process.exit(0);

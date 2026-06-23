import { config } from "dotenv";
config();
import { readFileSync, writeFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

const tags = JSON.parse(readFileSync("all_tags.json", "utf8"));
const noPrefix = tags.filter((t) => !/^[a-z0-9 ]+:/i.test(t));

// Pre-filter obvious operational junk so we don't waste tokens on it.
const isJunk = (t) =>
  /^batch#/i.test(t) ||
  /^created /i.test(t) ||
  /\d+offer$/i.test(t) ||
  /^app$/i.test(t) ||
  /^none$/i.test(t) ||
  /^\*?discontinued$/i.test(t) ||
  /^\d{2}-\d{2}-\d{2,4}$/.test(t);

const toClassify = noPrefix.filter((t) => !isJunk(t));
const prefilteredJunk = noPrefix.filter(isJunk);
console.log(
  `no-prefix=${noPrefix.length} prefilteredJunk=${prefilteredJunk.length} toClassify=${toClassify.length}`,
);

const SYSTEM = `You categorize jewelry-store product tags for a search engine. For each tag, output exactly one category:

- item_type: what kind of item it is (ring, necklace, earrings, watch, pendant, bracelet, brooch, charm, coin, cufflinks, etc.) including phrases like "Estate Diamond Earrings", "ladies watch", "eternity band".
- brand: a maker/brand/designer name (Rolex, Cartier, Tiffany & Co., Disney, David Yurman, etc.).
- motif: a decorative theme/shape/subject (cross, hebrew/Star of David, heart, snowflake, animal, flower, anchor, etc.).
- material: metal or base material (gold, 14K, sterling, platinum, stainless, enamel, etc.).
- gemstone: a gemstone/stone type (diamond, sapphire, emerald, ruby, jade, pearl, opal, etc.).
- model: a specific watch model name (Datejust, Submariner, Air King, etc.).
- descriptive: anything else that only refines preference (color, size, cut, clarity, era, condition, occasion, certificate, finish, setting, gender, "vintage", "estate", etc.).
- junk: operational/inventory noise that is not a real product attribute (batch codes, internal notes, "app", "none", "consignment", "misc", seller codes, quantities).

Respond with ONLY a JSON object mapping each input tag (verbatim) to its category. No other text.`;

async function classifyBatch(batch) {
  const user = `Categorize these tags. Return JSON {"<tag>": "<category>", ...} for every tag.\n\n${JSON.stringify(batch)}`;
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(s, e + 1));
}

const BATCH = 120;
const result = {};
for (const t of prefilteredJunk) result[t] = "junk";

for (let i = 0; i < toClassify.length; i += BATCH) {
  const batch = toClassify.slice(i, i + BATCH);
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    try {
      const map = await classifyBatch(batch);
      for (const t of batch) result[t] = map[t] || "descriptive";
      ok = true;
    } catch (err) {
      console.error(`batch ${i} attempt ${attempt} failed:`, err.message);
    }
  }
  if (!ok) for (const t of batch) result[t] = "descriptive";
  console.log(`classified ${Math.min(i + BATCH, toClassify.length)}/${toClassify.length}`);
}

writeFileSync("noprefix_categories.json", JSON.stringify(result, null, 2));

// Summary
const counts = {};
for (const c of Object.values(result)) counts[c] = (counts[c] || 0) + 1;
console.log("CATEGORY COUNTS:", JSON.stringify(counts, null, 2));

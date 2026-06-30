import Anthropic from "@anthropic-ai/sdk";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are an expert jeweler matching a customer's special-order request against in-stock inventory. Given the request and candidate products (title + description), decide which genuinely satisfy it.

Apply real jewelry knowledge:
- Brands are distinct: "Grand Seiko" is NOT "Seiko"; "Tiffany & Co." is a specific brand, not any heart-shaped jewelry.
- Metal colors are not interchangeable: yellow vs white vs rose gold; two-tone is its own thing.
- Settings/constructions differ: cluster vs solitaire vs halo vs three-stone vs pavé vs tennis.
- Item types differ: ring vs bracelet vs necklace vs pendant vs earrings vs watch.

Rules:
- EXCLUDE any candidate that violates a clear, explicit requirement in the request (wrong metal, wrong brand, wrong item type, wrong stone, or clearly over an explicit budget).
- Do not over-apply vague or aesthetic terms (e.g. "elegant", "classic", "dainty") — those shade preference, not hard requirements.
- Rank results most-relevant first (high before medium before low).
- If nothing is a strong match, STILL return the closest candidates as medium/low confidence rather than an empty list — but never include candidates that clearly violate an explicit requirement.

CRITICAL OUTPUT RULE: Respond with ONLY the JSON object — no preamble, no analysis, no per-candidate commentary, no markdown fences. Your message must begin with "{" and contain nothing but the JSON:
{"matches":[{"product_id":"<id>","confidence":"high|medium|low","reason":"one sentence"}]}`;

function parseJsonObject(raw) {
  if (!raw) return null;
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * AI reasoning pass. `candidates` = [{ productId, title, description, price }].
 * Returns [{ productId, confidence, reason }] ranked high→low, filtered to the
 * provided candidate ids. Returns [] on failure (caller falls back to retrieval
 * order so the screen is never empty).
 */
export async function reasonMatches({ description, budget, candidates }) {
  const c = getClient();
  if (!c || !candidates?.length) return [];

  const list = candidates.map((p) => ({
    product_id: p.productId,
    title: p.title || "",
    description: (p.description || "").slice(0, 1200),
    price: p.price ?? null,
  }));

  const user = `Customer request: "${description}"
Budget: ${budget != null ? "$" + budget : "not specified"}

Candidate products (${list.length}):
${JSON.stringify(list)}

Return the JSON verdict now.`;

  let resp;
  try {
    resp = await c.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
  } catch (err) {
    console.error("reasonMatches API error:", err?.message || err);
    return [];
  }

  const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
  const parsed = parseJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.matches)) {
    console.error("reasonMatches: unparseable response:", raw.slice(0, 300));
    return [];
  }

  const validIds = new Set(candidates.map((p) => p.productId));
  const rank = { high: 0, medium: 1, low: 2 };
  return parsed.matches
    .filter((m) => validIds.has(m.product_id))
    .map((m) => ({
      productId: m.product_id,
      confidence: ["high", "medium", "low"].includes(m.confidence) ? m.confidence : "low",
      reason: typeof m.reason === "string" ? m.reason : "",
    }))
    .sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}

// Map confidence to a 0-100 score for storage/sorting/display.
export function confidenceToScore(confidence) {
  return confidence === "high" ? 90 : confidence === "medium" ? 60 : 35;
}

// The verification pass enforces nuanced rules (setting gates hard, but
// metal/lab-grown are soft) — Sonnet follows that nuance far more reliably than
// Haiku, and the calls run in parallel so latency stays ~one call.
const VERIFY_MODEL = "claude-sonnet-4-6";

const VERIFY_SYSTEM = `You are an expert jeweler doing a final check on ONE proposed match. You are given a customer's request and ONE product (title + description). Decide whether it should be shown to the customer.

STEP 1 — DEFINING-SETTING GATE (check this FIRST, before anything else):
A "defining setting" is the item's specific form/construction/setting, e.g.: cluster, solitaire, halo, three-stone, eternity, tennis, signet, pavé, channel-set, bezel-set, stud, hoop, huggie, riviera. These are MUTUALLY EXCLUSIVE and must NOT be treated as interchangeable: a halo is NOT a cluster; a three-stone is NOT a cluster; a solitaire is NOT a cluster; a bypass/five-stone/row ring is NOT a cluster. Match the EXACT setting named.
- If the request NAMES a defining setting, the product MUST genuinely have that exact setting. If it does NOT (or it is a different/adjacent setting like halo vs cluster), respond match=false and STOP. Reject it no matter how well everything else matches — a strong match on metal, stone type, lab-grown vs natural, brand, or price does NOT compensate for the wrong/missing setting.
- If the request does NOT name any defining setting, SKIP this gate entirely — do not require or invent one.

STEP 2 — only for products that passed Step 1, apply the rest:
- BRAND: if the request names a brand, the product must be that brand (Grand Seiko is NOT Seiko; Tiffany & Co. is specific).
- ITEM TYPE: must match (a watch for a watch request, a ring for a ring request, a bracelet for a bracelet request).
- METAL COLOR/TYPE: if the request names a metal, the product must be the SAME metal color/type. Yellow gold, white gold, rose gold, sterling silver, and platinum are DISTINCT and NOT interchangeable — reject a wrong one. BUT karat/purity is NOT a requirement: a 14K request is satisfied by 10K/18K of the SAME color — never reject on karat alone.
- KEY ATTRIBUTE: must match the customer's main explicitly-stated attribute — e.g. dial color or primary gemstone type.

PREFERENCES ONLY — never reject for these, even when the customer named them:
- KARAT / purity (10K vs 14K vs 18K of the same color);
- LAB-GROWN vs NATURAL stone origin — a NATURAL-diamond product fully satisfies a "lab grown" request, and vice versa; origin only changes ranking. (Example: request "14K lab grown diamond cluster ring", product is a NATURAL diamond cluster → KEEP, because the cluster setting matches and lab-grown is only a preference.)
- a missing SUB-TYPE qualifier (e.g. "dive" watch, "dress" watch).

REJECT (match=false) when: wrong/missing defining setting (Step 1), wrong brand, wrong item type, wrong metal color/type, or wrong key attribute. Do NOT reject for karat or lab-grown-vs-natural alone.

Respond with ONLY a JSON object, no other text:
{"match": true|false, "reason": "one short sentence"}`;

// Defining settings recognized in a request, for the dedicated strict gate.
// >>> EDIT THIS LIST to add/remove defining settings the gate enforces. <<<
const SETTING_PATTERNS = [
  ["cluster", /\bclusters?\b/i],
  ["solitaire", /\bsolitaires?\b/i],
  ["halo", /\bhalo\b/i],
  ["three-stone", /\b(?:three[\s-]?stone|3[\s-]?stone)\b/i],
  ["eternity", /\beternity\b/i],
  ["tennis", /\btennis\b/i],
  ["signet", /\bsignets?\b/i],
  ["pave", /\bpav[eé]\b/i],
  ["channel-set", /\bchannel[\s-]?set\b/i],
  ["bezel", /\bbezel\b/i],
  ["stud", /\bstuds?\b/i],
  ["hoop", /\bhoops?\b/i],
  ["huggie", /\bhuggies?\b/i],
  ["riviera", /\briviera\b/i],
];

// Which defining settings does the request explicitly name?
export function namedSettings(text) {
  const t = String(text || "");
  return SETTING_PATTERNS.filter(([, re]) => re.test(t)).map(([s]) => s);
}

const SETTING_SYSTEM = `You check ONE thing only: does a jewelry product have a specific SETTING/construction?

Defining settings are MUTUALLY EXCLUSIVE and NOT interchangeable: cluster, solitaire, halo (including "hidden halo"), three-stone, eternity, tennis, signet, pavé, channel-set, bezel, stud, hoop, huggie, riviera, bypass, five-stone/row.
Key distinctions to enforce strictly:
- A halo (including HIDDEN HALO) is NOT a cluster.
- A three-stone is NOT a cluster. A bypass/crossover, a five-stone, or a row/line ring is NOT a cluster.
- A solitaire is NOT a cluster, halo, or three-stone.

Respond with ONLY a JSON object: {"match": true|false, "reason": "one short sentence"}`;

/**
 * Strict setting-only gate. Returns { match } — true only if the product
 * genuinely has ALL the required settings. Used as a second pass to tighten
 * cluster-adjacent leaks (e.g. hidden halo passing for cluster). On error
 * returns { match: true } so a transient failure doesn't drop a good match.
 */
export async function verifySetting({ product, settings }) {
  const c = getClient();
  if (!c || !settings || settings.length === 0) return { match: true };
  const user = `Required setting(s): ${settings.join(", ")}.

Product:
- Title: ${JSON.stringify(product.title || "")}
- Description: ${JSON.stringify((product.description || "").slice(0, 1200))}

Does this product genuinely have ${settings.length > 1 ? "ALL of" : ""} the required setting(s) "${settings.join(", ")}"? Return the JSON now.`;
  try {
    const resp = await c.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 200,
      system: SETTING_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed.match !== "boolean") return { match: true };
    return { match: parsed.match, reason: parsed.reason };
  } catch (err) {
    console.error("verifySetting error:", err?.message || err);
    return { match: true };
  }
}

/**
 * Per-match verification (the double-check). Evaluates ONE product against the
 * request in isolation — stricter than judging 30 at once. Returns
 * { match: boolean, reason } or null on failure (caller keeps the item if the
 * check couldn't run, to avoid dropping good matches on a transient error).
 */
export async function verifyMatch({ description, product }) {
  const c = getClient();
  if (!c) return null;
  const user = `Customer request: "${description}"

Product:
- Title: ${JSON.stringify(product.title || "")}
- Description: ${JSON.stringify((product.description || "").slice(0, 1200))}
${product.price != null ? `- Price: $${product.price}` : ""}

Does this specific product genuinely satisfy this specific request? Return the JSON now.`;

  try {
    const resp = await c.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 200,
      system: VERIFY_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed.match !== "boolean") return null;
    return { match: parsed.match, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
  } catch (err) {
    console.error("verifyMatch error:", err?.message || err);
    return null;
  }
}

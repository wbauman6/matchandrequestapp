import Anthropic from "@anthropic-ai/sdk";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // maxRetries low: matching no longer fires concurrent bursts, so rate-limit
  // retries would just be wasted spend.
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return client;
}

const MODEL = "claude-sonnet-4-6";

export const SYSTEM = `You are an expert jeweler matching a customer's special-order request against candidate inventory. You are given the request and a list of candidate products (title + description). Return ONLY the candidates that genuinely satisfy the request, applying STRICT attribute-by-attribute gating. This single pass is the final decision — be as rigorous per item as if you were checking each one individually.

ATTRIBUTE-BY-ATTRIBUTE GATING:
- Every attribute the customer SPECIFIES is an INDEPENDENT HARD requirement. A candidate must satisfy it or be EXCLUDED.
- Every attribute the customer does NOT specify is UNCONSTRAINED — ignore it; never exclude on it (all variants are acceptable).
- ALL specified attributes must pass together (AND). A strong match on one specified attribute NEVER compensates for failing another. An unspecified attribute NEVER excludes.

Attributes (check only those the customer actually specified):
• SETTING/form — cluster, solitaire, halo, three-stone, eternity, tennis, signet, pavé, channel-set, bezel, stud, hoop, huggie, riviera. MUTUALLY EXCLUSIVE and NOT interchangeable: a halo (incl. "hidden halo") is NOT a cluster; a three-stone is NOT a cluster; a bypass/five-stone/row ring is NOT a cluster; a solitaire is NOT a cluster.
• METAL COLOR — yellow / white / rose / two-tone (DISTINCT; yellow gold ≠ white gold ≠ rose gold ≠ two-tone).
• METAL TYPE — gold vs platinum vs sterling silver vs steel (DISTINCT).
• DIAMOND/STONE ORIGIN — natural vs lab-grown (a.k.a. lab-created / lab grown / man-made / synthetic).
• ITEM TYPE — ring / bracelet / necklace / pendant / earrings / watch / brooch, etc.
• BRAND — e.g. Tiffany & Co., Cartier, Rolex, Grand Seiko (Grand Seiko is NOT Seiko).
• PRIMARY GEMSTONE TYPE — diamond / sapphire / ruby / emerald / pearl, etc.
• (Watches) DIAL COLOR.

KARAT IS NOT A GATE: karat/purity (10K vs 14K vs 18K) is never a hard requirement — a "14K yellow gold" request is satisfied by an 18K yellow gold item (same color/type). Only metal COLOR and metal TYPE gate; never karat.

Do NOT over-apply vague/aesthetic terms ("elegant", "classic", "dainty") — those shade ranking, they are not gates.

For EACH candidate: exclude it if it fails ANY specified attribute; otherwise include it. Rank included matches high → medium → low by overall fit. If nothing passes, STILL return the closest 1-3 as low confidence (never an empty list), but NEVER include a candidate that fails a specified attribute gate.

CRITICAL OUTPUT RULE: Respond with ONLY the JSON object — no preamble, no analysis, no per-candidate commentary, no markdown fences. Begin with "{" and output nothing but:
{"matches":[{"product_id":"<id>","confidence":"high|medium|low","reason":"one sentence naming the specified attributes it satisfies"}]}`;

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

export const BATCH_VERIFY_SYSTEM = `You are an expert jeweler doing a STRICT final check on a set of proposed matches. You are given a customer's request and a LIST of products (title + description). Judge EACH product independently and decide whether it genuinely satisfies the request.

Apply attribute-by-attribute gating to EACH product:
- Every attribute the customer SPECIFIES is an INDEPENDENT HARD requirement — the product must satisfy it or be match=false. Every attribute NOT specified is unconstrained (ignore it). ALL specified attributes must pass together (AND); a strong match on one never compensates for failing another.
- Specifiable attributes: SETTING/form (cluster, solitaire, halo, three-stone, eternity, tennis, signet, pavé, channel-set, bezel, stud, hoop, huggie, riviera — MUTUALLY EXCLUSIVE: a halo incl. "hidden halo" is NOT a cluster; three-stone is NOT a cluster; bypass/five-stone/row is NOT a cluster; solitaire is NOT a cluster); METAL COLOR (yellow/white/rose/two-tone — distinct); METAL TYPE (gold/platinum/sterling silver/steel — distinct); DIAMOND/STONE ORIGIN (natural vs lab-grown); ITEM TYPE (ring/bracelet/necklace/pendant/earrings/watch...); BRAND (Grand Seiko ≠ Seiko); PRIMARY GEMSTONE TYPE; (watches) DIAL COLOR.
- KARAT IS NOT A GATE: 10K/14K/18K never gates — a "14K yellow gold" request is satisfied by 18K yellow gold. Only metal COLOR and metal TYPE gate.

Respond with ONLY a JSON object (begin with "{", no other text) giving a verdict for EVERY product id provided:
{"results":[{"product_id":"<id>","match":true|false,"reason":"one short sentence"}]}`;

/**
 * Batched double-check: verifies ALL proposed matches in ONE Sonnet call (same
 * strict attribute+setting gating as the per-item pass). Returns a Set of
 * productIds that PASS. On failure returns all ids (don't drop on transient error).
 */
export async function verifyBatch({ description, candidates }) {
  const c = getClient();
  const allIds = new Set((candidates || []).map((p) => p.productId));
  if (!c || !candidates?.length) return allIds;
  const list = candidates.map((p) => ({
    product_id: p.productId,
    title: p.title || "",
    description: (p.description || "").slice(0, 900),
  }));
  const user = `Customer request: "${description}"

Products to check (${list.length}):
${JSON.stringify(list)}

Return a verdict for every product id. Return the JSON now.`;
  try {
    const resp = await c.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 4000,
      system: BATCH_VERIFY_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = parseJsonObject(raw);
    if (!parsed || !Array.isArray(parsed.results)) return allIds;
    const pass = new Set();
    for (const rrr of parsed.results) {
      if (allIds.has(rrr.product_id) && rrr.match !== false) pass.add(rrr.product_id);
    }
    // Any id the model omitted → keep (avoid dropping on incomplete output).
    for (const id of allIds) if (!parsed.results.some((x) => x.product_id === id)) pass.add(id);
    return pass;
  } catch (err) {
    console.error("verifyBatch error:", err?.message || err);
    return allIds;
  }
}

// Map confidence to a 0-100 score for storage/sorting/display.
export function confidenceToScore(confidence) {
  return confidence === "high" ? 90 : confidence === "medium" ? 60 : 35;
}

// The verification pass enforces nuanced rules (setting gates hard, but
// metal/lab-grown are soft) — Sonnet follows that nuance far more reliably than
// Haiku, and the calls run in parallel so latency stays ~one call.
const VERIFY_MODEL = "claude-sonnet-4-6";

export const VERIFY_SYSTEM = `You are an expert jeweler doing a final check on ONE proposed match. You are given a customer's request and ONE product (title + description).

CORE PRINCIPLE — attribute-by-attribute gating:
- Every attribute the customer SPECIFIES is an INDEPENDENT HARD requirement (a gate). The product must satisfy it or be rejected.
- Every attribute the customer does NOT specify is UNCONSTRAINED — ignore it completely; never use it to reject (show all variants).
- ALL specified gates must pass together (AND logic). A strong match on one specified attribute NEVER compensates for failing another. An unspecified attribute NEVER excludes.

PROCEDURE:
1) First, identify which of these attributes the customer EXPLICITLY specified in the request:
   • SETTING/form — cluster, solitaire, halo, three-stone, eternity, tennis, signet, pavé, channel-set, bezel, stud, hoop, huggie, riviera. These are MUTUALLY EXCLUSIVE and NOT interchangeable: a halo (incl. "hidden halo") is NOT a cluster; a three-stone is NOT a cluster; a bypass/five-stone/row ring is NOT a cluster; a solitaire is NOT a cluster.
   • METAL COLOR — yellow, white, rose, or two-tone. These are DISTINCT (yellow gold ≠ white gold ≠ rose gold ≠ two-tone).
   • METAL TYPE — gold vs platinum vs sterling silver vs steel, etc. (These are DISTINCT.)
   • DIAMOND/STONE ORIGIN — natural vs lab-grown (also called lab-created / lab grown / man-made / synthetic).
   • ITEM TYPE — ring, bracelet, necklace, pendant, earrings, watch, brooch, etc.
   • BRAND — e.g. Tiffany & Co., Cartier, Rolex, Grand Seiko (Grand Seiko is NOT Seiko).
   • PRIMARY GEMSTONE TYPE — diamond, sapphire, ruby, emerald, pearl, etc.
   • (Watches) DIAL COLOR.
2) For EACH specified attribute, check the product independently against it.
3) If the product fails ANY single specified attribute, respond match=false (name the failing attribute in the reason).
4) IGNORE every attribute the customer did NOT specify — do not require or infer it; all variants of an unspecified attribute are acceptable.

KARAT IS NOT A GATE: karat/purity (10K vs 14K vs 18K) is never a hard requirement — a "14K yellow gold" request is satisfied by an 18K yellow gold item (same color/type). Only reject on metal COLOR or metal TYPE, never on karat.

Examples:
- "gold cluster lab grown ring" → specified: setting=cluster, origin=lab-grown, type=ring (and gold as metal type). NOT specified: metal color, karat. So: require cluster AND lab-grown AND ring; accept ANY gold color; reject natural; reject non-clusters.
- "white gold diamond ring" → specified: metal color=white, metal type=gold, stone=diamond, type=ring. NOT specified: setting, origin. So: require white gold diamond ring; accept any setting and natural OR lab-grown.
- "diamond ring" → specified: stone=diamond, type=ring only. Accept any setting, any color, any origin, any karat.

Respond with ONLY a JSON object: {"match": true|false, "reason": "one short sentence: name the specified attribute that failed, or confirm all specified attributes passed"}`;

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

export const SETTING_SYSTEM = `You check ONE thing only: does a jewelry product have a specific SETTING/construction?

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

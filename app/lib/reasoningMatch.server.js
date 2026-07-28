import Anthropic from "@anthropic-ai/sdk";
import { metalToneRules } from "./metalTone.js";
import { relatedTermsGuidance, normalizeProductTerms } from "./jewelryTerms.js";
import { trackAiCall, AiBudgetExceededError } from "./aiBudget.server.js";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // maxRetries low: matching no longer fires concurrent bursts, so rate-limit
  // retries would just be wasted spend.
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return client;
}

const MODEL = "claude-sonnet-4-6";

// Is this error worth retrying? Only transient conditions: rate limits,
// overload/5xx, timeouts, network drops, and unparseable/truncated model
// output. Permanent failures (bad key, out of credits, bad request) and the
// daily budget kill switch fail IMMEDIATELY — retrying them just multiplies
// calls (the July 13 runaway retried out-of-credit 400s 3× each).
function isRetryable(err) {
  if (err instanceof AiBudgetExceededError || err?.budgetExceeded) return false;
  const status = err?.status;
  if (status == null) return true; // network error or our parse-failure Error
  if (status === 429 || status === 408 || status >= 500) return true; // incl. 529 overloaded
  return false; // 400/401/403/404… — permanent, don't retry
}

// Retry a flaky async op (transient API error, overload, or an unparseable /
// truncated model response) with exponential backoff + jitter. Non-retryable
// errors are rethrown immediately. Throws the last error if every attempt
// fails, so callers can distinguish "failed" from a genuine empty result.
async function withRetry(fn, { tries = 3, base = 600, label = "op" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (i < tries - 1) {
        const delay = base * 2 ** i + Math.floor(Math.random() * base);
        console.warn(`[${label}] attempt ${i + 1}/${tries} failed (${err?.message || err}); retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export const SYSTEM = `You are an expert jeweler matching a customer's special-order request against candidate inventory. You are given the request and a list of candidate products (title + description). Return ONLY the candidates that genuinely satisfy the request, applying STRICT attribute-by-attribute gating. This single pass is the final decision — be as rigorous per item as if you were checking each one individually.

ATTRIBUTE-BY-ATTRIBUTE GATING:
- Every attribute the customer SPECIFIES is an INDEPENDENT HARD requirement. A candidate must satisfy it or be EXCLUDED.
- Every attribute the customer does NOT specify is UNCONSTRAINED — ignore it; never exclude on it (all variants are acceptable).
- ALL specified attributes must pass together (AND). A strong match on one specified attribute NEVER compensates for failing another. An unspecified attribute NEVER excludes.

Attributes (check only those the customer actually specified):
• SETTING/form — cluster, solitaire, halo, three-stone, eternity, tennis, signet, pavé, channel-set, bezel, stud, hoop, huggie, riviera. MUTUALLY EXCLUSIVE and NOT interchangeable: a halo (incl. "hidden halo") is NOT a cluster; a three-stone is NOT a cluster; a bypass/five-stone/row ring is NOT a cluster; a solitaire is NOT a cluster.
• METAL / TONE — apply the METAL vs TONE rules below.
• DIAMOND/STONE ORIGIN — natural vs lab-grown (a.k.a. lab-created / lab grown / man-made / synthetic). CRITICAL: an unqualified "diamond" / "DIA" request does NOT imply natural — treat origin as UNSPECIFIED and show BOTH natural AND lab-grown. Exclude one ONLY when the customer explicitly writes "natural" (→ exclude lab-grown) or "lab" / "lab grown" / "lab-created" / "man-made" (→ exclude natural). Never default to natural.
• ITEM TYPE — ring / bracelet / necklace / pendant / earrings / watch / brooch, etc.
• BRAND — e.g. Tiffany & Co., Cartier, Rolex, Grand Seiko (Grand Seiko is NOT Seiko).
• PRIMARY GEMSTONE TYPE — diamond / sapphire / ruby / emerald / pearl, etc.
• (Watches) DIAL COLOR.

${metalToneRules()}

Do NOT over-apply vague/aesthetic terms ("elegant", "classic", "dainty") — those shade ranking, they are not gates.

${relatedTermsGuidance()}

For EACH candidate: exclude it if it fails ANY specified attribute; otherwise include it. Rank included matches high → medium → low by overall fit.

ZERO MATCHES IS A VALID, CORRECT ANSWER. If NO candidate passes every specified attribute, return an EMPTY matches array. NEVER substitute across a specified attribute (e.g. never return a natural-diamond ring for a lab-grown request, or a white-gold ring for a yellow-gold request) just to avoid an empty result. Never include a candidate that fails a specified attribute gate.

CRITICAL OUTPUT RULE: Respond with ONLY the JSON object — no preamble, no analysis, no per-candidate commentary, no markdown fences. Begin with "{" and output nothing but the JSON (an empty result is exactly {"matches":[]}):
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
 * provided candidate ids. An EMPTY array is a valid "nothing matched" result.
 * THROWS if the API call or response parsing fails on every retry, so the caller
 * can record an error state (and never mistake a transient failure for "0 in
 * stock"). Returns [] only when there's no client/candidates (a real empty).
 */
export async function reasonMatches({ description, budget, candidates }) {
  const c = getClient();
  if (!c || !candidates?.length) return [];

  const list = candidates.map((p) => ({
    product_id: p.productId,
    // Normalize phrase synonyms so the product speaks the same canonical
    // vocabulary as the normalized request ("by the yard"→"station"). Only
    // "both"-scope equivalents apply — never the request-only abbreviations.
    title: normalizeProductTerms(p.title || ""),
    // Full description — no truncation. Estate listings bury the spec table
    // (Brand, metal, dial color, stone) at the END of a long description; a cap
    // hid it (e.g. "Brand:Grand Seiko" at char ~2300 on the Omiwatari), making
    // the AI gate on the misleading title alone.
    description: normalizeProductTerms(p.description || ""),
    price: p.price ?? null,
  }));

  const user = `Customer request: "${description}"
Budget: ${budget != null ? "$" + budget : "not specified"}

Candidate products (${list.length}):
${JSON.stringify(list)}

Return the JSON verdict now.`;

  const parsed = await withRetry(
    async () => {
      await trackAiCall(); // daily cost kill switch — throws when over budget
      const resp = await c.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      });
      const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
      const obj = parseJsonObject(raw);
      if (!obj || !Array.isArray(obj.matches)) {
        // Truncated (stop_reason "max_tokens") or non-JSON output — retry rather
        // than silently returning an empty (false "no matches") result.
        throw new Error(`unparseable response (stop=${resp.stop_reason}): ${raw.slice(0, 120)}`);
      }
      return obj;
    },
    { tries: 3, label: "reasonMatches" },
  );

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
- Specifiable attributes: SETTING/form (cluster, solitaire, halo, three-stone, eternity, tennis, signet, pavé, channel-set, bezel, stud, hoop, huggie, riviera — MUTUALLY EXCLUSIVE: a halo incl. "hidden halo" is NOT a cluster; three-stone is NOT a cluster; bypass/five-stone/row is NOT a cluster; solitaire is NOT a cluster); METAL/TONE (see the rules below); DIAMOND/STONE ORIGIN (natural vs lab-grown); ITEM TYPE (ring/bracelet/necklace/pendant/earrings/watch...); BRAND (Grand Seiko ≠ Seiko); PRIMARY GEMSTONE TYPE; (watches) DIAL COLOR.
- ORIGIN is UNSPECIFIED unless the customer explicitly wrote "natural" or "lab"/"lab grown"/"lab-created"/"man-made". An unqualified "diamond"/"DIA" request must PASS both natural AND lab-grown items — never reject a lab-grown item (or a natural item) on origin when the customer didn't specify one.

${metalToneRules()}

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
    title: normalizeProductTerms(p.title || ""), // canonical vocabulary — see reasonMatches note
    description: normalizeProductTerms(p.description || ""), // full description — see reasonMatches note
  }));
  const user = `Customer request: "${description}"

Products to check (${list.length}):
${JSON.stringify(list)}

Return a verdict for every product id. Return the JSON now.`;
  try {
    const parsed = await withRetry(
      async () => {
        await trackAiCall(); // daily cost kill switch — throws when over budget
        const resp = await c.messages.create({
          model: VERIFY_MODEL,
          max_tokens: 8000, // room for a verdict per candidate up to the retrieval ceiling
          system: BATCH_VERIFY_SYSTEM,
          messages: [{ role: "user", content: user }],
        });
        const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
        const obj = parseJsonObject(raw);
        if (!obj || !Array.isArray(obj.results)) {
          throw new Error(`unparseable verify response (stop=${resp.stop_reason})`);
        }
        return obj;
      },
      { tries: 3, label: "verifyBatch" },
    );
    const pass = new Set();
    for (const rrr of parsed.results) {
      if (allIds.has(rrr.product_id) && rrr.match !== false) pass.add(rrr.product_id);
    }
    // Any id the model omitted → keep (avoid dropping on incomplete output).
    for (const id of allIds) if (!parsed.results.some((x) => x.product_id === id)) pass.add(id);
    return pass;
  } catch (err) {
    // Budget kill switch must HARD-STOP the caller, never fail open into more work.
    if (err instanceof AiBudgetExceededError || err?.budgetExceeded) throw err;
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
- Description: ${JSON.stringify(product.description || "")}

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
- Description: ${JSON.stringify(product.description || "")}
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

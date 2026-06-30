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

Respond with ONLY a JSON object, no other text:
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
      max_tokens: 2000,
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

// A cheaper/faster model is appropriate for a single focused yes/no.
const VERIFY_MODEL = "claude-haiku-4-5";

const VERIFY_SYSTEM = `You are an expert jeweler doing a final check on ONE proposed match. You are given a customer's request and ONE product (title + description). Decide whether it should be shown to the customer.

KEEP it (match=true) when the product is fundamentally the right thing:
- BRAND: if the request names a brand, the product must be that brand (Grand Seiko is NOT Seiko; Tiffany & Co. is specific).
- ITEM TYPE: must match (a watch for a watch request, a ring for a ring request, a bracelet for a bracelet request).
- KEY ATTRIBUTE: it must match the customer's main explicitly-stated attribute — e.g. dial color, primary gemstone, or motif/setting (a blue-dial request needs a blue dial; a cluster request needs a cluster, not a solitaire).

Do NOT reject just because of:
- a DIFFERENT METAL or material (e.g. white vs yellow gold, steel vs gold) — keep it;
- a missing SUB-TYPE qualifier (e.g. "dive" watch, "dress" watch) — keep it as long as it's the right brand/item type with the right key attribute.

REJECT (match=false) only when it is clearly the wrong item: wrong brand, wrong item type, the key requested attribute is clearly wrong (e.g. blue dial requested but the dial is black/white/silver; cluster requested but it's a solitaire), or the product is unrelated to the request.

Respond with ONLY a JSON object, no other text:
{"match": true|false, "reason": "one short sentence"}`;

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

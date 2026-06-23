import Anthropic from "@anthropic-ai/sdk";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// A cheaper/faster model is appropriate for a single yes/no judgment.
const JUDGE_MODEL = "claude-haiku-4-5";

function parseJsonObject(raw) {
  if (!raw) return null;
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * Stage-2 judge: decide whether ONE product genuinely satisfies ONE request.
 * Called only on borderline (review-band) matches — never per-catalog. Uses
 * schema-enforced JSON. Returns { match: boolean, confidence: 0-1, reasoning }
 * or null on any failure (caller falls back to the deterministic route).
 */
export async function judgeMatch({ request, product, matchedKeywords = [] }) {
  const c = getClient();
  if (!c) return null;

  const system = `You are a precise jewelry-matching judge for a store's back-office tool. A salesperson logged a customer's special-order request; decide whether a specific inventory item genuinely fulfills it.

Be strict and bias toward PRECISION — a false match wastes the salesperson's time. The item must match the request's defining attributes (item type, brand, motif, material, gemstone). Differences in soft attributes (color, era, exact size, price within reason) are acceptable.

Respond with ONLY a JSON object, no other text:
{"match": true|false, "confidence": 0.0-1.0, "reasoning": "one short sentence"}`;

  const user = `Request:
- Description: ${JSON.stringify(request.description || "")}
- Keywords/facets: ${JSON.stringify(request.keywords || [])}
- Budget: ${request.budget != null ? "$" + request.budget : "none"}

Candidate product:
- Title: ${JSON.stringify(product.title || "")}
- Tags: ${JSON.stringify(product.tags || [])}
- Price: ${product.price != null ? "$" + product.price : "unknown"}
- Keywords that matched deterministically: ${JSON.stringify(matchedKeywords)}

Return the JSON verdict now.`;

  try {
    const resp = await c.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed.match !== "boolean") return null;
    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));
    return {
      match: parsed.match,
      confidence,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : null,
    };
  } catch (err) {
    console.error("judgeMatch failed:", err?.message || err);
    return null;
  }
}

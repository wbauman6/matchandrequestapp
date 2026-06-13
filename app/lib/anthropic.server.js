import Anthropic from "@anthropic-ai/sdk";

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env to enable AI keyword suggestions.",
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const MODEL = "claude-sonnet-4-6";

/**
 * Parse a JSON object from the model's response. Tries the whole string first,
 * then falls back to the first balanced {...} substring (in case the model adds
 * stray text despite instructions). Returns null if no valid JSON is found.
 * This never splits prose — extraction failure yields null, not fake tags.
 */
function parseJsonObject(raw) {
  if (!raw) return null;
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    // fall through to substring extraction
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Given a free-text customer description, ask Claude for a tight list of tags
 * we can run through the matcher.
 *
 * The model is required to respond with a single JSON object:
 *   { "tags": ["tag1", ...], "reasoning": "short explanation" }
 * We parse it as JSON. If parsing fails we return [] and log the raw response —
 * we never fall back to splitting prose, which is how instruction fragments
 * previously leaked in as "tags".
 *
 * When the store's vocabulary (its live distinct product tags) is provided, the
 * model may ONLY choose tags from that list, and we additionally enforce that
 * server-side: any returned tag not in the vocabulary is dropped, and survivors
 * are mapped back to the vocabulary's exact spelling/casing.
 */
export async function suggestKeywords({ description, vocabulary = [] }) {
  if (!description || !description.trim()) return [];

  const hasVocab = vocabulary.length > 0;
  const vocabList = vocabulary.slice(0, 500);

  const systemPrompt = hasVocab
    ? `You are a jewelry-store cataloging assistant. You tag a customer's special-order request using ONLY the store's controlled vocabulary of existing Shopify product tags, so the request can be matched against real inventory.

Rules:
- You MUST choose tags ONLY from the provided vocabulary list. NEVER invent a tag. NEVER output a tag that is not in the list. If something fits conceptually but is not in the list, leave it out.
- Use the vocabulary's exact spelling and casing.
- First, reason internally about the description: expand brand nicknames and abbreviations to their formal names (e.g. "tiffany" -> "Tiffany & Co.", "ysl" -> "Yves Saint Laurent"), infer the item type, and infer style, era, material, and motif where the description supports it.
- Then match that reasoning against the vocabulary and select EVERY tag that genuinely fits: brand tags, item-type tags, style tags, motif tags, and material tags. Apply every tag that fits, but never invent one.
- If a brand nickname or shorthand maps to a tag in the vocabulary, use the vocabulary's exact spelling/casing for it.

The vocabulary may use prefixed/namespaced tags such as "mat:silver" (material = silver), "mat:gold", "brand:cartier", "type:ring", etc. When a concept you inferred matches the meaning of a prefixed tag, select that prefixed tag exactly as written. For example, if the customer wants something in silver, choose "mat:silver" if it is in the list.

Common jewelry abbreviations to expand while reasoning (map the concept, then pick the matching vocabulary tag — including prefixed ones):
- "SS" = sterling silver / silver -> material silver (e.g. "mat:silver")
- "WG" = white gold, "YG" = yellow gold, "RG" = rose gold, "gf" = gold filled -> the matching gold material tag
- "dia" = diamond, "cz" = cubic zirconia, "ct"/"ctw" = carat weight
- "engmt"/"eng" = engagement, "wb" = wedding band, "neck" = necklace, "brc"/"bracelet" = bracelet, "ear" = earrings

Respond with ONLY a single JSON object, no text before or after, of exactly this shape:
{"tags": ["tag1", "tag2"], "reasoning": "1-2 sentence explanation"}`
    : `You are a jewelry-store cataloging assistant. You tag a customer's special-order request with concise keywords so it can be matched against inventory.

Rules:
- First, reason internally about the description: expand brand nicknames and abbreviations to their formal names, infer the item type, and infer style, era, material, and motif where the description supports it.
- Choose 3 to 8 short keyword tags (single words or 2-word phrases) that best capture what the customer wants.

Respond with ONLY a single JSON object, no text before or after, of exactly this shape:
{"tags": ["tag1", "tag2"], "reasoning": "1-2 sentence explanation"}`;

  const userPrompt = hasVocab
    ? `Controlled vocabulary (the ONLY tags you may use):
${vocabList.join(", ")}

Customer description:
"""
${description.trim()}
"""

Return the JSON object now.`
    : `Customer description:
"""
${description.trim()}
"""

Return the JSON object now.`;

  const c = getClient();
  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw =
    response.content?.[0]?.type === "text" ? response.content[0].text : "";

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    console.error(
      "Keyword suggestion: failed to parse JSON from model. Raw response:",
      raw,
    );
    return [];
  }

  let tags = Array.isArray(parsed.tags) ? parsed.tags : [];
  tags = tags.map((t) => String(t).trim()).filter(Boolean);

  // Enforce the controlled vocabulary: drop anything not in the list, and map
  // survivors to the vocabulary's exact casing.
  if (hasVocab) {
    const byLower = new Map(vocabulary.map((v) => [v.toLowerCase(), v]));
    tags = tags.map((t) => byLower.get(t.toLowerCase())).filter(Boolean);
  }

  // Dedupe (case-insensitively) and cap.
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out.slice(0, 12);
}

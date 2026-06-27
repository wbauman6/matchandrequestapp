import crypto from "node:crypto";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3";
const MAX_BATCH = 100; // Voyage allows up to 128 inputs/request; stay conservative.

export function hasEmbeddingKey() {
  return Boolean(process.env.VOYAGE_API_KEY);
}

// Stable hash of the embedded text, so we only re-embed when content changes.
export function textHash(text) {
  return crypto.createHash("sha1").update(text || "").digest("hex");
}

export function buildProductText(product) {
  const tags = (product.tags || []).join(", ");
  const title = product.title || "";
  // Weight the title heavily (repeat it) so title-similar products surface even
  // when tags/description are thin or missing.
  return [title, title, title, product.description, tags]
    .filter(Boolean)
    .join(". ")
    .slice(0, 8000);
}

export function buildRequestText(request) {
  const kws = (request.keywords || []).join(", ");
  return [request.description, kws].filter(Boolean).join(". ").slice(0, 8000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callVoyage(input, inputType, attempt = 0) {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ input, model: MODEL, input_type: inputType }),
  });
  if (res.status === 429 || res.status >= 500) {
    // Rate-limited or transient: back off and retry a few times.
    if (attempt < 5) {
      await sleep(Math.min(60000, 2000 * 2 ** attempt));
      return callVoyage(input, inputType, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  // Ensure vectors come back in input order.
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/**
 * Embed an array of texts. `inputType` is "document" for catalog items and
 * "query" for requests (Voyage uses this for asymmetric retrieval quality).
 * Returns an array of vectors aligned to the input order.
 */
export async function embedTexts(texts, inputType = "document") {
  const out = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const vectors = await callVoyage(batch, inputType);
    out.push(...vectors);
  }
  return out;
}

export async function embedText(text, inputType = "document") {
  const [v] = await embedTexts([text], inputType);
  return v;
}

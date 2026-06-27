export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const matrix = Array.from({ length: n + 1 }, (_, i) => [i]);
  for (let j = 0; j <= m; j++) matrix[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      matrix[i][j] =
        a[j - 1] === b[i - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j - 1], matrix[i - 1][j], matrix[i][j - 1]);
    }
  }
  return matrix[n][m];
}

export function wordSim(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;
  // Substring match counts as a strong hint (e.g. "ring" matches "engagement ring")
  if (a.length >= 3 && b.includes(a)) return 0.9;
  if (b.length >= 3 && a.includes(b)) return 0.9;
  if (a.length < 2 || b.length < 2) return 0;
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / Math.max(a.length, b.length));
}

// Fuzzy threshold for accepting a single-keyword match.
// 0.45 means roughly "more than half the characters line up"
// e.g. "ring" vs "rings" = 0.8 ✓,  "gold" vs "golden" = 0.66 ✓,  "diamond" vs "stone" = ~0.14 ✗
const SIM_THRESHOLD = 0.45;

// Connector words ignored when splitting a multi-word keyword into the words
// that must be present (e.g. "star of david" -> requires "star" AND "david").
const STOPWORDS = new Set([
  "of", "the", "and", "for", "with", "a", "an", "in", "on", "to", "&",
]);

// Build the searchable text for a product: its tags (kept whole) plus
// individual words from the title. Lowercased downstream by wordSim.
function buildHaystack(productTags, productTitle = "") {
  const titleWords = productTitle
    .toLowerCase()
    .split(/[\s\-_,.\/()]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  return [...productTags, ...titleWords];
}

// Split a keyword into the significant words that must all be present.
function keywordWords(keyword) {
  const words = keyword
    .toLowerCase()
    .split(/[\s\-_,.\/()]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const significant = words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return significant.length ? significant : words;
}

// Does a single word fuzzy-match any token in the product's haystack?
function wordHitsHaystack(word, haystack) {
  for (const token of haystack) {
    if (wordSim(word, token) >= SIM_THRESHOLD) return true;
  }
  return false;
}

// Does this keyword match the product? A multi-word keyword (e.g. "Estate
// Rolex") requires ALL of its significant words to be present — so a plain
// "estate" product no longer matches "estate rolex" just because they share
// the common word "estate".
function keywordHits(keyword, haystack) {
  for (const word of keywordWords(keyword)) {
    if (!wordHitsHaystack(word, haystack)) return false;
  }
  return true;
}

/**
 * Score how well a product matches a request, weighting each keyword by how
 * RARE it is across the catalog (inverse document frequency). Generic keywords
 * that appear on thousands of products ("diamond", "earrings", "estate") carry
 * almost no weight, while distinctive keywords ("hebrew", "sapphire") dominate.
 * A product therefore only scores high when it matches the *defining* keywords
 * of the request — not just a pile of common ones.
 *
 * `weights` is a Map(keyword -> weight) from computeKeywordWeights().
 * Returns { score: 0-100, matchedKeywords: string[] }.
 */
export function weightedMatch(
  reqKeywords,
  weights,
  productTags,
  productTitle = "",
  requiredKeywords = null,
) {
  const haystack = buildHaystack(productTags, productTitle);

  let matchedWeight = 0;
  let totalWeight = 0;
  const matched = [];
  const matchedSet = new Set();
  for (const rk of reqKeywords) {
    const w = weights.get(rk) ?? 0;
    totalWeight += w;
    if (keywordHits(rk, haystack)) {
      matchedWeight += w;
      matched.push(rk);
      matchedSet.add(rk);
    }
  }

  // Hard requirement: a product that misses ANY defining keyword is not a
  // match, no matter how many supporting keywords it shares. This is what keeps
  // a cross out of a "star of David" request, or a Seiko out of a "Rolex" one.
  if (requiredKeywords) {
    for (const rk of requiredKeywords) {
      if (!matchedSet.has(rk)) return { score: 0, matchedKeywords: [] };
    }
  }

  const score =
    totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  return { score, matchedKeywords: matched };
}

// Descriptive attributes that should rank a match up but never EXCLUDE one:
// dial/color, gender, era/age. So a "blue dial vintage Rolex" request still
// surfaces a grey-dial vintage Rolex — color isn't a hard requirement — while
// item type, brand, motif, and material (which are NOT soft) stay mandatory.
const SOFT_TAG_PATTERNS = [
  /^dialc:/i, // dial color
  /^colou?r:/i, // color / colour namespaces
  /^gender:/i, // gender
  /^age:/i, // age band
  /^antique:/i, // antique flag
  /^\d{4}'?s$/, // era like "1970's" / "1970s"
  /^(post|pre|circa)[-\s]?\d{3,4}/i, // "post-1940"
  /^(vintage|antique|estate)$/i, // generic era / condition words
];

export function isSoftCategory(tag) {
  const t = String(tag).trim();
  return SOFT_TAG_PATTERNS.some((re) => re.test(t));
}

/**
 * The "defining" keywords of a request: distinctive IDENTITY attributes (motif,
 * brand, material, distinctive item type) that a real match MUST have. A
 * keyword qualifies if it appears in fewer than `maxDocFraction` of catalog
 * products (i.e. it actually narrows the search) AND it isn't a soft/descriptive
 * attribute (color, era, gender). Ubiquitous tags ("diamond", "estate") and
 * soft tags only affect ranking. These become hard requirements in
 * weightedMatch().
 *
 * weight = ln((N+1)/(df+1)), so docFraction ≈ e^(-weight).
 */
export function definingKeywords(reqKeywords, weights, maxDocFraction = 0.25) {
  const cutoff = Math.log(1 / maxDocFraction); // weight above this = distinctive
  const eligible = reqKeywords.filter((rk) => !isSoftCategory(rk));
  const required = eligible.filter((rk) => (weights.get(rk) ?? 0) >= cutoff);
  if (required.length > 0) return required;

  // Fallback: if nothing cleared the bar, still require the single most
  // distinctive identity keyword as long as it appears in under half the
  // catalog — so a brand/motif request keeps filtering even in a lopsided
  // catalog.
  let top = null;
  let max = 0;
  for (const rk of eligible) {
    const w = weights.get(rk) ?? 0;
    if (w > max) {
      max = w;
      top = rk;
    }
  }
  return top && max >= Math.log(2) ? [top] : [];
}

/**
 * Compute an inverse-document-frequency weight for each request keyword over the
 * given product corpus. df = number of products the keyword fuzzy-matches.
 * weight = ln((N + 1) / (df + 1)) — high for rare keywords, ~0 for ubiquitous.
 */
export function computeKeywordWeights(reqKeywords, products) {
  const N = products.length || 1;
  const df = new Map(reqKeywords.map((k) => [k, 0]));

  for (const product of products) {
    const haystack = buildHaystack(product.tags, product.title);
    for (const rk of reqKeywords) {
      if (keywordHits(rk, haystack)) df.set(rk, df.get(rk) + 1);
    }
  }

  const weights = new Map();
  for (const rk of reqKeywords) {
    weights.set(rk, Math.log((N + 1) / (df.get(rk) + 1)));
  }
  return weights;
}

// Cosine similarity between two equal-length numeric vectors, in [-1, 1].
// Returns 0 for missing/empty/mismatched vectors so callers can fall back.
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Map a cosine similarity (~[0,1] for these embeddings) to a 0-100 score.
export function similarityToScore(sim) {
  return Math.round(Math.max(0, Math.min(1, sim)) * 100);
}

// Price proximity as a soft signal in [0,1]: at or under budget = 1, decaying to
// 0 at twice the budget. Neutral (1) when budget or price is unknown.
export function priceProximity(budget, price) {
  if (!budget || price == null) return 1;
  if (price <= budget) return 1;
  const over = price / budget;
  return Math.max(0, 1 - (over - 1)); // 1x -> 1, 1.5x -> 0.5, 2x -> 0
}

// Blend the keyword score (0-100) with price proximity. Price is a low/medium
// soft signal: it can shave up to 15% off an otherwise-good match that's well
// over budget, nudging it toward the review band, but never inflates a score.
export function blendScore(keywordScore, priceProx) {
  return Math.round(keywordScore * (0.85 + 0.15 * priceProx));
}

/**
 * Unweighted match (every keyword counts equally). Retained for the webhook
 * path where the full catalog isn't loaded to compute IDF weights.
 * Returns { score: 0-100, matchedKeywords: string[] }.
 */
export function computeMatch(reqKeywords, productTags, productTitle = "") {
  const haystack = buildHaystack(productTags, productTitle);
  const matched = [];
  for (const rk of reqKeywords) {
    if (keywordHits(rk, haystack)) matched.push(rk);
  }
  const score =
    reqKeywords.length > 0
      ? Math.round((matched.length / reqKeywords.length) * 100)
      : 0;
  return { score, matchedKeywords: matched };
}

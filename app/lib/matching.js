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

/**
 * Score how well a product matches a request.
 * Considers both product tags AND words from the product title for richer matches.
 * Returns { score: 0-100, matchedKeywords: string[] }
 */
export function computeMatch(reqKeywords, productTags, productTitle = "") {
  // Pull individual words out of the title and combine with tags
  const titleWords = productTitle
    .toLowerCase()
    .split(/[\s\-_,.\/()]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  const haystack = [...productTags, ...titleWords];

  const best = new Map();
  for (const rk of reqKeywords) {
    for (const word of haystack) {
      const sim = wordSim(rk, word);
      if (sim >= SIM_THRESHOLD) {
        if (!best.has(rk) || best.get(rk).sim < sim) best.set(rk, { rk, sim });
      }
    }
  }
  const matched = [...best.values()].map((h) => h.rk);
  const score =
    reqKeywords.length > 0 ? Math.round((matched.length / reqKeywords.length) * 100) : 0;
  return { score, matchedKeywords: matched };
}

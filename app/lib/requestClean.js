// Cleans a request description before embedding so the vector focuses on the
// MEANINGFUL terms (brand, item type, metal, style) instead of marketing filler.
// Both lists are intended to be edited as behavior is observed.

// >>> EDIT THIS LIST: generic filler / marketing words stripped before embedding.
export const FILLER_WORDS = [
  "stunning", "beautiful", "gorgeous", "designer", "collection", "nice",
  "lovely", "elegant", "exquisite", "amazing", "perfect", "special",
  "unique", "classic", "fine", "quality", "luxury", "luxurious",
  "pretty", "dainty", "timeless", "chic", "fabulous", "incredible",
  "looking", "want", "wants", "wanting", "need", "needs", "customer",
  "please", "something",
];

// >>> EDIT THIS LIST: normalize brand shorthand in the request to the spelling
//     used in product titles. Longest/most-specific patterns FIRST.
export const BRAND_NORMALIZATIONS = [
  [/\bgrand\s+seiko\b/gi, "Grand Seiko"],
  [/\btiffany(?:\s*&|\s+and)?\s*co\.?\b|\btiffany\b/gi, "Tiffany & Co."],
  [/\bvan\s*cleef(?:\s*&\s*arpels)?\b|\bvca\b/gi, "Van Cleef & Arpels"],
  [/\bdavid\s*yurman\b|\byurman\b/gi, "David Yurman"],
  [/\bpatek(?:\s+philippe)?\b/gi, "Patek Philippe"],
  [/\baudemars(?:\s+piguet)?\b|\bap\b/gi, "Audemars Piguet"],
  [/\btag\s*heuer\b/gi, "TAG Heuer"],
  [/\bvca\b/gi, "Van Cleef & Arpels"],
  [/\bbvlgari\b|\bbulgari\b/gi, "Bvlgari"],
  [/\brolex\b/gi, "Rolex"],
  [/\bcartier\b/gi, "Cartier"],
];

export function cleanRequestText(text) {
  if (!text) return "";
  let t = String(text);
  // Normalize brand shorthand first (so "tiffany" -> "Tiffany & Co.").
  for (const [re, canon] of BRAND_NORMALIZATIONS) t = t.replace(re, canon);
  // Strip filler words.
  if (FILLER_WORDS.length) {
    const fillerRe = new RegExp(`\\b(?:${FILLER_WORDS.join("|")})\\b`, "gi");
    t = t.replace(fillerRe, " ");
  }
  t = t.replace(/\s+/g, " ").trim();
  // If we stripped everything meaningful, fall back to the original text.
  return t || String(text).trim();
}

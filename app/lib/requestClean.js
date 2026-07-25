// Cleans a request description before embedding so the vector focuses on the
// MEANINGFUL terms (brand, item type, metal, style) instead of marketing filler.
// Both lists are intended to be edited as behavior is observed.

// >>> EDIT THIS LIST: jeweler shorthand expanded to full words BEFORE embedding
//     AND before the AI reasons over the request, so "DIA" retrieves and gates
//     like "diamond", "WG" like "white gold", etc. Applied to the REQUEST only
//     (never product text). Order matters: longer/more-specific patterns first.
export const ABBREVIATIONS = [
  [/\bcttw\b/gi, "carat total weight"],
  [/\bctw\b/gi, "carat total weight"],
  [/(\d)\s*ct\b/gi, "$1 carat"],
  [/\bct\b/gi, "carat"],
  [/\bdias\b/gi, "diamonds"],
  [/\bdia\b/gi, "diamond"],
  [/\bwg\b/gi, "white gold"],
  [/\byg\b/gi, "yellow gold"],
  [/\brg\b/gi, "rose gold"],
  [/\btt\b/gi, "two-tone"],
  [/\bss\b/gi, "sterling silver"],
  [/\bplat\b/gi, "platinum"],
  [/\bgs\b/gi, "Grand Seiko"],
  [/\blg\b/gi, "lab grown"],
  [/\bemer\b/gi, "emerald"],
  [/\bsapph?\b/gi, "sapphire"],
  [/\bbrac\b/gi, "bracelet"],
  [/\bpend\b/gi, "pendant"],
  [/\bnecklace\b/gi, "necklace"],
];

export function expandAbbreviations(text) {
  if (!text) return "";
  let t = String(text);
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  return t.replace(/\s+/g, " ").trim();
}

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
  // Expand jeweler shorthand first (DIA -> diamond, WG -> white gold, GS ->
  // Grand Seiko) so the embedding is built from the same full words as products.
  t = expandAbbreviations(t);
  // Normalize brand shorthand (so "tiffany" -> "Tiffany & Co.").
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

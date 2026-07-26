// Prepares a request description before embedding: normalize jeweler
// terminology to canonical terms (see app/lib/jewelryTerms.js — the editable
// EQUIVALENTS/RELATED config), then strip marketing filler so the vector
// focuses on the MEANINGFUL terms (brand, item type, metal, style).
import { normalizeRequestTerms } from "./jewelryTerms.js";

// >>> EDIT THIS LIST: generic filler / marketing words stripped before embedding.
export const FILLER_WORDS = [
  "stunning", "beautiful", "gorgeous", "designer", "collection", "nice",
  "lovely", "elegant", "exquisite", "amazing", "perfect", "special",
  "unique", "classic", "fine", "quality", "luxury", "luxurious",
  "pretty", "dainty", "timeless", "chic", "fabulous", "incredible",
  "looking", "want", "wants", "wanting", "need", "needs", "customer",
  "please", "something",
];

export function cleanRequestText(text) {
  if (!text) return "";
  // Category-1 equivalents first (DIA→diamond, WG→white gold, GS→Grand Seiko,
  // "diamond by the yard"→"diamond station", Tiffany→Tiffany & Co.), so the
  // embedding is built from the same canonical words as the products.
  let t = normalizeRequestTerms(text);
  // Strip filler words.
  if (FILLER_WORDS.length) {
    const fillerRe = new RegExp(`\\b(?:${FILLER_WORDS.join("|")})\\b`, "gi");
    t = t.replace(fillerRe, " ");
  }
  t = t.replace(/\s+/g, " ").trim();
  // If we stripped everything meaningful, fall back to the original text.
  return t || String(text).trim();
}

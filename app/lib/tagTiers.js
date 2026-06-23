import tiers from "./tagTiers.data.js";

// Curated tag taxonomy for Walter Bauman Jewelers, built from the store's live
// product tags and reviewed by the owner.
//
// - mustNamespaces: tag prefixes (e.g. "type:", "brand:", "mat:") whose values
//   are DEFINING — a match must share them. Everything is matched case-insensitively.
// - mustNoPrefix: plain (un-prefixed) tags that are defining (item type, brand,
//   motif, material, gemstone, watch model).
// - junkNoPrefix: operational noise (batch codes, offers, internal notes) that
//   should be ignored entirely — never sent to the AI, never matched.
//
// Tier decisions captured here:
//   MUST-have: item type, brand, motif/theme, material/metal, main gemstone, watch model
//   SHOULD-have: carat, dimensions, color, clarity, cut, shape(stone), setting,
//                country, era, gender, style, condition, occasion, certificate
//   JUNK: batch codes, created-dates, offers, seller/style codes, generic noise

const mustNamespaces = new Set(tiers.mustNamespaces.map((s) => s.toLowerCase()));
const mustNoPrefix = new Set(tiers.mustNoPrefix.map((s) => s.toLowerCase()));
const junkNoPrefix = new Set(tiers.junkNoPrefix.map((s) => s.toLowerCase()));

// Operational-noise patterns (catch variants not in the explicit junk set).
const JUNK_PATTERNS = [
  /^batch#/i,
  /^created\b/i,
  /\d+offer$/i,
  /^style#/i,
  /^\*?discontinued$/i,
  /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/, // date-like
  /^\d+$/, // pure number
];

function namespaceOf(tag) {
  const m = String(tag).match(/^([a-z0-9 ]+):/i);
  return m ? m[1].trim().toLowerCase() : null;
}

/** Operational noise that should never enter the vocabulary or matcher. */
export function isJunkTag(tag) {
  const t = String(tag).trim();
  if (!t) return true;
  if (junkNoPrefix.has(t.toLowerCase())) return true;
  return JUNK_PATTERNS.some((re) => re.test(t));
}

/**
 * Is this tag a DEFINING (must-have) attribute? Prefixed tags are decided by
 * their namespace; plain tags by the curated must list. Anything not classified
 * here returns false (treated as should-have / supporting).
 */
export function isMustHaveTag(tag) {
  const t = String(tag).trim().toLowerCase();
  if (!t || isJunkTag(t)) return false;
  const ns = namespaceOf(t);
  if (ns) return mustNamespaces.has(ns);
  return mustNoPrefix.has(t);
}

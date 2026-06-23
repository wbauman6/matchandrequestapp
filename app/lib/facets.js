import tiers from "./tagTiers.data.js";
import { isJunkTag } from "./tagTiers.js";

// Maps a tag to its facet category, using the namespace prefix first, then the
// curated no-prefix category map. Unknown tags fall back to "descriptive".
const namespaceCategory = tiers.namespaceCategory || {};
const noPrefixCategory = tiers.noPrefixCategory || {};

function namespaceOf(tag) {
  const m = String(tag).match(/^([a-z0-9 ]+):/i);
  return m ? m[1].trim().toLowerCase() : null;
}

export function categoryOf(tag) {
  const t = String(tag).trim().toLowerCase();
  if (!t || isJunkTag(t)) return "junk";
  const ns = namespaceOf(t);
  if (ns) return namespaceCategory[ns] || "descriptive";
  return noPrefixCategory[t] || "descriptive";
}

// Facet categories that represent a single value per item (the rest are lists).
const SINGLE_VALUE = new Set(["item_type", "brand", "model"]);

/**
 * Derive typed facets from a flat tag list (a request's keywords or a product's
 * tags). Identity facets used for hard filtering are item_type, brand, motif,
 * material, gemstone, model; the rest are soft/descriptive. Junk is dropped.
 *
 * Returns:
 *   {
 *     item_type: string|null, brand: string|null, model: string|null,
 *     motif: string[], gemstone: string[], material: string[],
 *     era: string[], style: string[], color: string[], gender: string[],
 *     size: string[], descriptive: string[]
 *   }
 */
export function deriveFacets(tags = []) {
  const facets = {
    item_type: null,
    brand: null,
    model: null,
    motif: [],
    gemstone: [],
    material: [],
    era: [],
    style: [],
    color: [],
    gender: [],
    size: [],
    descriptive: [],
  };

  for (const raw of tags) {
    const tag = String(raw).trim();
    if (!tag) continue;
    const cat = categoryOf(tag);
    if (cat === "junk") continue;
    if (!(cat in facets)) {
      facets.descriptive.push(tag);
      continue;
    }
    if (SINGLE_VALUE.has(cat)) {
      // keep the first seen value for single-value facets
      if (!facets[cat]) facets[cat] = tag;
    } else {
      facets[cat].push(tag);
    }
  }
  return facets;
}

// Optional price-range facet parsed from free text like "$500-1500" or "under 2k".
// Returns { min, max } in dollars, or null. Kept simple and defensive.
export function parsePriceRange(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/,/g, "");
  const num = (m) => {
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (/k/.test(m[0])) v *= 1000;
    return Number.isFinite(v) ? v : null;
  };
  const range = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*k?\s*[-–to]+\s*\$?\s*(\d+(?:\.\d+)?)\s*k?/);
  if (range) {
    const lo = num([range[0], range[1]]);
    const hi = num([range[0], range[2]]);
    if (lo != null && hi != null) return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }
  const under = s.match(/(?:under|below|<|up to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(k?)/);
  if (under) {
    const hi = num([under[0], under[1]]);
    if (hi != null) return { min: 0, max: hi };
  }
  const over = s.match(/(?:over|above|>|at least)\s*\$?\s*(\d+(?:\.\d+)?)\s*(k?)/);
  if (over) {
    const lo = num([over[0], over[1]]);
    if (lo != null) return { min: lo, max: null };
  }
  return null;
}

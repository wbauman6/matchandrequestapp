import { deriveFacets } from "./facets.js";

// ---------------------------------------------------------------------------
// Stage 1 attribute extraction: metal color, item type, brand.
//
// These three are the hard "dealbreaker" filters. We extract them from both the
// product (title, productType, vendor, tags) and the request (description,
// keywords) using the SAME normalization so the two speak the same language.
// ---------------------------------------------------------------------------

// ---- Metal color -----------------------------------------------------------
// Canonical values: yellow_gold, white_gold, rose_gold, two_tone, gold
// (gold of unspecified color), sterling_silver, platinum, palladium,
// stainless_steel, titanium, other, unknown.

const TWO_TONE_RE =
  /\b(two[\s-]?tone|tri[\s-]?(?:color|colour|tone)|tricolou?r|multi[\s-]?(?:tone|color|colour))\b/i;

const GOLD_COLOR_RES = {
  // Includes this store's title abbreviations: "Y Gold", "W Gold", "R Gold",
  // and plated forms YGP / WGP / RGP.
  yellow_gold: /\byellow\s*gold\b|\byg\b|\bygp\b|\by\s+gold\b/i,
  white_gold: /\bwhite\s*gold\b|\bwg\b|\bwgp\b|\bw\s+gold\b/i,
  rose_gold: /\b(?:rose|pink)\s*gold\b|\brg\b|\brgp\b|\br\s+gold\b|\bp\s+gold\b/i,
};

const OTHER_METAL_RES = {
  sterling_silver: /\bsterling\b|\bsterling\s*silver\b|\b925\b|\bsilver\b|\bss\b/i,
  platinum: /\bplatinum\b|\bplat\b|\b950\s*plat/i,
  palladium: /\bpalladium\b/i,
  stainless_steel: /\bstainless(?:\s*steel)?\b|\bsteel\b/i,
  titanium: /\btitanium\b/i,
};

const GENERIC_GOLD_RE = /\bgold\b|\b\d{1,2}\s*k(?:t|arat)?\b|\bvermeil\b|\bgold[\s-]?(?:plated|filled|tone)\b/i;

/**
 * Determine a product/request's metal color from a list of strings (tags,
 * title, etc.). Returns one canonical token. Multiple distinct colors/metals,
 * or an explicit two-tone phrase, collapse to "two_tone".
 */
export function extractMetal(strings) {
  const text = strings.filter(Boolean).join(" | ").toLowerCase();
  if (!text.trim()) return "unknown";

  const explicitTwoTone = TWO_TONE_RE.test(text);

  const distinct = new Set();
  for (const [metal, re] of Object.entries(GOLD_COLOR_RES)) {
    if (re.test(text)) distinct.add(metal);
  }
  for (const [metal, re] of Object.entries(OTHER_METAL_RES)) {
    if (re.test(text)) distinct.add(metal);
  }

  if (explicitTwoTone || distinct.size >= 2) return "two_tone";
  if (distinct.size === 1) return [...distinct][0];
  if (GENERIC_GOLD_RE.test(text)) return "gold"; // gold, unspecified color
  return "unknown";
}

const GOLD_FAMILY = new Set([
  "yellow_gold",
  "white_gold",
  "rose_gold",
  "two_tone",
  "gold",
]);

/**
 * Hard filter for metal:
 * - request has no metal           -> accept all
 * - product metal unknown          -> excluded (only exact metals show)
 * - request two_tone               -> product must be two_tone
 * - request single gold color      -> product must be that exact color
 *                                     (two_tone and unspecified gold excluded)
 * - request "gold" (no color)      -> any gold color accepted
 * - request silver/platinum/etc    -> product must be that exact metal
 */
export function metalPasses(reqMetal, prodMetal) {
  if (!reqMetal || reqMetal === "unknown") return true; // no metal specified
  if (prodMetal === "unknown") return false;
  if (reqMetal === "two_tone") return prodMetal === "two_tone";
  if (reqMetal === "gold") return GOLD_FAMILY.has(prodMetal);
  return prodMetal === reqMetal;
}

// ---- Item type -------------------------------------------------------------
// Canonical singular types. Order matters: earlier entries win when several
// appear (e.g. "pendant necklace" -> pendant is the more specific item).

const ITEM_TYPE_RULES = [
  ["earrings", /\bearrings?\b|\bear\s*rings?\b|\bstuds?\b|\bhoops?\b|\bhuggies?\b/i],
  ["ring", /\brings?\b|\bbands?\b|\bwedding\s*band\b|\beternity\b|\bsolitaire\b|\bsignet\b/i],
  ["bracelet", /\bbracelets?\b|\bbangles?\b|\bcuffs?\b|\btennis\s*bracelet\b/i],
  ["pendant", /\bpendants?\b|\bcharms?\b|\blockets?\b/i],
  ["necklace", /\bnecklaces?\b|\bchains?\b|\bchokers?\b|\bstrand\b|\briviera\b/i],
  ["watch", /\bwatch(?:es)?\b|\btimepieces?\b|\bwristwatch\b/i],
  ["brooch", /\bbrooch(?:es)?\b|\bpins?\b/i],
  ["cufflinks", /\bcuff\s*links?\b|\bcufflinks?\b/i],
  ["anklet", /\banklets?\b/i],
  ["coin", /\bcoins?\b|\bbullion\b/i],
];

export function normalizeItemType(value) {
  if (!value) return null;
  const v = String(value)
    .toLowerCase()
    .replace(/^[a-z0-9 ]+:/i, "") // strip namespace like "type:"
    .trim();
  for (const [canon, re] of ITEM_TYPE_RULES) {
    if (re.test(v)) return canon;
  }
  return null;
}

export function extractItemType(strings) {
  const text = strings.filter(Boolean).join(" ").toLowerCase();
  for (const [canon, re] of ITEM_TYPE_RULES) {
    if (re.test(text)) return canon;
  }
  return null;
}

export function itemTypePasses(reqType, prodType) {
  if (!reqType) return true; // not specified -> accept all
  if (!prodType) return false; // unknown type excluded when request specifies
  return reqType === prodType;
}

// ---- Style (defining vs vague) ---------------------------------------------
//
// DEFINING styles are specific, recognizable constructions/settings. When a
// request names one, it becomes MANDATORY — a product without that style is the
// wrong item, not just a weaker match. Keep this list SMALL and conservative;
// it's meant to be edited as behavior is observed. Each entry maps a canonical
// style to a regex matching its variants (in title/tags/description).
//
// >>> EDIT THIS LIST to add/remove defining style terms. <<<
export const DEFINING_STYLE_RULES = [
  ["cluster", /\bcluster(?:s|ed)?\b/i],
  ["halo", /\bhalo(?:[\s-]?set)?\b/i],
  ["solitaire", /\bsolitaires?\b/i],
  ["three-stone", /\b(?:three[\s-]?stone|3[\s-]?stone|trilogy|past present future)\b/i],
  ["eternity", /\beternity\b/i],
  ["tennis", /\btennis\b/i],
  ["signet", /\bsignets?\b/i],
  ["pave", /\bpave\b|pavé/i],
  ["channel-set", /\bchannel[\s-]?set\b/i],
  ["bezel", /\bbezel(?:[\s-]?set)?\b/i],
  ["stud", /\bstuds?\b/i],
  ["hoop", /\bhoops?\b/i],
  ["huggie", /\bhuggies?\b/i],
  ["riviera", /\briviera\b/i],
];

// VAGUE descriptors stay SOFT (semantic ranking only) — never hard filters.
// Listed here only for clarity/documentation; they are simply absent from the
// defining list, so they're never treated as mandatory.
export const VAGUE_STYLE_TERMS = [
  "classic", "elegant", "simple", "modern", "vintage-inspired",
  "pretty", "delicate", "statement", "fancy", "unique", "beautiful",
];

// All defining styles present in a set of strings (a product's text or a
// request's text). Returns canonical style names.
export function extractStyles(strings) {
  const text = strings.filter(Boolean).join(" | ").toLowerCase();
  if (!text.trim()) return [];
  const found = [];
  for (const [style, re] of DEFINING_STYLE_RULES) {
    if (re.test(text)) found.push(style);
  }
  return found;
}

/**
 * Style hard filter. `reqStyles` are the defining styles named in the request.
 * A product must have ALL of them (AND). If requiring all yields nothing, the
 * caller can retry requiring only the most specific one (see requiredStyles).
 */
export function stylePasses(reqStyles, prodStyles) {
  if (!reqStyles || reqStyles.length === 0) return true;
  const have = new Set(prodStyles);
  return reqStyles.every((s) => have.has(s));
}

// ---- Brand -----------------------------------------------------------------
// Alias map for the brands the store actually carries. Extend as needed.

const BRAND_ALIASES = [
  ["tiffany & co.", /\btiffany\b/i],
  ["cartier", /\bcartier\b/i],
  ["david yurman", /\bdavid\s*yurman\b|\byurman\b/i],
  ["rolex", /\brolex\b/i],
  ["van cleef & arpels", /\bvan\s*cleef\b|\bvca\b/i],
  ["bvlgari", /\bbvlgari\b|\bbulgari\b/i],
  ["chopard", /\bchopard\b/i],
  ["mikimoto", /\bmikimoto\b/i],
  ["john hardy", /\bjohn\s*hardy\b/i],
  ["elsa peretti", /\belsa\s*peretti\b|\bperetti\b/i],
  ["charles garnier", /\bcharles\s*garnier\b/i],
  ["michele", /\bmichele\b/i],
  ["g-shock", /\bg[\s-]?shock\b/i],
  ["disney", /\bdisney\b/i],
];

export function normalizeBrand(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/^[a-z0-9 ]+:/i, "").trim();
  if (!v || v === "estate" || v === "walter bauman") return null;
  for (const [canon, re] of BRAND_ALIASES) {
    if (re.test(v)) return canon;
  }
  return null;
}

export function extractBrand(strings) {
  const text = strings.filter(Boolean).join(" ");
  for (const [canon, re] of BRAND_ALIASES) {
    if (re.test(text)) return canon;
  }
  return null;
}

export function brandPasses(reqBrand, prodBrand) {
  if (!reqBrand) return true; // not specified -> accept all
  if (!prodBrand) return false; // request named a brand; unknown excluded
  return reqBrand === prodBrand;
}

// ---- Combined extraction ---------------------------------------------------

export function extractProductAttributes(product) {
  const tags = product.tags || [];
  const strings = [product.title, product.productType, product.vendor, product.description, ...tags];
  const facets = deriveFacets(tags);
  return {
    metal: extractMetal(strings),
    itemType:
      normalizeItemType(facets.item_type) || extractItemType(strings),
    brand: normalizeBrand(facets.brand) || extractBrand(strings),
    styles: extractStyles(strings),
  };
}

export function extractRequestAttributes(request) {
  const keywords = request.keywords || [];
  const strings = [request.description, ...keywords];
  const facets = deriveFacets(keywords);
  return {
    metal: extractMetal(strings),
    itemType:
      normalizeItemType(facets.item_type) || extractItemType(strings),
    brand: normalizeBrand(facets.brand) || extractBrand(strings),
    styles: extractStyles(strings),
  };
}

/**
 * Stage-1 hard filter: a product survives only if it passes ALL applicable
 * dealbreaker filters. Returns { pass, reasons } where reasons lists the
 * filters that failed (for debugging/inspection).
 */
export function passesHardFilters(reqAttrs, prodAttrs) {
  const reasons = [];
  if (!metalPasses(reqAttrs.metal, prodAttrs.metal)) reasons.push("metal");
  if (!itemTypePasses(reqAttrs.itemType, prodAttrs.itemType)) reasons.push("item_type");
  if (!brandPasses(reqAttrs.brand, prodAttrs.brand)) reasons.push("brand");
  return { pass: reasons.length === 0, reasons };
}

// ============================================================================
// JEWELER TERMINOLOGY — the single place to teach the matcher abbreviations,
// nicknames, and synonyms. Two categories, handled very differently:
//
//   CATEGORY 1 — EQUIVALENTS: rewritten to a canonical term BEFORE embedding and
//     reasoning, so both the request and (where safe) the product speak the same
//     vocabulary. "DIA" and "diamond" become the same token.
//
//   CATEGORY 2 — RELATED-BUT-DISTINCT: NEVER rewritten. Injected into the
//     reasoning prompt as "the customer might also consider…", so the AI can
//     offer them as lower-confidence alternatives — but they NEVER override a
//     hard gate (brand, metal color/type, stone origin, item type, gemstone,
//     named setting).
//
// SAFETY: normalization must not merge things that must stay separate. That is
// why abbreviations and brand nicknames are scope:"request" — a customer's "SS"
// means sterling silver, but a watch's product text "SS" means STAINLESS STEEL,
// and "GS" must never turn a plain Seiko's text into "Grand Seiko". Phrase
// synonyms (scope defaults to "both") are safe on product text because the
// canonical term never contains the variant.
// ============================================================================

// ---------------------------------------------------------------------------
// CATEGORY 1 — EQUIVALENTS  (>>> ADD ENTRIES HERE <<<)
// Each entry: { from, to, scope? }
//   from  — a string (matched as a whole word/phrase, case-insensitive, with
//           flexible spacing) OR a RegExp (used exactly as written).
//   to    — the canonical replacement.
//   scope — "both" (default: request + product text) | "request" (request only).
// Order matters: longer / more-specific phrases first.
// ---------------------------------------------------------------------------
export const EQUIVALENTS = [
  // ---- Style / phrase synonyms — SAFE on both request and product text ----
  { from: "diamonds by the yard", to: "diamond station" },
  { from: "diamond by the yard", to: "diamond station" },
  { from: "by the yard", to: "station" }, // e.g. "sapphire by the yard" -> "sapphire station"
  { from: "line bracelet", to: "tennis bracelet" },
  { from: "line necklace", to: "tennis necklace" },
  { from: "eternity bracelet", to: "tennis bracelet" },
  { from: "cocktail ring", to: "statement ring" },

  // ---- Brand names — REQUEST-ONLY. Products already store the canonical brand,
  //      and re-normalizing product text risks double-application. The `co\b\.?`
  //      consumes an optional trailing period so "Tiffany & Co." stays clean,
  //      and the lookahead stops it becoming "Tiffany & Co. & Co." ----
  { from: /\btiffany\s*(?:&|and)\s*co\b\.?/gi, to: "Tiffany & Co.", scope: "request" },
  { from: /\bt\s*&\s*co\b\.?/gi, to: "Tiffany & Co.", scope: "request" },
  { from: /\btiffany\b(?!\s*(?:&|and)\s*co)/gi, to: "Tiffany & Co.", scope: "request" },
  { from: "grand seiko", to: "Grand Seiko", scope: "request" },
  { from: /\bvan\s*cleef\s*(?:&|and)\s*arpels\b/gi, to: "Van Cleef & Arpels", scope: "request" },
  { from: /\bvan\s*cleef\b(?!\s*(?:&|and)\s*arpels)/gi, to: "Van Cleef & Arpels", scope: "request" },
  { from: "vca", to: "Van Cleef & Arpels", scope: "request" },
  { from: /\bdavid\s*yurman\b|\byurman\b/gi, to: "David Yurman", scope: "request" },
  { from: /\bpatek(?:\s+philippe)?\b/gi, to: "Patek Philippe", scope: "request" },
  { from: /\baudemars(?:\s+piguet)?\b|\bap\b/gi, to: "Audemars Piguet", scope: "request" },
  { from: /\btag\s*heuer\b/gi, to: "TAG Heuer", scope: "request" },
  { from: /\bbvlgari\b|\bbulgari\b/gi, to: "Bvlgari", scope: "request" },
  { from: "rolex", to: "Rolex", scope: "request" },
  { from: "cartier", to: "Cartier", scope: "request" },

  // ---- Jeweler abbreviations — REQUEST-ONLY (ambiguous in product text) ----
  { from: /\bcttw\b/gi, to: "carat total weight", scope: "request" },
  { from: /\bctw\b/gi, to: "carat total weight", scope: "request" },
  { from: /(\d)\s*ct\b/gi, to: "$1 carat", scope: "request" },
  { from: "ct", to: "carat", scope: "request" },
  { from: "dias", to: "diamonds", scope: "request" },
  { from: "dia", to: "diamond", scope: "request" },
  { from: "wg", to: "white gold", scope: "request" },
  { from: "yg", to: "yellow gold", scope: "request" },
  { from: "rg", to: "rose gold", scope: "request" },
  { from: "pink gold", to: "rose gold", scope: "request" }, // same color family
  { from: "tt", to: "two-tone", scope: "request" },
  { from: "ss", to: "sterling silver", scope: "request" },
  { from: "plat", to: "platinum", scope: "request" },
  { from: "gs", to: "Grand Seiko", scope: "request" },
  { from: "lg", to: "lab grown", scope: "request" }, // keeps the lab qualifier — NOT merged with natural
  { from: "emer", to: "emerald", scope: "request" },
  { from: /\bsapph?\b/gi, to: "sapphire", scope: "request" },
  { from: "brac", to: "bracelet", scope: "request" },
  { from: "pend", to: "pendant", scope: "request" },
];

// ---------------------------------------------------------------------------
// CATEGORY 2 — RELATED-BUT-DISTINCT  (>>> ADD ENTRIES HERE <<<)
// Stylistically adjacent terms the AI may offer as LOWER-confidence
// alternatives. NEVER rewritten; NEVER cross a hard gate. Keep these to SOFT
// dimensions (cut, shape, sub-style) — do NOT relate things the gates separate
// (brands, metal colors, lab vs natural, distinct gemstones, distinct settings).
// ---------------------------------------------------------------------------
export const RELATED_TERMS = [
  { terms: ["diamond station necklace", "tennis necklace"], note: "spaced vs. continuous diamonds — similar look" },
  { terms: ["tennis bracelet", "riviera bracelet"], note: "line of stones; riviera graduates in size" },
  { terms: ["emerald cut", "asscher cut"], note: "both step cuts" },
  { terms: ["princess cut", "radiant cut"], note: "both square brilliant cuts" },
  { terms: ["oval", "elongated cushion"], note: "similar elongated soft shape" },
  { terms: ["hoop earrings", "huggie earrings"], note: "huggie is a small, close hoop" },
  { terms: ["pavé", "micro-pavé"], note: "same technique, finer stones" },
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
function toMatcher(from) {
  if (from instanceof RegExp) return from;
  const esc = String(from).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${esc}\\b`, "gi");
}

function entryApplies(entry, scope) {
  const s = entry.scope || "both";
  return s === "both" || s === scope;
}

/**
 * Rewrite CATEGORY-1 equivalents to their canonical term. `scope` is "request"
 * (applies brand + abbreviation rules too) or "product" (only the both-scope
 * phrase synonyms — never the ambiguous abbreviations).
 */
export function normalizeTerms(text, scope = "request", { collapse = true } = {}) {
  if (!text) return "";
  let t = String(text);
  for (const entry of EQUIVALENTS) {
    if (!entryApplies(entry, scope)) continue;
    t = t.replace(toMatcher(entry.from), entry.to);
  }
  // collapse:false leaves whitespace untouched, so text with no replacement is
  // byte-identical to the input — critical for buildProductText, where any
  // change to the embedded text alters the hash and forces a re-embed.
  return collapse ? t.replace(/\s+/g, " ").trim() : t;
}

export const normalizeRequestTerms = (t) => normalizeTerms(t, "request");
export const normalizeProductTerms = (t, opts) => normalizeTerms(t, "product", opts);

/**
 * CATEGORY-2 guidance block injected into the reasoning system prompt.
 */
export function relatedTermsGuidance() {
  if (!RELATED_TERMS.length) return "";
  const lines = RELATED_TERMS.map(
    (r) => `- ${r.terms.join(" ~ ")}${r.note ? ` (${r.note})` : ""}`,
  ).join("\n");
  return `RELATED STYLES (close, but NOT identical — soft ranking only):
The pairs below are stylistically adjacent. If the customer's exact style isn't in stock, you MAY include a related item as a LOWER-confidence ("medium" or "low") alternative — but ONLY when it still satisfies EVERY attribute the customer explicitly specified (brand, metal color, metal type, stone origin, item type, primary gemstone, and any named setting). A related style is NEVER a "high"-confidence exact match and NEVER justifies crossing one of those hard gates.
${lines}`;
}

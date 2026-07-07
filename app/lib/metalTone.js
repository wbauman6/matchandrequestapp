// Metal vs. visual tone — a specificity distinction driven by how the customer
// phrases the request.
//
// - A SPECIFIC METAL ("yellow gold", "white gold", "sterling silver", "platinum",
//   "14k yellow gold") is an ABSOLUTE MATERIAL gate: only that actual metal;
//   plated / merely-same-toned lookalikes are EXCLUDED.
// - A COLOR/TONE ("yellow toned", "silver toned", "rose toned", or describing the
//   look) is a BROADER VISUAL-TONE gate: include every material that reads as that
//   tone (per the mapping below).
//
// >>> EDIT THIS MAPPING to change which materials count as each visual tone. <<<
export const TONE_TO_MATERIALS = {
  "yellow / gold tone": [
    "yellow gold",
    "yellow gold plated (YGP) / gold-filled / gold-tone",
    "any yellow-toned metal",
  ],
  "silver / white tone": [
    "sterling silver",
    "silver plated",
    "white gold",
    "rhodium / steel / other silver-white metals",
  ],
  "rose / pink tone": [
    "rose gold",
    "rose gold plated (RGP)",
    "any rose/pink-toned metal",
  ],
  "two-tone (as a look)": [
    "any two-tone appearance, regardless of the exact materials",
  ],
};

// Renders the mapping + rules as a prompt section injected into the matching
// prompts, so editing TONE_TO_MATERIALS immediately changes matching behavior.
export function metalToneRules() {
  const mapping = Object.entries(TONE_TO_MATERIALS)
    .map(([tone, mats]) => `    · ${tone} → ${mats.join("; ")}`)
    .join("\n");
  return `METAL vs TONE (a specificity distinction based on the customer's EXACT wording):
- If the customer names a SPECIFIC METAL / MATERIAL (e.g. "yellow gold", "white gold", "rose gold", "sterling silver", "platinum", "14k yellow gold"), treat it as an ABSOLUTE MATERIAL gate: the product's ACTUAL metal must BE that metal. EXCLUDE plated or merely same-toned lookalikes — e.g. a "yellow gold" request must NOT match yellow-gold-plated (YGP), gold-filled, or yellow-toned fashion metal; a "white gold" request must NOT match sterling silver or silver-plated.
- If the customer names a COLOR / TONE or describes the LOOK (e.g. "yellow toned", "gold toned", "silver toned", "white toned", "rose/pink toned"), treat it as a BROADER VISUAL-TONE gate: INCLUDE any item whose appearance matches that tone, across materials:
${mapping}
- "two-tone": as a LOOK (e.g. "two-tone necklace") → include any two-tone appearance; as a specific MATERIAL (e.g. "two-tone 14k gold") → the narrower material gate.
- Determine BOTH the product's actual metal and its visual tone from its title, tags, and description, then match against whichever the request specified.
- KARAT (10k / 14k / 18k) is never a gate. If the customer specifies NEITHER a specific metal NOR a tone, do NOT filter on metal or tone at all.`;
}

// Lightweight heuristic (for tests/telemetry only; the LLM does the real work):
// does the request phrase a SPECIFIC METAL, a TONE, or NEITHER?
const TONE_RE = /\b(tone[d]?|toned|colou?red|colou?r)\b/i;
const METAL_RE = /\b(gold|platinum|sterling|silver|palladium|titanium|steel|plated|vermeil|gold[-\s]?filled)\b/i;
export function metalToneIntent(text) {
  const t = String(text || "");
  if (TONE_RE.test(t)) return "tone";
  if (METAL_RE.test(t)) return "metal";
  return "none";
}

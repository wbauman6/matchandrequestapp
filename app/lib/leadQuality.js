import { namesDesignerBrand } from "./requestKind.js";

/**
 * Lead quality triage for storefront (wishlist) submissions.
 *
 * A shopper typing "2 cool rings" or "stunning earrings" has told us nothing a
 * matcher can use — no metal, no stone, no style, and sometimes more than one
 * item. Running the full pipeline on that costs a real Anthropic bill (the
 * reasoning pass alone ran 76s on a broad request) and returns noise the
 * salesperson has to wade through.
 *
 * So weak leads are diverted BEFORE matching: they land in a "needs a call"
 * queue where the salesperson phones the shopper and types what they actually
 * want. Saving that converts it into a normal request and starts matching.
 *
 * Detection is deliberately cheap and deterministic here — no AI call needed
 * for the obvious cases. app/lib/leadQuality.server.js layers an AI opinion on
 * top only for the genuinely ambiguous middle.
 */

/** Attributes that make a request matchable at all. */
const METALS = /\b(gold|silver|platinum|plat|palladium|titanium|tungsten|steel|sterling|vermeil|wg|yg|rg|karat|carat\s*gold|\d{1,2}\s*k\b|\d{3}\b)/i;
const COLORS = /\b(white|yellow|rose|pink|green|black|two[\s-]?tone|tri[\s-]?color|multi)/i;
const STONES = /\b(diamond|dia\b|ruby|sapphire|sapph|emerald|emer|pearl|opal|topaz|amethyst|garnet|peridot|aquamarine|morganite|tanzanite|tourmaline|citrine|turquoise|jade|onyx|moissanite|cz|cubic\s*zirconia|zircon|spinel|alexandrite|moonstone|lapis|coral|amber|quartz|birthstone)/i;
const ITEM_TYPES = /\b(ring|band|necklace|pendant|chain|bracelet|bangle|cuff|earring|stud|hoop|huggie|brooch|pin|watch|locket|charm|anklet|choker|signet|cufflink)/i;
const STYLE_OR_CUT = /\b(halo|solitaire|eternity|tennis|station|cluster|three[\s-]stone|vintage|antique|estate|art\s*deco|victorian|edwardian|nouveau|retro|emerald\s*cut|princess|cushion|oval|pear|marquise|asscher|radiant|baguette|cabochon|round|brilliant|rose\s*cut|old\s*mine|old\s*european|pave|milgrain|filigree|bezel|channel|invisible|engagement|wedding|anniversary)/i;
const BRAND = /\b(tiffany|cartier|rolex|van\s*cleef|vca|bvlgari|bulgari|david\s*yurman|yurman|patek|audemars|omega|tag\s*heuer|seiko|grand\s*seiko|hermes|chanel|gucci|mikimoto)/i;

/** Words that carry feeling but no specification. */
const SUBJECTIVE_ONLY = /\b(cool|nice|pretty|beautiful|stunning|gorgeous|cute|lovely|amazing|awesome|fancy|elegant|classy|unique|special|different|interesting|good|great|best|fun|sparkly|blingy|shiny|dainty|simple|bold|statement)\b/i;

/**
 * Plural or enumerated multiple items: "2 rings", "rings and a necklace".
 *
 * BIAS HEAVILY TOWARD "SINGLE". Jewelers write one item with specs and
 * alternatives, and it reads like several things to a naive matcher:
 *   "7 ct lab tennis necklace / 5 to 7 estate tennis necklace"  -> ONE necklace
 *   "Estate 0.25-0.30 ct tw Diamond studs 300.00-400 price point" -> ONE pair
 * Wrongly diverting a real request to a callback queue is far worse than
 * letting a genuine two-item request through, so a number only counts as a
 * COUNT when it is not a measurement and not part of a range.
 */

// A number glued to a unit is a SPECIFICATION, never a quantity of items.
const SPEC_UNIT = String.raw`(?:ct|ctw|cttw|tw|carats?|karats?|k|kt|mm|cm|inch(?:es)?|in|"|g|gr|grams?|pts?|points?|dwt|%|\$)`;
// Metal/style descriptors that LOOK like counts. "2 tone bands" is a two-tone
// band, not two bands; "3 stone ring" is a trilogy, not three rings.
const COUNT_LOOKALIKE = String.raw`\b(?:2|two|3|three|tri)[\s-]*(?:tone|toned|color|colour|stone|row|rows|band)\b`;

const ITEM_NOUN = String.raw`(?:rings?|bands?|necklaces?|pendants?|chains?|bracelets?|bangles?|earrings?|studs?|hoops?|brooches?|pins?|watches?|lockets?|charms?)`;

// A range ("5-7", "5 to 7", ".25-.30") is a spec, never a count.
const RANGE = String.raw`\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+`;

/**
 * "2 rings" counts. "7 ct ... necklace" does not, because 7 is a weight.
 * The number must NOT be followed by a unit, and must not sit inside a range.
 */
const MULTI_COUNT = new RegExp(
  String.raw`\b(?:(\d+)|two|three|four|five|several|multiple|a\s*few|couple)\s+` +
    // the words between the number and the noun must not contain a unit
    String.raw`(?!${SPEC_UNIT}\b)(?:(?!${SPEC_UNIT}\b)\w+\s+){0,2}${ITEM_NOUN}\b`,
  "i",
);

const MULTI_JOIN = new RegExp(
  String.raw`\b${ITEM_NOUN}\b[^.]{0,30}\b(?:and|plus|also|&|\+)\b[^.]{0,30}\b${ITEM_NOUN}\b`,
  "i",
);

/** Reasons a lead can't be matched as written. */
export const REASONS = {
  TOO_SHORT: "too_short",
  MULTIPLE_ITEMS: "multiple_items",
  NO_ATTRIBUTES: "no_attributes",
  SUBJECTIVE_ONLY: "subjective_only",
};

export const REASON_TEXT = {
  [REASONS.TOO_SHORT]: "Barely any detail to go on",
  [REASONS.MULTIPLE_ITEMS]: "Asks for more than one item",
  [REASONS.NO_ATTRIBUTES]: "No metal, stone, or style to match on",
  [REASONS.SUBJECTIVE_ONLY]: "Only describes a feeling, not a piece",
};

/**
 * How many distinct matchable attributes does this text carry?
 * Item type alone ("a ring") is not enough to match usefully.
 */
export function attributeCount(text) {
  const t = String(text || "");
  let n = 0;
  if (METALS.test(t)) n++;
  if (COLORS.test(t)) n++;
  if (STONES.test(t)) n++;
  if (STYLE_OR_CUT.test(t)) n++;
  if (BRAND.test(t)) n++;
  return n;
}

export function mentionsItemType(text) {
  return ITEM_TYPES.test(String(text || ""));
}

export function asksForMultipleItems(text) {
  const t = String(text || "");
  // Blank out every range and measurement FIRST, so their digits can never be
  // mistaken for a quantity. "5 to 7 estate tennis necklace" is one necklace,
  // not seven. Masking is safer than lookarounds here because a spec can sit
  // anywhere between the number and the noun.
  const masked = t
    .replace(new RegExp(COUNT_LOOKALIKE, "gi"), " ")
    .replace(new RegExp(RANGE, "gi"), " ")
    .replace(new RegExp(String.raw`\d+(?:[./]\d+)?\s*${SPEC_UNIT}\b`, "gi"), " ");
  return MULTI_COUNT.test(masked) || MULTI_JOIN.test(masked);
}

/**
 * Assess a lead.
 *
 * @returns {{ ok: boolean, reasons: string[], confidence: "clear"|"borderline" }}
 *   ok:false means divert to the call queue. `confidence: "borderline"` marks
 *   cases where an AI second opinion is worth the (small) cost.
 */
export function assessLead(description) {
  const text = String(description || "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const reasons = [];

  // A named designer brand or model is the STRONGEST signal a lead can carry,
  // and it is routinely written in two words: "Rolex Submariner", "Van clef",
  // "HUBLOT FUSION". Checked before the length and attribute rules, which
  // would otherwise flag exactly the requests a salesperson most wants.
  //
  // Validated against the live store: without this, 4 of 57 real item
  // requests were diverted to the call queue, and all 4 were good leads.
  if (namesDesignerBrand(text)) {
    return { ok: true, reasons: [], confidence: "clear" };
  }

  if (words.length < 3) {
    // Nothing to reason about — no AI call needed.
    return { ok: false, reasons: [REASONS.TOO_SHORT], confidence: "clear" };
  }

  if (asksForMultipleItems(text)) reasons.push(REASONS.MULTIPLE_ITEMS);

  const attrs = attributeCount(text);
  if (attrs === 0) {
    reasons.push(mentionsItemType(text) ? REASONS.NO_ATTRIBUTES : REASONS.TOO_SHORT);
  }

  // Subjective adjectives only matter when nothing concrete accompanies them.
  if (attrs === 0 && SUBJECTIVE_ONLY.test(text)) reasons.push(REASONS.SUBJECTIVE_ONLY);

  if (reasons.length > 0) {
    // One weak signal on a longer description is worth a second opinion;
    // several signals, or a very short text, is clear-cut.
    const clear = reasons.length > 1 || words.length < 6;
    return { ok: false, reasons: [...new Set(reasons)], confidence: clear ? "clear" : "borderline" };
  }

  // Has attributes but only one, and it's short — ambiguous enough to verify.
  if (attrs === 1 && words.length < 6) {
    return { ok: true, reasons: [], confidence: "borderline" };
  }

  return { ok: true, reasons: [], confidence: "clear" };
}

/** Human-readable summary for the call queue. */
export function describeReasons(reasons) {
  const list = (reasons || []).map((r) => REASON_TEXT[r]).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1].toLowerCase()}`;
}

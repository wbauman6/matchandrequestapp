/**
 * What KIND of thing is this request?
 *
 * Not every submission is a request for a piece of inventory. The live store
 * has received, through the same form:
 *
 *   "Wanting to get information on the personalized back chain..."  -> 113 matches
 *   "2 engagement rings with bands soddered."                       ->  55 matches
 *   "Hi, are you hiring? I have over 20 years of experience..."
 *   "Instead of sending a generic message, I reviewed your site..."  (cold outreach)
 *   "Do you buy strands of pearls & black onyx with gold beads?"
 *   "I need to have my fiance's engagement ring resized"
 *
 * A question about personalisation generated 113 matches and a soldering job
 * generated 55 — hundreds of Anthropic calls spent on things inventory cannot
 * answer, and a plausible cause of the 511/500 budget breach.
 *
 * These are not vague item requests. They are a different kind of thing, and
 * they must be routed to staff instead of the matcher.
 *
 * DESIGN RULE: fail toward "item". Wrongly withholding a real request from
 * matching is far worse than letting junk through — a missed lead is lost
 * money, whereas junk only costs a few AI calls. Every rule below therefore
 * requires positive evidence of a non-item intent, never merely the absence of
 * item-like words.
 */

export const KINDS = {
  ITEM: "item",
  SERVICE: "service",
  BUYING: "buying",
  QUESTION: "question",
  PRICE: "price",
  SPAM: "spam",
};

export const KIND_LABEL = {
  [KINDS.ITEM]: "Looking for an item",
  [KINDS.SERVICE]: "Repair or service",
  [KINDS.BUYING]: "Wants to sell to us",
  [KINDS.QUESTION]: "General question",
  [KINDS.PRICE]: "Asking about price",
  [KINDS.SPAM]: "Not a customer",
};

/** Work done TO a piece, rather than a piece being sought. */
const SERVICE = [
  /\bresiz(?:e|ed|ing)\b/i,
  /\bsolder(?:ed|ing)?\b|\bsodder(?:ed|ing)?\b/i, // misspelling is common
  /\brepair(?:ed|ing|s)?\b/i,
  /\bfix(?:ed|ing)?\s+(?:my|our|this|the|a)\b/i,
  /\bclean(?:ed|ing)\s+(?:my|our|this|the)\b/i,
  /\brhodium\b|\bre[\s-]?dip(?:ped|ping)?\b/i,
  /\breset(?:ting)?\s+(?:my|our|the|this)\b/i,
  /\brestring(?:ing)?\b|\brestrung\b/i,
  /\bapprais(?:al|e|ed|ing)\b/i,
  /\bengrav(?:e|ed|ing)\b/i,
  /\bcustom\s+(?:design|made|make|order|piece|ring|setting)\b/i,
  /\bmy\s+(?:ring|necklace|bracelet|watch|chain|pendant|earrings?)\b/i,
  /\bbattery\s+(?:replace|change|replacement)\b/i,
  /\bwatch\s+(?:service|repair|overhaul)\b/i,
];

/** The store would be BUYING, not selling. Goods flow toward us. */
const BUYING = [
  /\bdo\s+(?:you|u)\s+(?:buy|purchase|take|accept)\b/i,
  /\bwould\s+you\s+(?:buy|purchase|be\s+interested\s+in\s+buying)\b/i,
  /\b(?:i|we)\s+(?:want|would\s+like|am\s+looking)\s+to\s+sell\b/i,
  /\bsell(?:ing)?\s+(?:my|our|some|a)\b/i,
  /\bconsign(?:ment|ing)?\b/i,
  /\bwhat\s+(?:would|will)\s+you\s+(?:give|pay|offer)\b/i,
  /\bpurchases?\s+pre[\s-]?owned\b/i,
  /\bbuy\s+(?:gold|silver|diamonds?|jewelry|jewellery|estate)\b/i,
];

/** Asking about terms rather than seeking a piece. */
const PRICE = [
  /\blowest\s+price\b/i,
  /\bbest\s+price\s+(?:you|on)\b/i,
  /\bprice\s+you\s+would\s+accept\b/i,
  /\bnegotiat(?:e|ing|ion)\b/i,
  /\bdiscount\b/i,
  /\bhow\s+much\s+(?:is|for|would)\b.*\?/i,
  /\bmake\s+(?:me\s+)?an?\s+offer\b/i,
];

/** Wants information, not inventory. */
const QUESTION = [
  /\b(?:get|want|wanting|need|looking\s+for)\s+information\s+(?:on|about)\b/i,
  /\bdo\s+(?:you|u)\s+(?:offer|do|carry|have\s+the\s+ability|provide)\b/i,
  /\bcan\s+(?:you|u)\s+(?:personalize|personalise|customize|customise|engrave|order|get|make)\b/i,
  /\bare\s+(?:you|u)\s+(?:open|hiring|located)\b/i,
  /\bwhat\s+(?:are|is)\s+your\s+(?:hours|policy|policies|terms)\b/i,
  /\bhow\s+(?:do|does|long|can)\s+(?:i|you|it)\b.*\?/i,
  /\bquestion\s+about\b/i,
];

/** Not a customer at all. */
const SPAM = [
  /\bare\s+you\s+hiring\b/i,
  /\b(?:job|employment|position|resume|cv|apply)\b.*\b(?:opportunit|opening|experience)\b/i,
  /\byears\s+of\s+experience\s+in\s+the\s+(?:jewelry|jewellery)\b/i,
  /\breviewed\s+your\s+(?:site|website)\s+in\s+detail\b/i,
  /\b(?:seo|marketing|web\s+design|social\s+media|lead\s+generation|increase\s+your\s+sales)\b/i,
  /\bgeneric\s+message\b/i,
  /\bi\s+(?:can|could)\s+help\s+(?:you|your\s+(?:business|store|site))\b/i,
  /\bpartnership\s+opportunit/i,
];

const GROUPS = [
  [KINDS.SPAM, SPAM],
  [KINDS.BUYING, BUYING],
  [KINDS.SERVICE, SERVICE],
  [KINDS.PRICE, PRICE],
  [KINDS.QUESTION, QUESTION],
];

/**
 * Classify a request.
 *
 * Order matters: spam is checked first (a recruitment email may also mention
 * jewelry), then buying, then service, then price, then question. A request
 * matching nothing is an item request.
 *
 * @returns {{ kind: string, reason: string|null }}
 */
export function classifyRequest(description) {
  const text = String(description || "").trim();
  if (!text) return { kind: KINDS.ITEM, reason: null };

  for (const [kind, patterns] of GROUPS) {
    const hit = patterns.find((re) => re.test(text));
    if (hit) return { kind, reason: String(hit).slice(0, 80) };
  }
  return { kind: KINDS.ITEM, reason: null };
}

/** Should this request go through AI matching at all? */
export function shouldMatch(kind) {
  return (kind || KINDS.ITEM) === KINDS.ITEM;
}

/** Designer brands the store carries. Used by the appraiser dashboard. */
export const DESIGNER_BRANDS = [
  "tiffany", "cartier", "van cleef", "vca", "david yurman", "yurman",
  "bvlgari", "bulgari", "rolex", "patek", "audemars", "omega", "tag heuer",
  "breitling", "seiko", "grand seiko", "tudor", "hermes", "chanel", "gucci",
  "mikimoto", "lagos", "john hardy", "roberto coin", "marco bicego",
  "charriol", "montblanc", "lalaounis", "enewton", "pandora", "swarovski",
  "effy", "le vian", "levian", "hearts on fire", "verragio", "tacori",
  "hublot", "panerai", "iwc", "jaeger", "longines", "movado", "citizen",
  "bulova", "raymond weil", "baume", "zenith", "chopard", "piaget",
  "harry winston", "graff", "buccellati", "pomellato", "damiani",
  "alex and ani", "kendra scott", "brighton", "judith ripka", "konstantino",
];

/**
 * Model names that identify a brand without naming it. A salesperson writing
 * "18k yellow Gold Love Bracelet" means Cartier; the appraiser does not need
 * to identify it, so it must not land in their queue.
 */
const DESIGNER_MODELS = [
  "love bracelet", "juste un clou", "trinity ring", "panthere",
  "submariner", "datejust", "daytona", "gmt-master", "gmt master",
  "oyster perpetual", "seamaster", "speedmaster", "constellation",
  "royal oak", "nautilus", "aquanaut", "big bang", "fusion",
  "alhambra", "clash de", "tank ", "santos", "ballon bleu",
  "serpenti", "b.zero1", "divas dream", "cable classic", "albion",
];

/**
 * Does this request name a designer brand?
 *
 * The appraiser works on NON-designer pieces — a signed Cartier bracelet needs
 * no appraisal to identify, whereas an unsigned estate ring does.
 *
 * IMPORTANT: pass NORMALIZED request text. Staff type brands the way they say
 * them ("e newton" for enewton), so checking raw text misses them and drops a
 * branded request into the appraiser's queue.
 */
export function namesDesignerBrand(description) {
  const t = String(description || "").toLowerCase();
  return (
    DESIGNER_BRANDS.some((b) => t.includes(b)) ||
    DESIGNER_MODELS.some((m) => t.includes(m))
  );
}

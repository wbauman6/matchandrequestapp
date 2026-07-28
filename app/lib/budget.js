// Tiered budget tolerance. An item priced up to (budget × (1 + tolerance)) is
// still shown, but flagged "over budget" and ranked below all in-budget items.
// Beyond the tolerance it is excluded. Budget is a SOFT ranking factor — it NEVER
// overrides the absolute attribute gates (metal color, origin, setting, item
// type, brand). Ranges are contiguous and lower-bound-inclusive:
//   [$0,$500) → +50% | [$500,$2,000) → +25% | [$2,000,$5,000) → +15% | [$5,000,∞) → +10%
//
// >>> EDIT THIS to adjust the thresholds and percentages. <<<
export const BUDGET_TOLERANCE_TIERS = [
  { upTo: 500, tolerance: 0.5 }, // under $500 → +50%
  { upTo: 2000, tolerance: 0.25 }, // $500 to under $2,000 → +25%
  { upTo: 5000, tolerance: 0.15 }, // $2,000 to under $5,000 → +15%
  { upTo: Infinity, tolerance: 0.1 }, // $5,000 and up → +10%
];

export function budgetToleranceFor(budget) {
  const tier = BUDGET_TOLERANCE_TIERS.find((t) => budget < t.upTo);
  return tier ? tier.tolerance : 0;
}

// Highest price still shown for a given budget (budget + its tier's tolerance).
// Rounded to cents to avoid float drift (e.g. 3000×1.15 = 3449.9999…).
export function budgetCeiling(budget) {
  return Math.round(budget * (1 + budgetToleranceFor(budget)) * 100) / 100;
}

// Passes the budget filter: no budget set, or price within the tier ceiling.
export function withinBudget(budget, price) {
  if (!budget || price == null) return true;
  return price <= budgetCeiling(budget);
}

// Over budget but still within tolerance (shown, but flagged + ranked below).
export function isOverBudget(budget, price) {
  if (!budget || price == null) return false;
  return price > budget && price <= budgetCeiling(budget);
}

// Extract a new budget from a refinement note. Handles "$8,000", "budget up to
// $8,000", "raise budget to 8k", "under $5000", "max 3000". Returns the number,
// or null if the note has no clear budget instruction. Deliberately
// conservative to avoid false positives: a bare "8k" is NOT read as a budget
// (it may be "14k gold"), and "under 1 carat" is NOT read as a $1 budget — a
// budget needs either a currency "$" or a budget cue word, and a plausibly
// budget-sized amount.
export function parseBudgetFromNotes(notes) {
  if (!notes) return null;
  const text = String(notes);

  // 1) Explicit currency (optionally with "k") — unambiguous.
  let m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (m[2]) n *= 1000;
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // 2) Budget cue word + amount. The cue disambiguates "budget 8k" from
  //    "14k gold"; without an explicit "k", require ≥ 100 so a size/quantity
  //    ("under 1 carat", "max 5 stones") isn't mistaken for a budget.
  m = text.match(/(?:budget|up ?to|under|below|max(?:imum)?|spend)\s*(?:of|to|is|:)?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    if (m[2]) n *= 1000;
    else if (n < 100) return null;
    return n > 0 ? n : null;
  }
  return null;
}

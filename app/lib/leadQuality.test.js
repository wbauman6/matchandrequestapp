import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessLead,
  attributeCount,
  asksForMultipleItems,
  describeReasons,
  REASONS,
} from "./leadQuality.js";

// A weak wishlist lead used to run the full pipeline: ~76s of Anthropic
// reasoning to return noise. These are diverted to a call queue instead.

test("ACCEPTANCE: the examples that motivated this are rejected", () => {
  const a = assessLead("2 cool rings");
  assert.equal(a.ok, false, '"2 cool rings" must not be matched');
  assert.ok(a.reasons.includes(REASONS.MULTIPLE_ITEMS), "should notice more than one item");

  const b = assessLead("stunning earrings");
  assert.equal(b.ok, false, '"stunning earrings" must not be matched');
});

test("real specific requests pass through", () => {
  for (const good of [
    "14K white gold diamond engagement ring, emerald cut, around 1 carat",
    "yellow gold sapphire cluster ring size 6",
    "estate art deco platinum filigree ring with old european cut diamond",
    "Tiffany & Co. sterling silver bracelet",
    "rose gold morganite halo ring",
    "tennis bracelet 2 carat total weight white gold",
  ]) {
    const r = assessLead(good);
    assert.equal(r.ok, true, `should accept: "${good}" (reasons: ${r.reasons})`);
  }
});

test("REGRESSION: jeweler specs and ranges are ONE item, not several", () => {
  // Staff write a single item with weights, ranges and alternatives. Reading
  // "5 to 7 estate tennis necklace" as seven necklaces would divert a genuine
  // request to the callback queue. Verified against all 60 live requests:
  // these produce zero false positives.
  for (const single of [
    "7 ct lab tennis necklace 5 to 7 estate tennis necklace",
    "7 ct estate necklace 5-7 estate",
    "Estate 0.25-0.30 ct tw Diamond studs 300.00-400 price point",
    "2 ct each martini round lab earings",
    "14k white Gold 1/2 carat tw blue sapphire studs",
    "LOOKING FOR .33 TW 14K WG DIAMOND STUDS MARTINI SETTING",
    "18 inch 2.5 mm box chain",
    "5 to 7 carat estate tennis necklace",
    // "2 tone" is a metal, not a quantity; "3 stone" is a trilogy setting.
    "Rolex watch. Gold. Also like 2 tone bands.",
    "3 stone diamond ring",
    "two tone rolex bracelet",
  ]) {
    assert.equal(asksForMultipleItems(single), false, `should be ONE item: "${single}"`);
  }
});

test("multiple items are detected by count and by conjunction", () => {
  assert.equal(asksForMultipleItems("2 rings"), true);
  assert.equal(asksForMultipleItems("two gold rings"), true);
  assert.equal(asksForMultipleItems("a few bracelets"), true);
  assert.equal(asksForMultipleItems("a ring and a necklace"), true);
  assert.equal(asksForMultipleItems("earrings plus a pendant"), true);
  // Not multiple: one item, plural styling words, or stones within one piece.
  assert.equal(asksForMultipleItems("a ring with three diamonds"), false);
  assert.equal(asksForMultipleItems("diamond stud earrings"), false);
});

test("REGRESSION: 'earrings' is one item even though it is plural", () => {
  // A pair of earrings is a single product. Flagging it as "multiple items"
  // would divert most legitimate earring requests to the call queue.
  const r = assessLead("14k white gold diamond stud earrings");
  assert.equal(r.ok, true);
  assert.equal(asksForMultipleItems("stud earrings"), false);
});

test("attributeCount finds the dimensions matching needs", () => {
  assert.equal(attributeCount("cool thing"), 0);
  assert.ok(attributeCount("14k gold ring") >= 1);
  assert.ok(attributeCount("white gold diamond halo") >= 3);
  assert.ok(attributeCount("Cartier ring") >= 1);
});

test("an item type alone is not enough to match on", () => {
  const r = assessLead("looking for a bracelet please");
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes(REASONS.NO_ATTRIBUTES));
});

test("subjective-only descriptions are flagged", () => {
  const r = assessLead("something really pretty and unique for my wife");
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes(REASONS.SUBJECTIVE_ONLY));
});

test("subjective words alongside real detail are fine", () => {
  // "beautiful" is not a problem when the rest specifies a piece.
  const r = assessLead("beautiful 18k yellow gold emerald cut diamond ring");
  assert.equal(r.ok, true);
});

test("near-empty input is rejected without needing an AI opinion", () => {
  for (const bad of ["", "   ", "ring", "hi", "help"]) {
    const r = assessLead(bad);
    assert.equal(r.ok, false, `should reject: "${bad}"`);
    assert.equal(r.confidence, "clear", "trivial cases must not cost an AI call");
  }
});

test("borderline cases are marked for a second opinion", () => {
  // One attribute and short, but not trivially short: worth verifying rather
  // than accepting or rejecting outright. ("gold ring" at 2 words is caught
  // earlier as too_short, which is correct and costs no AI call.)
  const r = assessLead("a gold ring");
  assert.equal(r.ok, true);
  assert.equal(r.confidence, "borderline");

  const r2 = assessLead("diamond ring for her");
  assert.equal(r2.confidence, "borderline");

  // Two or more attributes reads as specific enough to match directly.
  assert.equal(assessLead("yellow gold ring").confidence, "clear");
  assert.equal(assessLead("white gold diamond ring").confidence, "clear");
});

test("multiple problems make a case clear-cut, not borderline", () => {
  const r = assessLead("2 cool rings");
  assert.equal(r.confidence, "clear");
});

test("describeReasons reads as plain English for the call screen", () => {
  assert.match(describeReasons([REASONS.MULTIPLE_ITEMS]), /more than one item/i);
  const both = describeReasons([REASONS.MULTIPLE_ITEMS, REASONS.NO_ATTRIBUTES]);
  assert.match(both, /and/);
  assert.equal(describeReasons([]), "");
});

test("reasons never duplicate", () => {
  const r = assessLead("2 cool nice pretty rings");
  assert.equal(r.reasons.length, new Set(r.reasons).size);
});

test("REGRESSION: a named brand is never a vague lead, however short", () => {
  // All four were flagged by the original rules and diverted to the call
  // queue. They are the strongest leads in the store: brand, often model.
  // The length and attribute rules fired before anything looked for a brand.
  for (const good of [
    "Rolex Submariner",
    "Van clef",
    "HUBLOT ANY HUBLOT FUSION",
    "Gents tudor watch BB58 Montblanc Iced Sea Longines Legend Diver",
    "Small yg cartier love bracelet",
    "silver e newton",
  ]) {
    assert.equal(assessLead(good).ok, true, `must not be flagged vague: "${good}"`);
  }
});

test("the merchant's own examples of a bad lead are still caught", () => {
  for (const bad of ["2 cool rings", "stunning earrings", "a gift", "something sparkly"]) {
    assert.equal(assessLead(bad).ok, false, `must be flagged: "${bad}"`);
  }
});

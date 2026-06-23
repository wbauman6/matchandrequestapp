import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeKeywordWeights,
  weightedMatch,
  definingKeywords,
  computeMatch,
  isSoftCategory,
  priceProximity,
  blendScore,
} from "./matching.js";
import { isMustHaveTag } from "./tagTiers.js";

// Build a synthetic catalog and score one request against it the way
// runMatchesForRequest does: compute IDF weights over the corpus, derive the
// hard-required (defining) keywords, then weightedMatch each product.
function scoreAgainst(keywords, corpus, product, required) {
  const weights = computeKeywordWeights(keywords, corpus);
  const req =
    required ?? definingKeywords(keywords, weights).filter((k) => !isSoftCategory(k));
  return weightedMatch(keywords, weights, product.tags, product.title || "", req);
}

function makeCorpus(spec) {
  const products = [];
  for (const [n, tags] of spec) {
    for (let i = 0; i < n; i++) products.push({ tags, title: "" });
  }
  return products;
}

test("ACCEPTANCE: 'tiffany heart bracelet' matches only Tiffany bracelets with a heart", () => {
  const keywords = ["tiffany & co.", "bracelet", "heart"];
  // All three are defining (brand + item type + motif) in the curated map.
  const required = keywords.filter(isMustHaveTag);
  assert.deepEqual(required, ["tiffany & co.", "bracelet", "heart"]);

  const corpus = makeCorpus([
    [800, ["bracelet", "gold"]], // many plain bracelets
    [600, ["tiffany & co.", "ring", "diamond"]], // Tiffany rings
    [500, ["bracelet", "heart", "silver"]], // heart bracelets, not Tiffany
    [40, ["tiffany & co.", "bracelet", "heart"]], // the real thing
  ]);

  const tiffanyHeartBracelet = scoreAgainst(
    keywords,
    corpus,
    { tags: ["tiffany & co.", "bracelet", "heart"] },
    required,
  );
  const plainBracelet = scoreAgainst(
    keywords,
    corpus,
    { tags: ["bracelet", "gold", "heart"] },
    required,
  );
  const tiffanyRing = scoreAgainst(
    keywords,
    corpus,
    { tags: ["tiffany & co.", "ring", "heart"] },
    required,
  );

  assert.ok(tiffanyHeartBracelet.score > 0, "genuine match should score > 0");
  assert.equal(plainBracelet.score, 0, "non-Tiffany bracelet must be excluded");
  assert.equal(tiffanyRing.score, 0, "Tiffany ring must be excluded");
});

test("REGRESSION: old flat tag-overlap over-firing is gone", () => {
  // Under the old OR-any-tag matcher, every bracelet, everything Tiffany, and
  // everything with a heart matched independently. Assert that sharing a single
  // common tag is NOT enough now.
  const keywords = ["tiffany & co.", "bracelet", "heart"];
  const required = keywords.filter(isMustHaveTag);
  const corpus = makeCorpus([
    [1000, ["bracelet"]],
    [40, ["tiffany & co.", "bracelet", "heart"]],
  ]);
  const sharesOnlyBracelet = scoreAgainst(
    keywords,
    corpus,
    { tags: ["bracelet"] },
    required,
  );
  assert.equal(sharesOnlyBracelet.score, 0, "sharing one common tag must not match");
});

test("multi-word keyword requires all significant words (estate rolex != plain estate)", () => {
  const keywords = ["estate rolex", "estate watch"];
  const corpus = makeCorpus([
    [700, ["estate", "diamond", "ring"]],
    [6, ["estate rolex", "estate watch", "rolex"]],
  ]);
  const weights = computeKeywordWeights(keywords, corpus);
  const required = definingKeywords(keywords, weights);

  const estateRing = weightedMatch(keywords, weights, ["estate", "diamond", "ring"], "", required);
  const rolex = weightedMatch(keywords, weights, ["estate rolex", "estate watch", "rolex"], "", required);

  assert.equal(estateRing.score, 0, "plain estate item must not match 'estate rolex'");
  assert.ok(rolex.score > 0, "real estate rolex must match");
});

test("soft/descriptive facets never hard-exclude (blue dial still matches grey dial)", () => {
  // dialc:* is a soft category — a request for a blue dial must still surface a
  // grey dial of the same brand/type.
  assert.equal(isSoftCategory("dialc:blue"), true);
  assert.equal(isSoftCategory("antique:yes"), true);
  assert.equal(isSoftCategory("brand:cartier"), false);

  const keywords = ["estate rolex", "estate watch", "dialc:blue", "antique:yes"];
  const corpus = makeCorpus([
    [40, ["estate rolex", "estate watch", "dialc:blue"]],
    [40, ["estate rolex", "estate watch", "dialc:grey"]],
    [50, ["estate seiko", "estate watch", "dialc:blue"]],
  ]);
  const weights = computeKeywordWeights(keywords, corpus);
  const required = definingKeywords(keywords, weights);
  assert.ok(!required.includes("dialc:blue"), "color must not be a hard requirement");

  const greyRolex = weightedMatch(
    keywords, weights,
    ["estate rolex", "estate watch", "dialc:grey"], "", required,
  );
  const blueSeiko = weightedMatch(
    keywords, weights,
    ["estate seiko", "estate watch", "dialc:blue"], "", required,
  );
  assert.ok(greyRolex.score > 0, "grey-dial Rolex must still match a blue-dial Rolex request");
  assert.equal(blueSeiko.score, 0, "a Seiko must not match a Rolex request");
});

test("curated tier map: identity tags are must-have, descriptive are not", () => {
  for (const t of ["tiffany & co.", "bracelet", "heart", "sapphire", "14k", "type:Ring", "brand:Cartier"]) {
    assert.equal(isMustHaveTag(t), true, `${t} should be must-have`);
  }
  for (const t of ["dialc:blue", "gender:Men", "style:Art Deco", "clarity:VS1", "estate"]) {
    assert.equal(isMustHaveTag(t), false, `${t} should be should-have`);
  }
});

test("priceProximity: 1 within budget, decays to 0 at 2x, neutral when unknown", () => {
  assert.equal(priceProximity(1000, 800), 1);
  assert.equal(priceProximity(1000, 1000), 1);
  assert.equal(priceProximity(1000, 1500), 0.5);
  assert.equal(priceProximity(1000, 2000), 0);
  assert.equal(priceProximity(1000, 5000), 0);
  assert.equal(priceProximity(null, 5000), 1);
  assert.equal(priceProximity(1000, null), 1);
});

test("blendScore applies up to 15% price penalty, never inflates", () => {
  assert.equal(blendScore(100, 1), 100);
  assert.equal(blendScore(100, 0), 85);
  assert.equal(blendScore(80, 0.5), Math.round(80 * 0.925));
});

test("computeMatch (unweighted webhook path) still scores overlap fraction", () => {
  const r = computeMatch(["bracelet", "heart"], ["bracelet", "heart", "gold"], "");
  assert.equal(r.score, 100);
  const none = computeMatch(["bracelet", "heart"], ["ring", "gold"], "");
  assert.equal(none.score, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractMetal,
  metalPasses,
  extractItemType,
  normalizeItemType,
  itemTypePasses,
  extractBrand,
  brandPasses,
  extractStyles,
  stylePasses,
  extractProductAttributes,
  extractRequestAttributes,
  passesHardFilters,
} from "./attributes.js";

test("extractMetal normalizes colors and variants", () => {
  assert.equal(extractMetal(["14K Yellow Gold"]), "yellow_gold");
  assert.equal(extractMetal(["mat:14K Yellow Gold", "yellow gold"]), "yellow_gold");
  assert.equal(extractMetal(["White Gold ring"]), "white_gold");
  assert.equal(extractMetal(["18k rose gold"]), "rose_gold");
  assert.equal(extractMetal(["Sterling Silver"]), "sterling_silver");
  assert.equal(extractMetal(["SS bracelet"]), "sterling_silver");
  assert.equal(extractMetal(["Platinum"]), "platinum");
  assert.equal(extractMetal(["14k gold"]), "gold"); // unspecified color
  assert.equal(extractMetal(["diamond ring"]), "unknown");
});

test("extractMetal handles store title abbreviations (Y/W/R Gold, YGP)", () => {
  assert.equal(extractMetal(["14K Y Gold 5mm Wedding Band"]), "yellow_gold");
  assert.equal(extractMetal(["18K W Gold Diamond Ring"]), "white_gold");
  assert.equal(extractMetal(["14K R Gold Heart Pendant"]), "rose_gold");
  assert.equal(extractMetal(["YGP Coin Band"]), "yellow_gold");
});

test("extractMetal detects two-tone (explicit or multiple colors)", () => {
  assert.equal(extractMetal(["Two-Tone Gold"]), "two_tone");
  assert.equal(extractMetal(["14k tri-color"]), "two_tone");
  assert.equal(extractMetal(["yellow gold", "white gold"]), "two_tone");
  assert.equal(extractMetal(["platinum and yellow gold"]), "two_tone");
});

test("metalPasses: yellow gold request excludes white/rose/two-tone/unknown", () => {
  assert.equal(metalPasses("yellow_gold", "yellow_gold"), true);
  assert.equal(metalPasses("yellow_gold", "white_gold"), false);
  assert.equal(metalPasses("yellow_gold", "rose_gold"), false);
  assert.equal(metalPasses("yellow_gold", "two_tone"), false);
  assert.equal(metalPasses("yellow_gold", "gold"), false); // unspecified color excluded
  assert.equal(metalPasses("yellow_gold", "unknown"), false);
});

test("metalPasses: two-tone is its own category, both directions", () => {
  assert.equal(metalPasses("two_tone", "two_tone"), true);
  assert.equal(metalPasses("two_tone", "yellow_gold"), false);
  assert.equal(metalPasses("yellow_gold", "two_tone"), false);
});

test("metalPasses: no metal in request accepts all; 'gold' accepts any gold", () => {
  assert.equal(metalPasses(null, "white_gold"), true);
  assert.equal(metalPasses("unknown", "white_gold"), true);
  assert.equal(metalPasses("gold", "yellow_gold"), true);
  assert.equal(metalPasses("gold", "two_tone"), true);
  assert.equal(metalPasses("gold", "sterling_silver"), false);
});

test("item type normalization and gating", () => {
  assert.equal(normalizeItemType("type:Bracelet"), "bracelet");
  assert.equal(extractItemType(["Diamond Eternity Band"]), "ring");
  assert.equal(extractItemType(["Hoop Earrings"]), "earrings");
  assert.equal(extractItemType(["Tennis Bracelet"]), "bracelet");
  assert.equal(itemTypePasses("ring", "ring"), true);
  assert.equal(itemTypePasses("ring", "bracelet"), false);
  assert.equal(itemTypePasses("ring", null), false); // unknown excluded
  assert.equal(itemTypePasses(null, "ring"), true); // unspecified accepts all
});

test("brand normalization and gating", () => {
  assert.equal(extractBrand(["Tiffany & Co. bracelet"]), "tiffany & co.");
  assert.equal(extractBrand(["TIFFANY heart"]), "tiffany & co.");
  assert.equal(brandPasses("tiffany & co.", "tiffany & co."), true);
  assert.equal(brandPasses("tiffany & co.", "cartier"), false);
  assert.equal(brandPasses("tiffany & co.", null), false);
  assert.equal(brandPasses(null, "cartier"), true);
});

test("ACCEPTANCE: 'yellow gold ring' filters out white gold and non-rings", () => {
  const req = extractRequestAttributes({
    description: "yellow gold ring",
    keywords: ["yellow gold", "ring"],
  });
  assert.equal(req.metal, "yellow_gold");
  assert.equal(req.itemType, "ring");

  const yellowRing = extractProductAttributes({
    title: "14K Yellow Gold Diamond Ring",
    tags: ["yellow gold", "ring", "diamond"],
  });
  const whiteRing = extractProductAttributes({
    title: "14K White Gold Ring",
    tags: ["white gold", "ring"],
  });
  const yellowBracelet = extractProductAttributes({
    title: "14K Yellow Gold Bracelet",
    tags: ["yellow gold", "bracelet"],
  });

  assert.equal(passesHardFilters(req, yellowRing).pass, true);
  assert.equal(passesHardFilters(req, whiteRing).pass, false);
  assert.equal(passesHardFilters(req, yellowBracelet).pass, false);
});

test("extractStyles detects defining styles + variants, ignores vague terms", () => {
  assert.deepEqual(extractStyles(["Diamond Cluster Ring"]), ["cluster"]);
  assert.deepEqual(extractStyles(["clustered diamond pendant"]), ["cluster"]);
  assert.deepEqual(extractStyles(["Halo-Set Engagement Ring"]), ["halo"]);
  assert.deepEqual(extractStyles(["Pavé Eternity Band"]).sort(), ["eternity", "pave"]);
  assert.deepEqual(extractStyles(["elegant classic simple diamond ring"]), []);
  assert.deepEqual(extractStyles(["3-stone diamond ring"]), ["three-stone"]);
});

test("stylePasses requires all named defining styles (AND)", () => {
  assert.equal(stylePasses(["cluster"], ["cluster"]), true);
  assert.equal(stylePasses(["cluster"], ["halo"]), false);
  assert.equal(stylePasses(["cluster"], []), false);
  assert.equal(stylePasses([], ["halo"]), true); // none required -> pass
  assert.equal(stylePasses(["cluster", "halo"], ["cluster"]), false); // AND
  assert.equal(stylePasses(["cluster", "halo"], ["cluster", "halo"]), true);
});

test("ACCEPTANCE: 'diamond cluster' is a defining style; 'elegant' is not", () => {
  const cluster = extractRequestAttributes({ description: "diamond cluster", keywords: [] });
  assert.deepEqual(cluster.styles, ["cluster"]);
  const elegant = extractRequestAttributes({ description: "elegant diamond ring", keywords: [] });
  assert.deepEqual(elegant.styles, []); // vague -> no hard style filter
});

test("no request attributes -> everything passes (filters are opt-in)", () => {
  const req = extractRequestAttributes({ description: "something nice", keywords: [] });
  const anyProduct = extractProductAttributes({
    title: "Platinum Sapphire Brooch",
    tags: ["platinum", "brooch", "sapphire"],
  });
  assert.equal(passesHardFilters(req, anyProduct).pass, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFacets, categoryOf, parsePriceRange } from "./facets.js";

test("categoryOf classifies by namespace and curated map", () => {
  assert.equal(categoryOf("type:Ring"), "item_type");
  assert.equal(categoryOf("brand:Cartier"), "brand");
  assert.equal(categoryOf("theme:Animals & Insects"), "motif");
  assert.equal(categoryOf("shape:Cross"), "motif");
  assert.equal(categoryOf("mat:14K Yellow Gold"), "material");
  assert.equal(categoryOf("gemtyp:Emerald"), "gemstone");
  assert.equal(categoryOf("dialc:Blue"), "color");
  assert.equal(categoryOf("gender:Men"), "gender");
  assert.equal(categoryOf("bracelet"), "item_type");
  assert.equal(categoryOf("tiffany & co."), "brand");
  assert.equal(categoryOf("heart"), "motif");
  assert.equal(categoryOf("sapphire"), "gemstone");
  assert.equal(categoryOf("Batch#10.24.25a4"), "junk");
});

test("deriveFacets splits a request into typed facets", () => {
  const f = deriveFacets(["tiffany & co.", "bracelet", "heart", "diamond", "14k", "dialc:blue"]);
  assert.equal(f.brand, "tiffany & co.");
  assert.equal(f.item_type, "bracelet");
  assert.deepEqual(f.motif, ["heart"]);
  assert.deepEqual(f.gemstone, ["diamond"]);
  assert.deepEqual(f.material, ["14k"]);
  assert.deepEqual(f.color, ["dialc:blue"]);
});

test("deriveFacets drops junk", () => {
  const f = deriveFacets(["ring", "Batch#10.24.25a4", "created 02-11-26", "30offer"]);
  assert.equal(f.item_type, "ring");
  assert.equal(f.descriptive.length, 0);
});

test("parsePriceRange handles ranges and bounds", () => {
  assert.deepEqual(parsePriceRange("$500-1500"), { min: 500, max: 1500 });
  assert.deepEqual(parsePriceRange("1k to 3k"), { min: 1000, max: 3000 });
  assert.deepEqual(parsePriceRange("under $2000"), { min: 0, max: 2000 });
  assert.deepEqual(parsePriceRange("over 5k"), { min: 5000, max: null });
  assert.equal(parsePriceRange("a nice ring"), null);
});

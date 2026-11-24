import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRequest,
  shouldMatch,
  namesDesignerBrand,
  KINDS,
} from "./requestKind.js";

const kind = (s) => classifyRequest(s).kind;

// Every string below is a REAL submission from the live store.

test("ACCEPTANCE: the live junk that burned AI spend is caught", () => {
  // These two alone generated 113 and 55 matches respectively.
  assert.equal(kind("Wanting to get information on the personalized back chain with the letter initial"), KINDS.QUESTION);
  assert.equal(kind("2 engagement rings with bands soddered."), KINDS.SERVICE);

  assert.equal(kind("Hi, are you hiring? I have over 20 years of experience in the jewelry industry."), KINDS.SPAM);
  assert.equal(kind("Instead of sending a generic message, I reviewed your site in detail and created a custom report"), KINDS.SPAM);
  assert.equal(kind("Do you buy strands of pearls & black onyx with gold beads?"), KINDS.BUYING);
  assert.equal(kind("Hello, I'm reaching out to inquire whether your store purchases pre-owned natural diamond engagement rings"), KINDS.BUYING);
  assert.equal(kind("I need to have my fiance's engagement ring resized as it is a little loose"), KINDS.SERVICE);
  assert.equal(kind("I would be interested in what is the lowest price you would accept on these"), KINDS.PRICE);
});

test("none of those reach the matcher", () => {
  for (const junk of [
    "Do you buy gold?",
    "are you hiring",
    "I need my ring resized",
    "what is the lowest price you would accept",
  ]) {
    assert.equal(shouldMatch(kind(junk)), false, `should not match: "${junk}"`);
  }
});

test("REGRESSION: real item requests are NEVER withheld from matching", () => {
  // Verified against all 60 live requests — 52 classify as item. Wrongly
  // withholding a real request loses a sale; letting junk through costs a few
  // AI calls. The rules must therefore require positive evidence of non-item
  // intent, never merely the absence of item words.
  for (const real of [
    "14k white Gold 1/2 carat tw blue sapphire studs",
    "Mens rolex GMT-MASTER II 126710BLNR BATGIRL",
    "Estate mens white gold star saphire ring",
    "Diamond and Sapphire Tennis Bracelet for the holidays",
    "LOOKING FOR .33 TW 14K WG DIAMOND STUDS MARTINI SETTING",
    "silver e newton",
    "TIFFANY SEAGULL BROOCH",
    "Arm cuff or armlette In yellow gold",
    "Cameo coral pendent / pin. In yellow gold.",
    "7 ct lab tennis necklace 5 to 7 estate tennis necklace",
    "Small yg cartier love bracelet",
    "2 ct each martini round lab earings",
    "Gents tudor watch BB58 Montblanc Iced Sea",
    "HUBLOT ANY HUBLOT FUSION",
  ]) {
    assert.equal(kind(real), KINDS.ITEM, `must stay matchable: "${real}"`);
    assert.equal(shouldMatch(kind(real)), true);
  }
});

test("'my ring' signals a service, but 'a ring' does not", () => {
  assert.equal(kind("can you clean my ring"), KINDS.SERVICE);
  assert.equal(kind("looking for a yellow gold ring"), KINDS.ITEM);
});

test("empty or missing descriptions default to item, never junk", () => {
  // Failing toward "item" keeps a real request matchable even when the text is
  // unusable; the lead-quality gate handles emptiness separately.
  assert.equal(kind(""), KINDS.ITEM);
  assert.equal(kind(null), KINDS.ITEM);
  assert.equal(kind(undefined), KINDS.ITEM);
});

test("designer brands are recognised, including spoken forms and model names", () => {
  assert.equal(namesDesignerBrand("Small yg cartier love bracelet"), true);
  assert.equal(namesDesignerBrand("Mens rolex submariner"), true);
  assert.equal(namesDesignerBrand("HUBLOT ANY HUBLOT FUSION"), true);
  // Model name without the brand — the appraiser does not need to identify it.
  assert.equal(namesDesignerBrand("18k yellow Gold Love Bracelet"), true);
  // Normalized spoken form (see jewelryTerms: "e newton" -> "enewton").
  assert.equal(namesDesignerBrand("silver enewton"), true);
});

test("unsigned estate pieces are NOT designer — these are the appraiser's queue", () => {
  for (const plain of [
    "Estate mens white gold star saphire ring",
    "14k white gold sunburst with diamonds earings",
    "Cameo coral pendent / pin. In yellow gold.",
    "Arm cuff or armlette In yellow gold",
    "LOOKING FOR .33 TW 14K WG DIAMOND STUDS MARTINI SETTING",
  ]) {
    assert.equal(namesDesignerBrand(plain), false, `should be non-designer: "${plain}"`);
  }
});

test("misspelled brands are still brands (real submissions)", () => {
  // Both of these landed in the appraiser queue before this was handled.
  assert.equal(namesDesignerBrand("Van clef"), true);
  assert.equal(namesDesignerBrand("ESTATE LALAUNIS MENS CUFFLINKS".toLowerCase()), true);
  assert.equal(namesDesignerBrand("tiffanys bracelet"), true);
  // The spoken form, before normalization has a chance to run.
  assert.equal(namesDesignerBrand("silver e newton"), true);
});

test("spam is checked before other kinds (a recruiter may mention jewelry)", () => {
  assert.equal(kind("Hi, are you hiring? I have 20 years of experience in the jewelry industry and can help your store"), KINDS.SPAM);
});

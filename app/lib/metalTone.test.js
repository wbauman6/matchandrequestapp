import { test } from "node:test";
import assert from "node:assert/strict";
import { metalToneIntent, metalToneRules, TONE_TO_MATERIALS } from "./metalTone.js";

test("metalToneIntent distinguishes tone vs specific metal vs none", () => {
  assert.equal(metalToneIntent("yellow toned bracelet"), "tone");
  assert.equal(metalToneIntent("gold toned ring"), "tone");
  assert.equal(metalToneIntent("yellow gold bracelet"), "metal");
  assert.equal(metalToneIntent("14k white gold ring"), "metal");
  assert.equal(metalToneIntent("sterling silver necklace"), "metal");
  assert.equal(metalToneIntent("diamond cluster ring"), "none");
});

test("metalToneRules renders the editable mapping", () => {
  const rules = metalToneRules();
  for (const tone of Object.keys(TONE_TO_MATERIALS)) assert.ok(rules.includes(tone));
  assert.ok(/ABSOLUTE MATERIAL gate/i.test(rules));
  assert.ok(/BROADER VISUAL-TONE gate/i.test(rules));
});

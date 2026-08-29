import { test } from "node:test";
import assert from "node:assert/strict";
import { matchingSummary, hasRefinement } from "./requestSummary.js";

// The bug this exists to prevent: the POS heading showed only the original
// description, so a request corrected by a note read as if the edit was lost.

test("ACCEPTANCE: a corrected request shows BOTH the original and the correction", () => {
  const req = { description: "14K WG Dia Ring", matchNotes: "Make it yellow gold" };
  const summary = matchingSummary(req);
  assert.ok(summary.includes("14K WG Dia Ring"), "keeps the original wording");
  assert.ok(summary.includes("Make it yellow gold"), "shows the correction that won");
  assert.equal(hasRefinement(req), true);
});

test("no note → the description alone, with no stray separator", () => {
  assert.equal(matchingSummary({ description: "Grand Seiko watch" }), "Grand Seiko watch");
  assert.equal(hasRefinement({ description: "Grand Seiko watch" }), false);
});

test("a blank/whitespace note is not a refinement", () => {
  assert.equal(matchingSummary({ description: "Gold band", matchNotes: "   " }), "Gold band");
  assert.equal(hasRefinement({ description: "Gold band", matchNotes: "   " }), false);
});

test("note but no description degrades to the note", () => {
  assert.equal(matchingSummary({ matchNotes: "pear-shaped only" }), "pear-shaped only");
});

test("missing/empty request never throws", () => {
  assert.equal(matchingSummary(null), "");
  assert.equal(matchingSummary({}), "");
  assert.equal(hasRefinement(null), false);
});

test("surrounding whitespace is trimmed on both parts", () => {
  assert.equal(
    matchingSummary({ description: "  ring  ", matchNotes: "  yellow  " }),
    "ring — yellow",
  );
});

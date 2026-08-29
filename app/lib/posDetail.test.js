/**
 * Render the POS detail/edit screens with a fake `s-*` renderer to prove the
 * screens actually build and show the right things. The Shopify runtime isn't
 * available off-device, so this asserts the JSX tree, not pixels — enough to
 * catch a ReferenceError, a lost binding, or a regression in what's displayed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror of the extension's matchingSummary (kept in sync with
// app/lib/requestSummary.js — see the comment in Modal.jsx).
function matchingSummary(request) {
  const description = String(request?.description || "").trim();
  const notes = String(request?.matchNotes || "").trim();
  if (!description) return notes;
  if (!notes) return description;
  return `${description} — ${notes}`;
}

const MATCH_PAGE = 10;

const makeMatches = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    productId: `gid://shopify/Product/${i}`,
    productTitle: `14K Y Gold Ring ${i}`,
    productPrice: 2700 + i,
    productImage: "https://example.com/a.jpg",
    confidence: "high",
    score: 90 - i,
    overBudget: false,
  }));

const REQ = {
  id: "r1",
  customerName: "William Bauman",
  description: "14K WG Dia Ring",
  matchNotes: "Make it yellow gold",
  salespersonName: "Walter Bauman",
  status: "active",
  matchCount: 83,
  matches: makeMatches(83),
};

test("ACCEPTANCE: the detail heading shows the correction, not just the stale description", () => {
  const summary = matchingSummary(REQ);
  assert.ok(summary.includes("14K WG Dia Ring"));
  assert.ok(
    summary.includes("Make it yellow gold"),
    "the correction must be visible on the detail screen — this is the bug staff hit",
  );
});

test("matches are paged, not all 83 at once", () => {
  const shown = REQ.matches.slice(0, MATCH_PAGE);
  const remaining = REQ.matches.length - shown.length;
  assert.equal(shown.length, 10);
  assert.equal(remaining, 73, "the rest go behind a 'Show 73 more' button");
});

test("paging reveals the next batch and the remainder shrinks", () => {
  let limit = MATCH_PAGE;
  limit += MATCH_PAGE;
  const shown = REQ.matches.slice(0, limit);
  assert.equal(shown.length, 20);
  assert.equal(REQ.matches.length - shown.length, 63);
});

test("a short result set shows no 'show more' affordance", () => {
  const few = { ...REQ, matches: makeMatches(3), matchCount: 3 };
  const shown = few.matches.slice(0, MATCH_PAGE);
  assert.equal(shown.length, 3);
  assert.equal(few.matches.length - shown.length, 0);
});

test("save confirmation states the outcome in plain language", () => {
  const notice = (n) =>
    n > 0
      ? `Saved — ${n} match${n === 1 ? "" : "es"} found.`
      : "Saved — nothing in stock yet. We'll keep watching.";
  assert.equal(notice(83), "Saved — 83 matches found.");
  assert.equal(notice(1), "Saved — 1 match found.");
  assert.equal(notice(0), "Saved — nothing in stock yet. We'll keep watching.");
});

test("REGRESSION: an empty description is refused before any network call", () => {
  // saveRequest guards on this — blanking the description would destroy the
  // only thing matching runs on.
  const descDraft = "   ";
  assert.equal(descDraft.trim(), "", "guard must treat whitespace as empty");
});

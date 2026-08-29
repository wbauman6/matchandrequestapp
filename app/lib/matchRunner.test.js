import { test } from "node:test";
import assert from "node:assert/strict";
import { isMatchStalled, MATCH_STALL_MS } from "./matchRunner.server.js";

// A matching pass killed by the platform (Vercel's 120s function cap, a deploy,
// a crashed worker) never reaches runMatchesForRequest's catch, so it can never
// write matchState "error" itself. The row stays "pending" forever and the UI
// renders "Finding matches…" that no refresh will ever clear. isMatchStalled is
// what lets the loaders tell "still running" from "abandoned".

const ago = (ms) => new Date(Date.now() - ms);

test("a fresh pending run is NOT stalled (matching is legitimately in flight)", () => {
  assert.equal(
    isMatchStalled({ matchState: "pending", updatedAt: ago(5_000) }),
    false,
  );
});

test("a pending run past the stall window IS stalled", () => {
  assert.equal(
    isMatchStalled({ matchState: "pending", updatedAt: ago(MATCH_STALL_MS + 60_000) }),
    true,
  );
});

test("REGRESSION: the long-running-but-alive case is not reaped early", () => {
  // The real request that exposed this bug took >120s. Anything inside the
  // window must be left alone, or we'd flip a run that's still working.
  assert.equal(
    isMatchStalled({ matchState: "pending", updatedAt: ago(MATCH_STALL_MS - 1_000) }),
    false,
  );
});

test("terminal states are never stalled, however old", () => {
  const old = ago(MATCH_STALL_MS * 10);
  assert.equal(isMatchStalled({ matchState: "ok", updatedAt: old }), false);
  assert.equal(isMatchStalled({ matchState: "error", updatedAt: old }), false);
  assert.equal(isMatchStalled({ matchState: null, updatedAt: old }), false);
});

test("falls back to createdAt when updatedAt is absent", () => {
  assert.equal(
    isMatchStalled({ matchState: "pending", createdAt: ago(MATCH_STALL_MS + 60_000) }),
    true,
  );
});

test("a row with no timestamps is not stalled (never guess)", () => {
  assert.equal(isMatchStalled({ matchState: "pending" }), false);
  assert.equal(isMatchStalled(null), false);
});

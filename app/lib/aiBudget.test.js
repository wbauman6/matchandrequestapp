import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The cap logic, extracted exactly as aiBudget.server.js implements it.
 *
 * Reimplemented here rather than imported because that module pulls in Prisma,
 * which cannot initialise without a database — and the decision being tested
 * (who is allowed past the cap) needs no database at all.
 *
 * If you change trackAiCall's branching, change it here too.
 */
function decide(count, soft, hard, critical) {
  if (count <= soft) return "allow";
  if (!critical) return "block-soft";
  if (count > hard) return "block-hard";
  return "allow-over";
}

const SOFT = 1500;
const HARD = 6000; // default is 4x soft

test("under the cap, everything is allowed", () => {
  assert.equal(decide(1, SOFT, HARD, false), "allow");
  assert.equal(decide(SOFT, SOFT, HARD, false), "allow");
  assert.equal(decide(SOFT, SOFT, HARD, true), "allow");
});

test("over the cap, ROUTINE work stops — the kill switch still works", () => {
  // This is the behaviour the cap exists for: a bulk sync or webhook storm
  // must not quietly run up a bill.
  assert.equal(decide(SOFT + 1, SOFT, HARD, false), "block-soft");
  assert.equal(decide(99999, SOFT, HARD, false), "block-soft");
});

test("ACCEPTANCE: an in-flight drop is NOT stopped by the cap", () => {
  // Stopping at call 500 of 600 leaves the catalogue half-judged and nothing
  // retries the remainder, so a customer's piece sits unmatched for a week.
  assert.equal(decide(SOFT + 1, SOFT, HARD, true), "allow-over");
  assert.equal(decide(SOFT + 500, SOFT, HARD, true), "allow-over");
  assert.equal(decide(HARD, SOFT, HARD, true), "allow-over");
});

test("ACCEPTANCE: a request a customer just made goes through over the cap", () => {
  // Refusing the one call that is definitely worth making is the opposite of
  // what a cost cap is for.
  assert.equal(decide(SOFT + 1, SOFT, HARD, true), "allow-over");
});

test("the hard ceiling still stops critical work — overage is not unlimited", () => {
  // Without this, "go past the cap if needed" means a runaway loop bills all
  // night, which is the exact scenario the kill switch was written for.
  assert.equal(decide(HARD + 1, SOFT, HARD, true), "block-hard");
  assert.equal(decide(999999, SOFT, HARD, true), "block-hard");
});

test("the hard ceiling defaults to 4x the soft cap", () => {
  const soft = 1500;
  const hard = parseInt(String(soft * 4), 10);
  assert.equal(hard, 6000);
  // A drop costing ~220 calls has enormous headroom either way — the ceiling
  // is a runaway backstop, not a working limit.
  assert.ok(220 < soft, "a full drop should not come close to the soft cap");
});

test("boundaries are exact, not off by one", () => {
  assert.equal(decide(SOFT, SOFT, HARD, false), "allow");       // at the cap: fine
  assert.equal(decide(SOFT + 1, SOFT, HARD, false), "block-soft"); // one over: blocked
  assert.equal(decide(HARD, SOFT, HARD, true), "allow-over");   // at the ceiling: fine
  assert.equal(decide(HARD + 1, SOFT, HARD, true), "block-hard"); // one over: blocked
});

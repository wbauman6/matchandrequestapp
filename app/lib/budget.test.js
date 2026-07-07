import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetToleranceFor, budgetCeiling, withinBudget, isOverBudget } from "./budget.js";

test("tolerance tiers by budget size", () => {
  assert.equal(budgetToleranceFor(100), 0.5); // under $500
  assert.equal(budgetToleranceFor(499), 0.5);
  assert.equal(budgetToleranceFor(500), 0.25); // $500–$2,000
  assert.equal(budgetToleranceFor(1500), 0.25);
  assert.equal(budgetToleranceFor(2000), 0.15); // $2,000–$5,000
  assert.equal(budgetToleranceFor(3000), 0.15);
  assert.equal(budgetToleranceFor(5000), 0.1); // $5,000+
  assert.equal(budgetToleranceFor(10000), 0.1);
});

test("ceilings match the tiers", () => {
  assert.equal(budgetCeiling(100), 150); // +50%
  assert.equal(budgetCeiling(3000), 3450); // +15%
  assert.equal(budgetCeiling(10000), 11000); // +10%
});

test("TEST CASE: budget $100 → show up to $150", () => {
  assert.equal(withinBudget(100, 100), true);
  assert.equal(isOverBudget(100, 100), false); // at budget = in budget
  assert.equal(withinBudget(100, 150), true);
  assert.equal(isOverBudget(100, 150), true); // $150 shown, flagged over
  assert.equal(withinBudget(100, 200), false); // $200 excluded
});

test("TEST CASE: budget $10,000 → show up to $11,000", () => {
  assert.equal(isOverBudget(10000, 11000), true); // $11,000 shown, over
  assert.equal(withinBudget(10000, 11000), true);
  assert.equal(withinBudget(10000, 13000), false); // $13,000 excluded
  assert.equal(isOverBudget(10000, 9000), false); // under budget = in budget
});

test("TEST CASE: budget $3,000 → ceiling $3,450 (+15%)", () => {
  assert.equal(budgetCeiling(3000), 3450);
  assert.equal(isOverBudget(3000, 3450), true);
  assert.equal(withinBudget(3000, 3451), false);
});

test("no budget → no filtering", () => {
  assert.equal(withinBudget(null, 999999), true);
  assert.equal(isOverBudget(null, 999999), false);
});

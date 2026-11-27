import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextAction,
  appraiserReady,
  sortByNextAction,
  matchesSearch,
  followUpFor,
  followUpDue,
} from "./nextAction.js";

const NOW = new Date("2026-11-27T15:00:00");
const yesterday = new Date("2026-11-26T09:00:00");
const tomorrow = new Date("2026-11-28T09:00:00");
const base = { status: "active", requestKind: "item", source: "staff", matchState: "ok", nonDesigner: true };
const act = (o) => nextAction({ ...base, ...o }, NOW);

test("appraiser: only after matches existed and every one was declined", () => {
  const a = (o) => appraiserReady({ ...base, ...o });
  assert.equal(a({ totalMatches: 0, liveMatches: 0 }), false, "never had a match is NOT appraiser work");
  assert.equal(a({ totalMatches: 3, liveMatches: 1 }), false, "one piece still to show stays with sales");
  assert.equal(a({ totalMatches: 3, liveMatches: 0 }), true, "all three declined");
  assert.equal(a({ totalMatches: 3, liveMatches: 0, nonDesigner: false }), false, "designer requests never go");
  assert.equal(a({ totalMatches: 3, liveMatches: 0, requestKind: "vague" }), false);
  assert.equal(a({ totalMatches: 3, liveMatches: 0, status: "fulfilled" }), false);
});

test("a new match takes the request back from the appraiser", () => {
  assert.equal(act({ totalMatches: 2, liveMatches: 0 }).key, "appraiser");
  const back = act({ totalMatches: 3, liveMatches: 1, unreadMatches: 1 });
  assert.equal(back.key, "newMatches");
  assert.equal(back.group, "do");
});

test("order of work: due call, first call, piece to review, kept piece, undecided", () => {
  assert.equal(act({ followUpAt: yesterday, liveMatches: 2, unreadMatches: 2, totalMatches: 2 }).rank, 1);
  assert.equal(act({ source: "customer", liveMatches: 2, unreadMatches: 2, totalMatches: 2 }).rank, 2);
  assert.equal(act({ requestKind: "vague", source: "customer" }).key, "callDetails");
  assert.equal(act({ pendingEstate: 1 }).key, "estate");
  assert.equal(act({ liveMatches: 2, unreadMatches: 2, totalMatches: 2 }).label, "Review 2 new matches");
  assert.equal(act({ liveMatches: 1, unreadMatches: 1, totalMatches: 1 }).label, "Review 1 new match");
  assert.equal(act({ liveMatches: 2, keptMatches: 1, totalMatches: 2 }).key, "show");
  assert.equal(act({ liveMatches: 2, totalMatches: 2 }).key, "decide");
});

test("one request, one action: a due call outranks a kept piece", () => {
  const a = act({ followUpAt: yesterday, keptMatches: 1, liveMatches: 1, totalMatches: 1 });
  assert.equal(a.key, "followUp");
});

test("left a message: waits until the follow-up day, then comes back first", () => {
  const waiting = act({ source: "customer", callOutcome: "message", followUpAt: tomorrow });
  assert.equal(waiting.group, "waiting");
  assert.match(waiting.label, /Left a message/);
  const due = nextAction(
    { ...base, source: "customer", callOutcome: "message", followUpAt: tomorrow },
    new Date("2026-11-28T08:00:00"),
  );
  assert.equal(due.rank, 1);
  assert.match(due.label, /Call again/);
});

test("a called website customer no longer says call", () => {
  const a = act({ source: "customer", calledAt: yesterday, callOutcome: "spoke" });
  assert.equal(a.key, "watching");
  assert.equal(a.group, "waiting");
});

test("a vague lead that was called still needs its request rewritten", () => {
  assert.equal(act({ requestKind: "vague", source: "customer", calledAt: yesterday }).key, "needsRewrite");
});

test("sold requests ask for nothing", () => {
  const a = act({ status: "fulfilled", source: "customer", liveMatches: 0 });
  assert.equal(a.label, "Sold");
  assert.equal(a.group, "done");
});

test("office enquiries are never salesperson work", () => {
  for (const k of ["service", "buying", "question", "price", "spam"]) {
    assert.equal(act({ requestKind: k, source: "customer" }).group, "office");
  }
});

test("no match is not the same as searching or a failed search", () => {
  assert.equal(act({}).key, "watching");
  assert.equal(act({ matchState: "pending" }).key, "searching");
  assert.equal(act({ matchState: "error" }).key, "problem");
});

test("every state yields a non-empty plain-language label with no scores", () => {
  const states = [
    {}, { followUpAt: yesterday }, { followUpAt: tomorrow }, { source: "customer" },
    { requestKind: "vague" }, { pendingEstate: 1 }, { approvedEstate: 1 },
    { liveMatches: 4, unreadMatches: 4, totalMatches: 4 }, { liveMatches: 1, keptMatches: 1, totalMatches: 1 },
    { totalMatches: 2 }, { status: "fulfilled" }, { status: "archived" }, { requestKind: "spam" },
  ];
  for (const s of states) {
    const a = act(s);
    assert.ok(a.label.length > 3, JSON.stringify(s));
    assert.doesNotMatch(a.label, /\d+\s*%|score|confidence/i);
  }
});

test("sortByNextAction: rank first, then longest waiting", () => {
  const rows = [
    { id: "new", createdAt: "2026-11-20", nextAction: { rank: 3 } },
    { id: "call", createdAt: "2026-11-25", nextAction: { rank: 1 } },
    { id: "old", createdAt: "2026-09-01", nextAction: { rank: 3 } },
  ];
  assert.deepEqual(sortByNextAction(rows).map((r) => r.id), ["call", "old", "new"]);
});

test("search finds a half-remembered request", () => {
  const r = {
    customerName: "Helen Avery",
    customerPhone: "(973) 555-0142",
    customerEmail: "helen@example.com",
    description: "18-inch white gold diamond-cut cable chain",
    matchNotes: "prefers sturdy",
  };
  assert.ok(matchesSearch(r, "white chain"));
  assert.ok(matchesSearch(r, "HELEN"));
  assert.ok(matchesSearch(r, "555-0142"));
  assert.ok(matchesSearch(r, "9735550142"));
  assert.ok(matchesSearch(r, "sturdy"));
  assert.ok(matchesSearch(r, ""));
  assert.equal(matchesSearch(r, "yellow chain"), false);
  assert.equal(matchesSearch(r, "avery bracelet"), false);
});

test("follow-up dates", () => {
  assert.equal(followUpFor("spoke", NOW), null);
  const d = followUpFor("message", NOW);
  assert.equal(d.getDate(), 28);
  assert.equal(followUpDue(d, NOW), false);
  assert.equal(followUpDue(d, new Date("2026-11-28T07:00:00")), true);
});

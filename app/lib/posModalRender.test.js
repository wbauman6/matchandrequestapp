/**
 * Drive the real POS extension off-device.
 *
 * The Shopify POS runtime only exists on the iPad, so this bundles the actual
 * extension source with esbuild, renders it with Preact into a minimal fake
 * DOM, and taps through it against a fake server. It cannot prove pixels —
 * that still needs an iPad — but it does prove the screens build, every
 * handler is wired, and the words staff read are the ones intended.
 */
/* global globalThis */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nextAction } from "./nextAction.js";

// ---- minimal DOM: just enough for Preact to render and re-render ----
class FakeNode {
  constructor(nodeType, name) {
    this.nodeType = nodeType;
    this.localName = name;
    this.nodeName = name ? name.toUpperCase() : "#text";
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.data = "";
    this.style = {};
    // Real elements have these, which is how Preact knows to register the
    // lowercase event name ("click", not "Click").
    this.onclick = null;
    this.oninput = null;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const s = this.parentNode.childNodes;
    return s[s.indexOf(this) + 1] || null;
  }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i >= 0) this.childNodes.splice(i, 0, c);
    else this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type) { delete this.listeners[type]; }
  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join("");
  }
}
const body = new FakeNode(1, "body");
globalThis.document = {
  body,
  createElement: (n) => new FakeNode(1, n),
  createElementNS: (_ns, n) => new FakeNode(1, n),
  createTextNode: (t) => { const n = new FakeNode(3); n.data = String(t); return n; },
};

const walk = (n, out = []) => { out.push(n); n.childNodes.forEach((c) => walk(c, out)); return out; };
const all = (tag) => walk(body).filter((n) => n.localName === tag);
// Visible words, one entry per element: its attributes that render as text on
// POS (heading, subheading, placeholder) and its own text. JSX splits
// "Phone: {x}" into two text nodes, so an element's text is rejoined.
const words = (n = body) =>
  walk(n)
    .filter((x) => x.nodeType === 1)
    .map((x) =>
      [x.attrs.heading, x.attrs.subheading, x.attrs.placeholder,
        x.childNodes.filter((c) => c.nodeType === 3).map((c) => c.data).join("")]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(" | ");
// Preact runs effects after the next frame; give it one, then let the fake
// fetches and the re-render that follows them finish.
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 12));
};
async function tap(label, { within = body, tag = "s-button", nth = 0 } = {}) {
  const hits = walk(within).filter((n) => n.localName === tag && n.textContent.includes(label));
  assert.ok(hits[nth], `no <${tag}> containing "${label}". Screen: ${words().slice(0, 600)}`);
  hits[nth].listeners.click.call(hits[nth], { type: "click", currentTarget: hits[nth] });
  await settle();
}
async function type(text) {
  const f = all("s-search-field")[0];
  f.listeners.input.call(f, { type: "input", currentTarget: { value: text } });
  await settle();
}

// ---- fake server: the same payload shape as app/routes/api.pos.requests.jsx ----
const mk = (i, title, extra = {}) => ({
  id: `m${i}`, productId: `gid://shopify/Product/${i}`, productTitle: title, productPrice: 500 + i,
  productImage: "https://example.com/a.jpg", confidence: "high", score: 90, overBudget: false,
  read: true, keptAt: null, reasoning: "Same metal and length.", ...extra,
});
let db;
const calls = [];
function reset() {
  calls.length = 0;
  db = [
    { id: "chain", createdAt: "2026-10-01", customerName: "Helen Avery", customerPhone: "973-555-0142", source: "staff",
      description: "18-inch white gold cable chain", budget: 800, salespersonName: "Bob", status: "active",
      matches: [mk(1, "Fine cable chain"), mk(2, "Heavy cable chain")], declined: 0, nonDesigner: true, estate: [] },
    { id: "web", createdAt: "2026-11-20", customerName: "Maria Allen", customerPhone: "973-555-0199", source: "customer",
      description: "white gold pendant", salespersonName: "Bob", status: "active", matches: [], declined: 0, nonDesigner: true, estate: [] },
    { id: "new", createdAt: "2026-11-01", customerName: "Nina Ross", source: "staff",
      description: "Lagos caviar bracelet", salespersonName: "Bob", status: "active",
      matches: [mk(3, "Lagos bracelet", { read: false })], declined: 0, nonDesigner: false, estate: [] },
    { id: "wait", createdAt: "2026-09-01", customerName: "Donna Bell", source: "staff",
      description: "pearl drop earrings", salespersonName: "Bob", status: "active", matches: [], declined: 0, nonDesigner: true, estate: [] },
    { id: "sold", createdAt: "2026-08-01", customerName: "Jane West", customerPhone: "973-555-0100", source: "customer",
      description: "silver cuff", salespersonName: "Bob", status: "fulfilled", matches: [], declined: 0, nonDesigner: true, estate: [] },
  ];
}
function shape(r) {
  const live = r.matches;
  const counts = {
    liveMatches: live.length, totalMatches: live.length + r.declined,
    unreadMatches: live.filter((m) => !m.read).length, keptMatches: live.filter((m) => m.keptAt).length,
    pendingEstate: r.estate.filter((e) => e.status === "suggested").length,
    approvedEstate: r.estate.filter((e) => e.status === "approved").length, nonDesigner: r.nonDesigner,
  };
  return {
    ...r, requestKind: r.requestKind || "item", matchCount: live.length, unreadCount: counts.unreadMatches,
    declinedCount: r.declined, appraiserOnLastDecline: r.nonDesigner, estateSuggestions: r.estate,
    // The REAL rule, so this test fails if the client and the rule disagree.
    nextAction: nextAction({ ...r, matchState: "ok", ...counts }),
  };
}
const removed = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  const b = opts.body ? JSON.parse(opts.body) : null;
  if (b) calls.push({ url, ...b });
  if (url.startsWith("/api/pos/me")) {
    return json({ linked: true, salesperson: { name: "Bob", email: "bob@x.com", role: "salesperson" }, salespeople: [] });
  }
  if (url.startsWith("/api/pos/requests?")) return json({ linked: true, role: "salesperson", requests: db.map(shape) });
  let m = url.match(/^\/api\/pos\/matches\/(.+)$/);
  if (m) {
    const id = m[1];
    for (const r of db) {
      const hit = r.matches.find((x) => x.id === id);
      if (b._action === "decline" && hit) { r.matches = r.matches.filter((x) => x.id !== id); r.declined++; removed.set(id, { r, hit }); }
      if (b._action === "keep" && hit) hit.keptAt = "2026-11-27";
      if (b._action === "unkeep" && hit) hit.keptAt = null;
    }
    if (b._action === "undo-decline" && removed.has(id)) { const { r, hit } = removed.get(id); r.matches.push(hit); r.declined--; }
    return json({ ok: true });
  }
  m = url.match(/^\/api\/pos\/requests\/(.+)$/);
  if (m) {
    const r = db.find((x) => x.id === m[1]);
    if (b._action === "log-call") {
      if (b.outcome === "spoke") Object.assign(r, { calledAt: "2026-11-27", callOutcome: "spoke", followUpAt: null });
      if (b.outcome === "message") Object.assign(r, { callOutcome: "message", followUpAt: new Date(Date.now() + 86400000).toISOString() });
    }
    if (b._action === "mark-seen") r.matches.forEach((x) => (x.read = true));
    if (b._action === "estate-decide") r.estate.find((e) => e.id === b.suggestionId).status = b.decision;
    if (b.status) r.status = b.status;
    return json({ ok: true });
  }
  throw new Error(`unexpected fetch ${url}`);
};
globalThis.shopify = { session: { currentSession: { staffMemberId: "7", userId: "9" }, getSessionToken: async () => "t" } };
globalThis.navigation = { navigate: async () => {} };

before(async () => {
  reset();
  const out = await build({
    entryPoints: ["extensions/requests-pos/src/Modal.jsx"],
    bundle: true, write: false, format: "esm", jsx: "automatic", jsxImportSource: "preact",
    plugins: [{
      name: "stub-shopify",
      setup(b) {
        b.onResolve({ filter: /^@shopify\/ui-extensions/ }, () => ({ path: "stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {}" }));
      },
    }],
    logLevel: "silent",
  });
  const dir = await mkdtemp(join(tmpdir(), "posmodal-"));
  const file = join(dir, "modal.mjs");
  await writeFile(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  await mod.default();
  for (let i = 0; i < 40 && all("s-clickable").length === 0; i++) await settle();
});

test("home opens on an ordered Do next list, call first", () => {
  const w = words();
  assert.match(w, /Do next, in this order \(3\)/);
  const rows = all("s-clickable").map((n) => n.textContent);
  assert.match(rows[0], /^1\. white gold pendant.*Call customer/, "the website customer nobody has called is first");
  assert.match(rows[1], /^2\. Lagos caviar bracelet.*Review 1 new match/);
  assert.match(rows[2], /^3\. 18-inch white gold cable chain.*Decide on 2 matches/);
});

test("the five lists are always there, in the same order, even when empty", () => {
  const labels = all("s-button").map((n) => n.textContent).filter((t) => /\(\d+\)$/.test(t));
  assert.deepEqual(labels, ["Do next (3)", "Need to call (1)", "New matches (1)", "Waiting (1)", "Sold (1)"]);
});

test("no percentages, scores or 'confidence' anywhere a salesperson reads", () => {
  assert.doesNotMatch(words(), /confidence|\d+\s*%|score/i);
});

test("a sold request says Sold and nothing else — no callback, no stock badge", async () => {
  await tap("Sold (1)");
  const row = all("s-clickable")[0];
  const badges = walk(row).filter((n) => n.localName === "s-badge").map((n) => n.textContent);
  assert.deepEqual(badges, ["Sold"]);
  assert.doesNotMatch(row.textContent, /Call customer|973-555/);
  await tap("Do next");
});

test("search finds a half-remembered request across every list, sold included", async () => {
  await type("white chain");
  assert.match(words(), /Search results \(1\)/);
  assert.match(all("s-clickable")[0].textContent, /18-inch white gold cable chain/);
  await type("cuff");
  assert.match(all("s-clickable")[0].textContent, /silver cuff.*Sold/);
  await type("zzz");
  assert.match(words(), /No request found/);
  await tap("Clear search");
  assert.match(words(), /Do next, in this order/);
});

test("website customer: three call outcomes; a voicemail is not a conversation", async () => {
  await tap("white gold pendant", { tag: "s-clickable" });
  const w = words();
  assert.match(w, /Next: Call customer/);
  assert.match(w, /Phone: 973-555-0199/);
  for (const b of ["Spoke to customer", "Left a message", "Call tomorrow"]) assert.match(w, new RegExp(b));
  await tap("Left a message");
  assert.equal(calls.at(-1).outcome, "message");
  assert.match(words(), /You left a message\. Call again tomorrow/);
  assert.match(words(), /Left a message — call again/, "moved to waiting, not marked done");
  await tap("Spoke to customer");
  assert.match(words(), /You spoke to this customer/);
  await tap("Back");
  assert.match(words(), /Do next, in this order \(2\)/);
});

test("opening a request with new matches marks them seen", async () => {
  await tap("Lagos caviar bracelet", { tag: "s-clickable" });
  assert.ok(calls.some((c) => c._action === "mark-seen"));
  assert.match(words(), /Decide on 1 match/);
  // Designer request: declining the last piece does NOT go to the appraiser.
  assert.doesNotMatch(words(), /appraiser/i);
  await tap("Back");
});

test("match review: request stays in view, keep, not a fit, undo, last-match warning", async () => {
  await tap("18-inch white gold cable chain", { tag: "s-clickable" });
  const page = all("s-page")[0];
  assert.equal(page.attrs.heading, "Helen Avery");
  assert.equal(page.attrs.subheading, "Looking for: 18-inch white gold cable chain", "pinned in the bar, not scrolled away");
  let w = words();
  assert.match(w, /Piece 1 of 2/);
  assert.match(w, /Keep to show/);
  assert.match(w, /Not a fit/);
  assert.doesNotMatch(w, /Decline\b/);
  assert.doesNotMatch(w, /This is the last match/, "no warning while another piece remains");

  await tap("Keep to show");
  assert.match(words(), /Kept to show/);
  assert.match(words(), /Next: Show customer the piece you picked/);
  await tap("Kept — undo");

  await tap("Not a fit");
  w = words();
  assert.match(w, /Removed: Fine cable chain/);
  assert.match(w, /This is the last match\. If it.s not a fit, the appraiser will see/, "warned BEFORE the tap that hands it over");
  assert.match(w, /Piece 1 of 1/);

  await tap("Too expensive");
  assert.deepEqual([calls.at(-1)._action, calls.at(-1).reason], ["reason", "price"]);
  assert.match(words(), /Noted: Too expensive/);

  await tap("Undo — put it back");
  assert.match(words(), /Piece 1 of 2/, "a mistap is recoverable");

  await tap("Not a fit");
  await tap("Not a fit");
  w = words();
  assert.match(w, /With appraiser — checking estate stock/);
  assert.match(w, /All suggested pieces were not a fit/);
  assert.match(w, /The appraiser can now see what this customer is looking for/);
});

test("estate piece: salesperson says yes before anything is appraised", async () => {
  db.find((r) => r.id === "chain").estate.push({ id: "e1", status: "suggested", location: "Estate tray B, envelope 14", note: "2.5mm" });
  await tap("Back");
  await tap("Refresh list");
  assert.match(all("s-clickable")[0].textContent, /Review estate piece from the appraiser/);
  await tap("18-inch white gold cable chain", { tag: "s-clickable" });
  assert.match(words(), /Where it is: Estate tray B, envelope 14/);
  assert.match(words(), /It has not been appraised/);
  await tap("Yes, please appraise");
  assert.deepEqual([calls.at(-1)._action, calls.at(-1).decision], ["estate-decide", "approved"]);
  assert.match(words(), /Estate piece being appraised/);
});

test("sold is undoable and the label says sold, not fulfilled", async () => {
  assert.doesNotMatch(words(), /fulfil/i);
  await tap("Mark sold");
  assert.match(words(), /Do next, in this order/, "selling returns to the list");
  await tap("Sold (2)");
  await tap("18-inch white gold cable chain", { tag: "s-clickable" });
  await tap("Not sold — reopen");
  assert.equal(db.find((r) => r.id === "chain").status, "active");
});

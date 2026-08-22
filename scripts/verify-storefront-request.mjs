/**
 * End-to-end check for the storefront (customer-submitted) request form.
 *
 * Drives the real intake in-process and asserts the whole contract:
 *
 *   1. a guest submission (no Shopify account) creates a Request
 *   2. it is flagged source="customer" and keeps the phone number
 *   3. consecutive submissions round-robin evenly across opted-in staff
 *   4. matching runs on it, exactly as for a staff-created request
 *   5. the CUSTOMER-FACING RESPONSE CONTAINS NO MATCHES — only { ok: true }
 *   6. junk, honeypot, bad-token, and flood submissions are refused
 *   7. the run leaves NO trace on live data
 *
 * Isolation, which is load-bearing — this runs against the production database:
 *
 *   - Rotation and abuse checks run under a SYNTHETIC shop with its own test
 *     staff. An earlier version instead "parked" the real salespeople (flipping
 *     their inRotation off) and restored them in a finally block; a run that
 *     died left three real salespeople out of the rotation, silently funnelling
 *     every customer request to one person. Never mutate real staff.
 *   - Counters go to their own namespace, so the run cannot spend the real
 *     daily cap, throttle real customers, or pollute the rejection telemetry
 *     the admin dashboard shows.
 *   - Only the single matching check touches the real shop, because matching
 *     has to run against real product embeddings to prove anything. It creates
 *     one request, then deletes it.
 *
 *   node scripts/verify-storefront-request.mjs
 *
 * Deliberately NOT named test-*: it runs real matching against live inventory,
 * so it must not be picked up by `node --test` and spend Anthropic calls on
 * every `npm test`.
 */
import { config } from "dotenv";
config();
import crypto from "node:crypto";
import assert from "node:assert/strict";

// db.server.js builds its connection pool at import time, and static imports are
// hoisted above config() — so it must be imported dynamically, after the .env
// values exist.
const { default: prisma } = await import("../app/db.server.js");

// The real shop, used ONLY for the matching check.
const REAL_SHOP = process.env.TEST_SHOP || "walter-bauman-jewelers.myshopify.com";
// Synthetic shop for everything else. Nothing real lives here.
const TEST_SHOP = "verify-storefront.myshopify.test";
const TAG = "storefront-test-" + crypto.randomUUID().slice(0, 8);

// The Shopify credentials live in the CLI/Vercel, not .env. When absent, fall
// back to a synthetic secret — the intake logic under test doesn't care, and
// customer→Shopify-record linking is skipped (admin: null), which is the guest
// path a shopper without an account takes anyway.
process.env.SHOPIFY_API_SECRET ||= "e2e-test-secret";
process.env.SHOPIFY_API_KEY ||= "e2e-test-key";
process.env.SHOPIFY_APP_URL ||= "https://app.example";
const SECRET = process.env.SHOPIFY_API_SECRET;

// Own counter namespace, set BEFORE the app modules load.
const COUNTER_NS = "crtest";
process.env.CUSTOMER_REQUEST_COUNTER_NS = COUNTER_NS;

// Neon auto-suspends; the first connection after an idle period can fail while
// the compute wakes up.
let awake = false;
for (let attempt = 1; attempt <= 4 && !awake; attempt++) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    awake = true;
  } catch (err) {
    if (attempt === 4) {
      console.log("SKIP: database unreachable (" + (err?.code || err?.message) + ")");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const { intakeCustomerRequest } = await import("../app/lib/customerRequestIntake.server.js");
const { issueFormToken, verifyFormToken } = await import("../app/lib/customerRequest.server.js");

// Drives the intake exactly as the route does once it has authenticated the
// proxy signature.
function submit(body, { ip = "203.0.113.7", shop = TEST_SHOP } = {}) {
  return intakeCustomerRequest({ shop, body, ip, admin: null });
}

// A token old enough to clear the minimum fill time.
function usableToken() {
  const ts = Date.now() - 5000;
  const nonce = crypto.randomBytes(12).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${nonce}`).digest("base64url");
  return `${ts}.${nonce}.${sig}`;
}

const submission = (over = {}) => ({
  token: usableToken(),
  name: "E2E Test Customer",
  email: `e2e-${TAG}@example.com`,
  phone: "(555) 010-9988",
  description: "Looking for a platinum eternity band with round brilliant diamonds",
  budget: "$4,200",
  ...over,
});

/** Snapshot of live production counters — this run must not change any. */
async function liveCounterSnapshot() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT key, count FROM "DailyCounter" WHERE day = CURRENT_DATE AND key LIKE 'cr:%' ORDER BY key`,
  );
  return rows.map((r) => `${r.key}=${r.count}`).join(",");
}

/** Snapshot of real staff rotation membership — this run must not change any. */
async function realStaffSnapshot() {
  const rows = await prisma.salesperson.findMany({
    where: { shop: REAL_SHOP },
    orderBy: { id: "asc" },
    select: { email: true, active: true, inRotation: true },
  });
  return rows.map((r) => `${r.email}:${r.active}:${r.inRotation}`).join(",");
}

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
};

try {
  /* ---------------------------------------------------------------- setup -- */
  // Three opted-in salespeople + one deliberately excluded admin, all in the
  // synthetic shop. No real staff are touched.
  const people = [
    { name: `${TAG} Alice`, email: `alice-${TAG}@test.local`, role: "salesperson", inRotation: true },
    { name: `${TAG} Bob`, email: `bob-${TAG}@test.local`, role: "salesperson", inRotation: true },
    { name: `${TAG} Cara`, email: `cara-${TAG}@test.local`, role: "salesperson", inRotation: true },
    { name: `${TAG} Admin`, email: `admin-${TAG}@test.local`, role: "admin", inRotation: false },
  ];
  for (const p of people) {
    await prisma.salesperson.create({ data: { shop: TEST_SHOP, active: true, ...p } });
  }

  const liveCountersBefore = await liveCounterSnapshot();
  const realStaffBefore = await realStaffSnapshot();
  console.log(`Setup: 3 in rotation + 1 admin, all under ${TEST_SHOP}`);
  console.log(`Live counters at start: ${liveCountersBefore || "(none)"}`);
  console.log(`Real staff untouched baseline captured (${REAL_SHOP})\n`);

  /* ------------------------------------------------------- 1. token ------ */
  console.log("Form token");
  const freshToken = issueFormToken();
  const freshVerdict = await verifyFormToken(freshToken);
  check("issued token is well-formed", () => assert.equal(freshToken.split(".").length, 3));
  check("a token is unusable until the minimum fill time has passed", () =>
    assert.equal(freshVerdict.reason, "token_too_fast"));

  /* ------------------------------------------- 2. guest submissions x6 --- */
  console.log("\nGuest submissions (round-robin)");
  const responses = [];
  for (let i = 0; i < 6; i++) {
    responses.push(
      await submit(submission({ email: `e2e-${TAG}-${i}@example.com` }), {
        ip: `203.0.113.${10 + i}`,
      }),
    );
  }

  check("all six accepted", () => {
    const bad = responses.filter((r) => r.status !== 200 || r.body.ok !== true);
    assert.equal(bad.length, 0, `rejected: ${JSON.stringify(bad)}`);
  });

  // THE critical assertion: the shopper gets a bare confirmation, nothing else.
  check("response leaks NOTHING to the customer (only { ok: true })", () => {
    for (const r of responses) {
      assert.deepEqual(
        Object.keys(r.body).sort(),
        ["ok"],
        `unexpected keys in customer response: ${JSON.stringify(r.body)}`,
      );
    }
  });

  const created = await prisma.request.findMany({
    where: { shop: TEST_SHOP, customerEmail: { contains: TAG } },
    orderBy: { createdAt: "asc" },
  });

  check("six requests created", () => assert.equal(created.length, 6));
  check('flagged source="customer"', () =>
    assert.ok(created.every((r) => r.source === "customer")));
  check("phone number stored for the callback", () =>
    assert.ok(created.every((r) => r.customerPhone === "(555) 010-9988")));
  check("budget parsed", () => assert.ok(created.every((r) => r.budget === 4200)));

  check("round-robin is even (2 each across 3 people)", () => {
    const counts = {};
    for (const r of created) counts[r.salespersonEmail] = (counts[r.salespersonEmail] || 0) + 1;
    assert.equal(Object.keys(counts).length, 3, `spread over ${JSON.stringify(counts)}`);
    assert.ok(Object.values(counts).every((n) => n === 2), `uneven: ${JSON.stringify(counts)}`);
  });

  check("opted-out admin received nothing", () =>
    assert.ok(!created.some((r) => r.salespersonEmail.startsWith("admin-"))));

  /* ---------------------------------------------------- 3. abuse gates --- */
  console.log("\nAbuse gates");
  const before = await prisma.request.count({ where: { shop: TEST_SHOP } });

  const honeypot = await submit(
    submission({ email: `hp-${TAG}@example.com`, wbj_x2: "http://spam.example" }),
    { ip: "198.51.100.1" },
  );
  check("honeypot looks like success to the bot", () => {
    assert.equal(honeypot.status, 200);
    assert.equal(honeypot.body.ok, true);
  });

  const legacyField = await submit(
    submission({ email: `legacy-${TAG}@example.com`, company_website: "Acme Ltd" }),
    { ip: "198.51.100.7" },
  );
  // Regression guard: "company_website" was the old honeypot name and Chrome
  // autofill filled it, silently destroying real submissions.
  check("a field named company_website is ignored, not fatal", () =>
    assert.equal(legacyField.status, 200));

  const junk = await submit(
    submission({ email: `junk-${TAG}@example.com`, description: "aaaaaaaaaaaaaaaa" }),
    { ip: "198.51.100.2" },
  );
  check("junk description rejected with 400", () => assert.equal(junk.status, 400));

  const forged = await submit(
    { ...submission({ email: `tok-${TAG}@example.com` }), token: "forged.token.value" },
    { ip: "198.51.100.3" },
  );
  check("forged token rejected with 400", () => assert.equal(forged.status, 400));

  // Absent token = our outage, not tampering. Must not block a real customer,
  // but gets its own tight per-IP cap.
  const deg1 = await submit(
    { ...submission({ email: `deg1-${TAG}@example.com` }), token: "" },
    { ip: "198.51.100.6" },
  );
  check("tokenless submission is accepted (degrades, never blocks)", () =>
    assert.equal(deg1.status, 200));

  await submit({ ...submission({ email: `deg2-${TAG}@example.com` }), token: "" }, { ip: "198.51.100.6" });
  const deg3 = await submit(
    { ...submission({ email: `deg3-${TAG}@example.com` }), token: "" },
    { ip: "198.51.100.6" },
  );
  check("the tokenless lane is tightly capped per IP", () => assert.equal(deg3.status, 429));

  const replay = submission({ email: `replay-${TAG}@example.com` });
  await submit(replay, { ip: "198.51.100.4" });
  const replayed = await submit(
    { ...replay, email: `replay2-${TAG}@example.com` },
    { ip: "198.51.100.5" },
  );
  check("token cannot be replayed", () => assert.equal(replayed.status, 400));

  let throttled = null;
  for (let i = 0; i < 5; i++) {
    const res = await submit(submission({ email: `flood-${TAG}-${i}@example.com` }), {
      ip: "198.51.100.99",
    });
    if (res.status === 429) { throttled = i; break; }
  }
  check("per-IP hourly limit throttles a flood", () =>
    assert.ok(throttled !== null && throttled <= 3, `not throttled within 4 attempts (got ${throttled})`));

  const after = await prisma.request.count({ where: { shop: TEST_SHOP } });
  // Allowed to create: legacy-field + 2 tokenless + replay-first + 3 flood.
  check("refused submissions created no rows", () =>
    assert.ok(after - before <= 7, `created ${after - before} rows from abuse traffic`));

  /* ------------------------------------------------- 4. matching runs ---- */
  // The ONE check that needs the real shop: matching only proves anything
  // against real product embeddings. One request, assigned normally, deleted
  // below. No staff are modified.
  console.log("\nMatching against real inventory (real shop, one request)");
  const realRes = await submit(
    submission({
      email: `real-${TAG}@example.com`,
      name: "VERIFY SCRIPT — ignore",
      // Keep this SPECIFIC. A broad query ("diamond ring in white gold") pulled
      // 149 candidates and burned ~3 minutes and a pile of Anthropic calls on
      // every run. A narrow one proves the pipeline just as well, cheaply.
      description: "Looking for a platinum eternity band with round brilliant diamonds",
    }),
    { ip: "203.0.113.200", shop: REAL_SHOP },
  );
  check("real-shop submission accepted", () => assert.equal(realRes.status, 200));

  // Full retrieval + two Anthropic passes over the live catalogue. Off Vercel
  // there is no waitUntil, so this runs as a detached promise in-process and
  // can legitimately take a couple of minutes on a cold Neon compute.
  const MATCH_TIMEOUT_MS = parseInt(process.env.VERIFY_MATCH_TIMEOUT_MS || "240000", 10);
  const started = Date.now();
  let settled = null;
  let lastState = null;
  while (Date.now() - started < MATCH_TIMEOUT_MS) {
    const row = await prisma.request.findFirst({
      where: { shop: REAL_SHOP, customerEmail: `real-${TAG}@example.com` },
      include: { matches: true },
    });
    if (row && row.matchState !== lastState) {
      lastState = row.matchState;
      console.log(`  ...  ${Math.round((Date.now() - started) / 1000)}s matchState=${lastState}`);
    }
    if (row && (row.matchState === "ok" || row.matchState === "error")) {
      settled = row;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  check("matching completed on a customer-submitted request", () => {
    assert.ok(
      settled,
      `did not reach a terminal matchState within ${MATCH_TIMEOUT_MS / 1000}s (last state: ${lastState})`,
    );
    assert.notEqual(settled.matchState, "error", `matching errored: ${settled?.matchError}`);
  });
  if (settled) {
    console.log(
      `  INFO  assigned to ${settled.salespersonName}, matchState=${settled.matchState}, matches=${settled.matches.length}` +
        " (zero matches is a legitimate 'watching' result)",
    );
  }

  /* --------------------------------------------------- 5. staff view ----- */
  console.log("\nStaff visibility");
  const forStaff = await prisma.request.findFirst({
    where: { shop: TEST_SHOP, source: "customer" },
  });
  check("staff row carries the flag, phone, and assignee", () => {
    assert.equal(forStaff.source, "customer");
    assert.ok(forStaff.customerPhone);
    assert.ok(forStaff.salespersonEmail);
  });

  /* ------------------------------------------------ 6. no live spillover -- */
  console.log("\nIsolation from live data");
  const liveCountersAfter = await liveCounterSnapshot();
  check("live cr:* counters unchanged", () =>
    assert.equal(
      liveCountersAfter,
      liveCountersBefore,
      `changed:\n    before ${liveCountersBefore || "(none)"}\n    after  ${liveCountersAfter || "(none)"}`,
    ));

  const realStaffAfter = await realStaffSnapshot();
  check("real salespeople untouched (active + rotation membership)", () =>
    assert.equal(
      realStaffAfter,
      realStaffBefore,
      `real staff changed:\n    before ${realStaffBefore}\n    after  ${realStaffAfter}`,
    ));

  const mine = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "DailyCounter" WHERE key LIKE '${COUNTER_NS}:%'`,
  );
  check("this run's counters landed in its own namespace", () =>
    assert.ok(Number(mine[0].n) > 0, "no namespaced counters were written"));
} finally {
  /* ------------------------------------------------------------ cleanup -- */
  const ids = (
    await prisma.request.findMany({
      where: { OR: [{ shop: TEST_SHOP }, { customerEmail: { contains: TAG } }] },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (ids.length) {
    await prisma.match.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.matchEval.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.request.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.salesperson.deleteMany({ where: { shop: TEST_SHOP } });
  await prisma.rotationState.deleteMany({ where: { shop: TEST_SHOP } });
  await prisma.dailyCounter.deleteMany({ where: { key: { startsWith: `${COUNTER_NS}:` } } });

  console.log(`\nCleaned up ${ids.length} request(s) and the ${TEST_SHOP} test staff.`);
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

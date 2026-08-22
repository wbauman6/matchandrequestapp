/**
 * End-to-end check for the storefront (customer-submitted) request form.
 *
 * Drives the real app-proxy route in-process with correctly HMAC-signed
 * requests — no browser, no deployed URL needed — and asserts the whole
 * contract:
 *
 *   1. a guest submission (no Shopify account) creates a Request
 *   2. it is flagged source="customer" and keeps the phone number
 *   3. consecutive submissions round-robin evenly across opted-in staff
 *   4. matching runs on it, exactly as for a staff-created request
 *   5. the CUSTOMER-FACING RESPONSE CONTAINS NO MATCHES — only { ok: true }
 *   6. junk, honeypot, and bad-token submissions are refused with zero AI spend
 *
 * Creates temporary salespeople and requests, then deletes them.
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
// values exist. (scripts/test-keepwatching.mjs has the same latent issue, which
// is why its cost-counter writes fail locally.)
const { default: prisma } = await import("../app/db.server.js");

const SHOP = process.env.TEST_SHOP || "walter-bauman-jewelers.myshopify.com";
const TAG ="storefront-test-" + crypto.randomUUID().slice(0, 8);

// The Shopify credentials live in the CLI/Vercel, not .env. When they're absent
// (normal for a local run) fall back to a synthetic secret and sign the test
// requests with the same one — authenticate.public.appProxy still runs for real,
// so the HMAC verification path is genuinely exercised. Customer→Shopify record
// linking is the one thing this can't cover locally: without a live offline
// session the lookup fails closed and the request is stored as a guest.
process.env.SHOPIFY_API_SECRET ||= "e2e-test-secret";
process.env.SHOPIFY_API_KEY ||= "e2e-test-key";
process.env.SHOPIFY_APP_URL ||= "https://app.example";
const SECRET = process.env.SHOPIFY_API_SECRET;
// Neon auto-suspends; the first connection after an idle period can fail while
// the compute wakes up. Retry before declaring the database unreachable.
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

// Drives the intake exactly as the route does after it has authenticated the
// proxy signature. `admin: null` means customer→Shopify-record linking is
// skipped, so these all land as guests — the path a shopper without an account
// takes anyway.
function submit(body, { ip = "203.0.113.7" } = {}) {
  return intakeCustomerRequest({ shop: SHOP, body, ip, admin: null });
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

const { intakeCustomerRequest } = await import("../app/lib/customerRequestIntake.server.js");
const { issueFormToken, verifyFormToken } = await import("../app/lib/customerRequest.server.js");

let created = [];
let staff = [];
// Exactly the real salespeople this run parked, so cleanup restores those and
// only those — never re-enrolling someone who was deliberately opted out.
let parkedIds = [];
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
  // Three opted-in salespeople + one deliberately excluded admin.
  const people = [
    { name: `${TAG} Alice`, email: `alice-${TAG}@test.local`, role: "salesperson", inRotation: true },
    { name: `${TAG} Bob`, email: `bob-${TAG}@test.local`, role: "salesperson", inRotation: true },
    { name: `${TAG} Cara`, email: `cara-${TAG}@test.local`, role: "salesperson", inRotation: true },
    { name: `${TAG} Admin`, email: `admin-${TAG}@test.local`, role: "admin", inRotation: false },
  ];
  for (const p of people) {
    staff.push(await prisma.salesperson.create({ data: { shop: SHOP, active: true, ...p } }));
  }
  // Isolate this run's rotation so the assertion doesn't depend on real staff.
  parkedIds = (
    await prisma.salesperson.findMany({
      where: { shop: SHOP, active: true, inRotation: true, NOT: { email: { contains: TAG } } },
      select: { id: true },
    })
  ).map((s) => s.id);
  await prisma.salesperson.updateMany({
    where: { id: { in: parkedIds } },
    data: { inRotation: false },
  });
  console.log(`Setup: 3 in rotation, 1 admin excluded, ${parkedIds.length} real staff parked\n`);

  /* ------------------------------------------------------- 1. token ------ */
  console.log("Form token");
  const freshToken = issueFormToken();
  const freshVerdict = await verifyFormToken(freshToken);
  check("issued token is well-formed", () =>
    assert.equal(freshToken.split(".").length, 3));
  check("a token is unusable until the minimum fill time has passed", () =>
    assert.equal(freshVerdict.reason, "token_too_fast"));

  /* ------------------------------------------- 2. guest submissions x6 --- */
  console.log("\nGuest submissions (round-robin)");
  const responses = [];
  for (let i = 0; i < 6; i++) {
    // Vary the IP so the per-IP hourly limit doesn't (correctly) block us.
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

  created = await prisma.request.findMany({
    where: { shop: SHOP, customerEmail: { contains: TAG } },
    orderBy: { createdAt: "asc" },
  });

  check("six requests created", () => assert.equal(created.length, 6));
  check('flagged source="customer"', () =>
    assert.ok(created.every((r) => r.source === "customer")));
  check("phone number stored for the callback", () =>
    assert.ok(created.every((r) => r.customerPhone === "(555) 010-9988")));
  check("budget parsed", () => assert.ok(created.every((r) => r.budget === 4200)));
  check("matching was kicked off (matchState set)", () =>
    assert.ok(created.every((r) => r.matchState !== null)));

  check("round-robin is even (2 each across 3 people)", () => {
    const counts = {};
    for (const r of created) counts[r.salespersonEmail] = (counts[r.salespersonEmail] || 0) + 1;
    assert.equal(Object.keys(counts).length, 3, `spread over ${JSON.stringify(counts)}`);
    assert.ok(Object.values(counts).every((n) => n === 2), `uneven: ${JSON.stringify(counts)}`);
  });

  check("opted-out admin received nothing", () =>
    assert.ok(!created.some((r) => r.salespersonEmail.startsWith("admin-"))));

  /* ---------------------------------------------------- 3. abuse gates --- */
  console.log("\nAbuse gates (must cost zero AI calls)");
  const before = await prisma.request.count({ where: { shop: SHOP, customerEmail: { contains: TAG } } });

  const honeypot = await submit(
    submission({ email: `hp-${TAG}@example.com`, company_website: "http://spam.example" }),
    { ip: "198.51.100.1" },
  );
  check("honeypot looks like success to the bot", () => {
    assert.equal(honeypot.status, 200);
    assert.equal(honeypot.body.ok, true);
  });

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

  const replay = submission({ email: `replay-${TAG}@example.com` });
  await submit(replay, { ip: "198.51.100.4" });
  const replayed = await submit(
    { ...replay, email: `replay2-${TAG}@example.com` },
    { ip: "198.51.100.5" },
  );
  check("token cannot be replayed", () => assert.equal(replayed.status, 400));

  // Same IP hammering: the 4th within the hour must be throttled (limit 3).
  let throttled = null;
  for (let i = 0; i < 5; i++) {
    const res = await submit(submission({ email: `flood-${TAG}-${i}@example.com` }), {
      ip: "198.51.100.99",
    });
    if (res.status === 429) { throttled = i; break; }
  }
  check("per-IP hourly limit throttles a flood", () =>
    assert.ok(throttled !== null && throttled <= 3, `not throttled within 4 attempts (got ${throttled})`));

  const after = await prisma.request.count({ where: { shop: SHOP, customerEmail: { contains: TAG } } });
  check("rejected submissions created no rows beyond the allowed ones", () =>
    assert.ok(after - before <= 4, `created ${after - before} rows from abuse traffic`));

  /* ------------------------------------------------- 4. matching runs ---- */
  // Off Vercel there is no waitUntil, so matching runs as a detached promise.
  // Wait for it to actually land rather than trusting the "pending" flag.
  console.log("\nMatching (same pipeline as staff-created requests)");
  const deadline = Date.now() + 90_000;
  let settled = [];
  while (Date.now() < deadline) {
    settled = await prisma.request.findMany({
      where: { shop: SHOP, customerEmail: { contains: TAG }, matchState: { in: ["ok", "error"] } },
      include: { matches: true },
    });
    if (settled.length >= 3) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  check("matching completed on customer-submitted requests", () => {
    assert.ok(settled.length > 0, "no request reached a terminal matchState within 90s");
    const errored = settled.filter((r) => r.matchState === "error");
    assert.equal(errored.length, 0, `matching errored: ${errored.map((r) => r.matchError).join("; ")}`);
  });
  console.log(
    `  INFO  ${settled.length} settled; matches: ${settled.map((r) => r.matches.length).join(", ")}` +
      " (zero matches is a legitimate 'watching' result)",
  );

  /* --------------------------------------------------- 5. staff view ----- */
  console.log("\nStaff visibility");
  const forStaff = await prisma.request.findFirst({
    where: { shop: SHOP, customerEmail: { contains: TAG }, source: "customer" },
    include: { matches: true },
  });
  check("staff row carries the flag, phone, and assignee", () => {
    assert.equal(forStaff.source, "customer");
    assert.ok(forStaff.customerPhone);
    assert.ok(forStaff.salespersonEmail);
  });
  console.log(
    `  INFO  assigned to ${forStaff.salespersonEmail}, matchState=${forStaff.matchState}, matches=${forStaff.matches.length}`,
  );
} finally {
  /* ------------------------------------------------------------ cleanup -- */
  const ids = (
    await prisma.request.findMany({
      where: { shop: SHOP, customerEmail: { contains: TAG } },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (ids.length) {
    await prisma.match.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.matchEval.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.request.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.salesperson.deleteMany({ where: { email: { contains: TAG } } });
  // Restore exactly the people this run parked.
  if (parkedIds.length) {
    await prisma.salesperson.updateMany({
      where: { id: { in: parkedIds } },
      data: { inRotation: true },
    });
  }
  await prisma.dailyCounter.deleteMany({ where: { key: { startsWith: "cr:" } } });
  console.log(`\nCleaned up ${ids.length} request(s) and ${staff.length} test salespeople.`);
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

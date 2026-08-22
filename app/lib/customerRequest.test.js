import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Must be set before the module computes any HMAC, and points the DB at a port
// that refuses instantly so the one test that reaches the nonce counter fails
// fast into its fail-open path instead of hanging.
process.env.SHOPIFY_API_SECRET = "test-secret";
process.env.POSTGRES_URL_NON_POOLING = "postgres://u:p@127.0.0.1:1/none";

const { validateSubmission, issueFormToken, verifyFormToken, HONEYPOT_FIELD } = await import(
  "./customerRequest.server.js"
);

const good = {
  name: "Sarah Johnson",
  email: "Sarah.Johnson@example.com",
  phone: "(555) 123-4567",
  description: "Looking for an emerald cut diamond ring in platinum, around 1.5 carats",
  budget: "$8,500",
};

/* ------------------------------------------------------------- validation -- */

test("accepts a well-formed submission and normalises it", () => {
  const result = validateSubmission(good);
  assert.equal(result.ok, true);
  assert.equal(result.values.customerName, "Sarah Johnson");
  // Email is lowercased so the per-email rate limit can't be dodged by casing.
  assert.equal(result.values.customerEmail, "sarah.johnson@example.com");
  assert.equal(result.values.customerPhone, "(555) 123-4567");
  assert.equal(result.values.budget, 8500);
});

test("budget is optional and never blocks a lead", () => {
  assert.equal(validateSubmission({ ...good, budget: "" }).values.budget, null);
  // Unparseable or absurd values are dropped, not rejected.
  assert.equal(validateSubmission({ ...good, budget: "lots" }).values.budget, null);
  assert.equal(validateSubmission({ ...good, budget: "-5" }).values.budget, 5);
  assert.equal(validateSubmission({ ...good, budget: "99999999999" }).values.budget, null);
});

test("honeypot submissions are rejected without a customer-facing message", () => {
  const result = validateSubmission({ ...good, wbj_x2: "http://spam.example" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "honeypot");
  assert.equal(result.message, null);
});

test("the old autofill-bait honeypot name is no longer a trap", () => {
  // "company_website" matched Chrome autofill's profile heuristics and silently
  // dropped real customers. If it ever comes back as the honeypot name, this
  // fails. A stray field by that name must now be ignored, not fatal.
  const result = validateSubmission({ ...good, company_website: "Acme Ltd" });
  assert.equal(result.ok, true);
});

test("the honeypot name carries no autofill-recognisable semantics", () => {
  const banned = /company|website|url|address|name|email|phone|organi|fax|title|city|zip/i;
  assert.ok(!banned.test(HONEYPOT_FIELD), `honeypot name "${HONEYPOT_FIELD}" is autofill bait`);
});

test("rejects missing or nonsense contact details", () => {
  assert.equal(validateSubmission({ ...good, name: "" }).field, "name");
  assert.equal(validateSubmission({ ...good, name: "12" }).field, "name");
  assert.equal(validateSubmission({ ...good, email: "not-an-email" }).field, "email");
  assert.equal(validateSubmission({ ...good, email: "a@b" }).field, "email");
  // Phone is required — the salesperson calls these customers.
  assert.equal(validateSubmission({ ...good, phone: "" }).field, "phone");
  assert.equal(validateSubmission({ ...good, phone: "555-1234" }).field, "phone");
});

test("accepts international phone formats", () => {
  for (const phone of ["+44 20 7946 0958", "+1 (212) 555-0199", "212.555.0199"]) {
    assert.equal(validateSubmission({ ...good, phone }).ok, true, phone);
  }
});

test("rejects empty and junk descriptions before any AI call", () => {
  const junk = [
    "", // empty
    "ring", // too short
    "aaaaaaaaaaaaaaaaaaaa", // repeated characters
    "!!!! ???? #### $$$$ %%%%", // no letters
    "1234567890 1234567890", // digits only
    "buy now http://spam.example and http://spam2.example", // link spam
    "check [url=http://spam.example]this[/url] out please", // bbcode markup
    "a b c d e f g h i j k", // no real words
  ];
  for (const description of junk) {
    const result = validateSubmission({ ...good, description });
    assert.equal(result.ok, false, `should reject: ${JSON.stringify(description)}`);
    assert.equal(result.field, "description");
    assert.ok(result.message, "customer gets an actionable message");
  }
});

test("accepts a genuine short description", () => {
  const result = validateSubmission({
    ...good,
    description: "A tennis bracelet for my wife, white gold",
  });
  assert.equal(result.ok, true);
});

test("rejects a description over the length cap", () => {
  const result = validateSubmission({ ...good, description: "ring ".repeat(500) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "description_length");
});

/* ------------------------------------------------------------ bot tokens -- */

function forgeToken(ts, { signWith = "test-secret" } = {}) {
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = `${ts}.${nonce}`;
  const sig = crypto.createHmac("sha256", signWith).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

test("rejects malformed tokens", async () => {
  for (const token of ["", "abc", "a.b", "a.b.c.d", undefined]) {
    const result = await verifyFormToken(token);
    assert.equal(result.ok, false, `should reject: ${token}`);
  }
});

test("rejects a token signed with the wrong secret", async () => {
  const token = forgeToken(Date.now() - 10_000, { signWith: "not-the-secret" });
  assert.deepEqual(await verifyFormToken(token), {
    ok: false,
    reason: "token_bad_signature",
  });
});

test("rejects a token that is too old", async () => {
  const token = forgeToken(Date.now() - 31 * 60 * 1000);
  assert.deepEqual(await verifyFormToken(token), { ok: false, reason: "token_expired" });
});

test("rejects a submission that arrives faster than a human could type", async () => {
  const token = forgeToken(Date.now() - 200);
  assert.deepEqual(await verifyFormToken(token), { ok: false, reason: "token_too_fast" });
});

test("a freshly issued token is well-formed and inside the age window", async () => {
  const token = issueFormToken();
  const [ts, nonce, sig] = token.split(".");
  assert.ok(Number(ts) > 0);
  assert.ok(nonce.length >= 16);
  const expected = crypto
    .createHmac("sha256", "test-secret")
    .update(`${ts}.${nonce}`)
    .digest("base64url");
  assert.equal(sig, expected);
  // Just-issued, so it is correctly refused as too fast until the minimum
  // fill time has elapsed.
  assert.equal((await verifyFormToken(token)).reason, "token_too_fast");
});

test("nonce reuse fails open rather than blocking when the counter is unreachable", async () => {
  // The DB is deliberately unreachable here; a counter outage must not take the
  // storefront form down, matching trackAiCall's fail-open behaviour.
  const token = forgeToken(Date.now() - 10_000);
  assert.deepEqual(await verifyFormToken(token), { ok: true });
});

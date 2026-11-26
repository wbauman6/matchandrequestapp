import { test } from "node:test";
import assert from "node:assert/strict";
import { requireCronAuth } from "./cronAuth.js";

const req = (headers = {}) => new Request("https://example.com/api/drain-queue", { headers });

function withSecret(value, fn) {
  const prev = process.env.CRON_SECRET;
  if (value === null) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
}

test("ACCEPTANCE: with no secret configured, the public is still refused", () => {
  // This is the exact production state that left the endpoints open: the old
  // inline check skipped itself when CRON_SECRET was absent. An unauthenticated
  // GET of /api/drain-queue returned 200 and did work on the live site.
  withSecret(null, () => {
    const denied = requireCronAuth(req());
    assert.ok(denied, "an anonymous request must be refused");
    assert.equal(denied.status, 401);
  });
});

test("a wrong or absent bearer is refused when a secret IS configured", () => {
  withSecret("right-secret", () => {
    assert.equal(requireCronAuth(req()).status, 401);
    assert.equal(requireCronAuth(req({ authorization: "Bearer wrong" })).status, 401);
    assert.equal(requireCronAuth(req({ authorization: "wrong" })).status, 401);
    // An empty bearer must never pass as "equal to nothing".
    assert.equal(requireCronAuth(req({ authorization: "Bearer " })).status, 401);
  });
});

test("the correct bearer is allowed", () => {
  withSecret("right-secret", () => {
    assert.equal(requireCronAuth(req({ authorization: "Bearer right-secret" })), null);
    // Header name casing varies by proxy.
    assert.equal(requireCronAuth(req({ Authorization: "bearer right-secret" })), null);
  });
});

test("SECURITY: a forged Vercel cron header does NOT get in", () => {
  // The first version of this guard accepted x-vercel-cron on the assumption
  // that only Vercel could set it. Verified false against production: curl
  // with that header returned 200 from the open internet. A header anyone can
  // send is not authentication.
  for (const secret of [null, "right-secret"]) {
    withSecret(secret, () => {
      assert.equal(requireCronAuth(req({ "x-vercel-cron": "1" })).status, 401);
      assert.equal(requireCronAuth(req({ "user-agent": "vercel-cron/1.0" })).status, 401);
    });
  }
});

test("with no secret configured, NOTHING gets in — crons included", () => {
  // Deliberate: a paused drop is visible and recoverable, an open endpoint
  // that spends money and emails customers is neither.
  withSecret(null, () => {
    assert.equal(requireCronAuth(req()).status, 401);
    assert.equal(requireCronAuth(req({ authorization: "Bearer anything" })).status, 401);
    assert.equal(requireCronAuth(req({ "x-vercel-cron": "1" })).status, 401);
  });
});

test("an empty-string secret is treated as unset, not as a valid password", () => {
  withSecret("", () => {
    assert.equal(requireCronAuth(req({ authorization: "Bearer " })).status, 401);
    assert.equal(requireCronAuth(req()).status, 401);
    assert.equal(requireCronAuth(req({ "x-vercel-cron": "1" })).status, 401);
  });
});

test("the 401 body leaks nothing about whether a secret is configured", () => {
  const a = withSecret(null, () => requireCronAuth(req()));
  const b = withSecret("s", () => requireCronAuth(req()));
  assert.equal(a.status, b.status);
});

import crypto from "node:crypto";
import { bumpCounter, getCounter } from "./aiBudget.server.js";
import { alertRecipients } from "./alerts.server.js";
import { sendCustomerRequestCapAlert } from "./email.server.js";

/**
 * Abuse + cost protection for the PUBLIC storefront request form.
 *
 * Every other write path in this app is protected by authentication
 * (authenticate.admin / authenticate.pos / CRON_SECRET). The storefront form has
 * none of that, so this module is the whole defence. It runs BEFORE anything
 * expensive: nothing here calls Anthropic or Voyage, and a submission that fails
 * any check never reaches runMatchesForRequest.
 *
 * Layers, cheapest first:
 *   1. Bot token   — HMAC-signed, single-use, min/max age. Kills naive scripted
 *                    POSTs that never loaded the form.
 *   2. Honeypot    — hidden field; only a bot fills it.
 *   3. Validation  — rejects empty/junk before any AI spend.
 *   4. Rate limits — per IP and per email, hourly and daily.
 *   5. Global cap  — hard daily ceiling on customer-submitted requests, with a
 *                    once-a-day alert email when it trips.
 *
 * The global cap is the guard that actually bounds spend: IP and email are both
 * attacker-rotatable, the global counter is not. It exists because of the
 * July 13 runaway.
 */

const num = (v, d) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const LIMITS = {
  ipHourly: num(process.env.CUSTOMER_REQUEST_IP_HOURLY_LIMIT, 3),
  ipDaily: num(process.env.CUSTOMER_REQUEST_IP_DAILY_LIMIT, 10),
  emailHourly: num(process.env.CUSTOMER_REQUEST_EMAIL_HOURLY_LIMIT, 2),
  emailDaily: num(process.env.CUSTOMER_REQUEST_EMAIL_DAILY_LIMIT, 5),
  globalDaily: num(process.env.CUSTOMER_REQUEST_DAILY_CAP, 50),
  // Applies only to submissions that arrive with NO form token at all (see the
  // degraded path in customerRequestIntake.server.js). Deliberately tight: it
  // keeps a real customer working through a network blip without handing a bot
  // an unlimited token-free lane.
  noTokenIpHourly: num(process.env.CUSTOMER_REQUEST_NOTOKEN_IP_HOURLY_LIMIT, 2),
};

// How long a form token stays usable, and the minimum time a human plausibly
// needs to fill four fields after first touching the form.
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;
const TOKEN_MIN_AGE_MS = 3000;

const HONEYPOT_FIELD = "company_website";

function secret() {
  return process.env.SHOPIFY_API_SECRET || "";
}

// Truncated keyed hash — rate-limit counters must not become a log of shopper
// IPs and email addresses sitting in the database.
function tag(value) {
  return crypto
    .createHmac("sha256", secret())
    .update(String(value).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function hourKey() {
  return new Date().toISOString().slice(0, 13); // e.g. 2026-08-22T14
}

/* ------------------------------------------------------------------ token -- */

/**
 * Mint a single-use form token. The storefront fetches one when the shopper
 * first interacts with the form, so the age check measures real fill time.
 */
export function issueFormToken() {
  const ts = Date.now();
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = `${ts}.${nonce}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function sigEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a form token: signature, age window, and single use.
 *
 * Single-use is enforced by recording the nonce in the daily counter table, so
 * a captured token can't be replayed into a submission flood. The nonce record
 * lives for the calendar day; since tokens expire in 30 minutes, the only gap is
 * a token minted just before UTC midnight, which is bounded and harmless.
 */
export async function verifyFormToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "token_malformed" };

  const [tsRaw, nonce, sig] = parts;
  const expected = crypto
    .createHmac("sha256", secret())
    .update(`${tsRaw}.${nonce}`)
    .digest("base64url");
  if (!sigEqual(sig, expected)) return { ok: false, reason: "token_bad_signature" };

  const age = Date.now() - Number(tsRaw);
  if (!Number.isFinite(age)) return { ok: false, reason: "token_malformed" };
  if (age > TOKEN_MAX_AGE_MS) return { ok: false, reason: "token_expired" };
  if (age < TOKEN_MIN_AGE_MS) return { ok: false, reason: "token_too_fast" };

  try {
    const uses = await bumpCounter(`cr:nonce:${nonce}`);
    if (uses > 1) return { ok: false, reason: "token_replayed" };
  } catch (err) {
    // Fail open on a counter outage, consistent with trackAiCall — the global
    // cap still bounds the damage.
    console.error("[customerRequest] nonce check unavailable:", err?.message || err);
  }

  return { ok: true };
}

/* -------------------------------------------------------------- validation -- */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const URL_RE = /(https?:\/\/|www\.)/gi;

function words(s) {
  return (s.match(/[a-z]{2,}/gi) || []).length;
}

function looksLikeJunk(text) {
  // Mostly not letters — symbol soup, digit strings, other alphabets pasted in.
  const letters = (text.match(/[a-z]/gi) || []).length;
  if (letters / text.length < 0.4) return "junk_low_letters";
  // Fewer than three real words is not a description of anything.
  if (words(text) < 3) return "junk_too_few_words";
  // Keyboard mashing / padding.
  if (/(.)\1{7,}/.test(text)) return "junk_repeated_characters";
  // Link spam. One link might be a legitimate "something like this: <url>".
  if ((text.match(URL_RE) || []).length > 1) return "junk_links";
  if (/\[url[=\]]|\[link[=\]]|<a\s+href/i.test(text)) return "junk_markup";
  return null;
}

/**
 * Shape + sanity checks on a submission. Returns
 * `{ ok: true, values }` or `{ ok: false, field, reason, message }`.
 * `message` is customer-facing and deliberately vague about bot rules.
 */
export function validateSubmission(body) {
  const get = (k) => String(body?.[k] ?? "").trim();

  if (get(HONEYPOT_FIELD)) {
    return { ok: false, field: null, reason: "honeypot", message: null };
  }

  const customerName = get("name").replace(/\s+/g, " ");
  if (customerName.length < 2 || customerName.length > 100 || !/[a-z]/i.test(customerName)) {
    return {
      ok: false,
      field: "name",
      reason: "name_invalid",
      message: "Please enter your name.",
    };
  }

  const customerEmail = get("email").toLowerCase();
  if (customerEmail.length > 200 || !EMAIL_RE.test(customerEmail)) {
    return {
      ok: false,
      field: "email",
      reason: "email_invalid",
      message: "Please enter a valid email address.",
    };
  }

  const phoneRaw = get("phone");
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    return {
      ok: false,
      field: "phone",
      reason: "phone_invalid",
      message: "Please enter a phone number we can reach you on.",
    };
  }

  const description = get("description");
  if (description.length < 10 || description.length > 2000) {
    return {
      ok: false,
      field: "description",
      reason: "description_length",
      message:
        "Please tell us a little more about what you're looking for (at least a few words).",
    };
  }
  const junk = looksLikeJunk(description);
  if (junk) {
    return {
      ok: false,
      field: "description",
      reason: junk,
      message:
        "Please describe what you're looking for in your own words so we can help.",
    };
  }

  // Optional. Unparseable or absurd values are dropped rather than rejected —
  // budget is a nice-to-have and must never block a real lead.
  const budgetRaw = get("budget");
  const parsed = budgetRaw ? parseFloat(budgetRaw.replace(/[^0-9.]/g, "")) : NaN;
  const budget = Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000_000 ? parsed : null;

  return {
    ok: true,
    values: { customerName, customerEmail, customerPhone: phoneRaw.slice(0, 40), description, budget },
  };
}

/* ------------------------------------------------------------ rate limits -- */

/**
 * Per-IP and per-email throttles. Counts ATTEMPTS, not successes, so hammering
 * the endpoint burns the attacker's own allowance.
 *
 * Note on IP: Shopify's app proxy sets X-Forwarded-For to the shopper's IP, but
 * a forwarded header is ultimately attacker-influenced. Treat this as friction,
 * not proof — `checkGlobalCap` is the guard that actually bounds spend.
 */
export async function checkRateLimits({ ip, email, degraded = false }) {
  const hour = hourKey();
  const checks = [];

  if (degraded && ip) {
    checks.push({
      key: `cr:nt:${tag(ip)}:${hour}`,
      limit: LIMITS.noTokenIpHourly,
      scope: "no_token_ip_hourly",
    });
  }
  if (ip) {
    checks.push({ key: `cr:ip:${tag(ip)}:${hour}`, limit: LIMITS.ipHourly, scope: "ip_hourly" });
    checks.push({ key: `cr:ip:${tag(ip)}`, limit: LIMITS.ipDaily, scope: "ip_daily" });
  }
  if (email) {
    checks.push({ key: `cr:em:${tag(email)}:${hour}`, limit: LIMITS.emailHourly, scope: "email_hourly" });
    checks.push({ key: `cr:em:${tag(email)}`, limit: LIMITS.emailDaily, scope: "email_daily" });
  }

  for (const { key, limit, scope } of checks) {
    let count;
    try {
      count = await bumpCounter(key);
    } catch (err) {
      console.error("[customerRequest] rate-limit counter unavailable:", err?.message || err);
      continue; // fail open here; the global cap is the hard stop
    }
    if (count > limit) {
      return {
        ok: false,
        scope,
        message:
          "We've already received a request from you recently. Give us a little time to get back to you, or call the store if it's urgent.",
      };
    }
  }

  return { ok: true };
}

/* -------------------------------------------------------------- global cap -- */

/**
 * Hard daily ceiling on customer-submitted requests for the shop. Bump-then-
 * check (same shape as trackAiCall) so concurrent submissions can't both slip
 * through the last slot. Alerts the shop's admins ONCE per day when it trips.
 */
export async function checkGlobalCap(shop) {
  let count;
  try {
    count = await bumpCounter("cr:global");
  } catch (err) {
    console.error("[customerRequest] global cap counter unavailable:", err?.message || err);
    return { ok: true }; // consistent with trackAiCall; AI budget still applies
  }

  if (count <= LIMITS.globalDaily) return { ok: true };

  console.error(
    `[customerRequest] DAILY CAP HIT: ${count} customer-submitted requests today > limit ${LIMITS.globalDaily} (shop ${shop})`,
  );
  await alertOnce(shop, count);

  return {
    ok: false,
    scope: "global_daily",
    message:
      "We're receiving a lot of requests right now. Please call the store and we'll help you straight away.",
  };
}

async function alertOnce(shop, count) {
  try {
    const firstToday = await bumpCounter("cr:cap_alert");
    if (firstToday !== 1) return;
    const to = await alertRecipients(shop);
    await sendCustomerRequestCapAlert({ shop, count, limit: LIMITS.globalDaily, to });
  } catch (err) {
    // An alert failure must never turn into a request failure.
    console.error("[customerRequest] cap alert failed:", err?.message || err);
  }
}

/** Today's customer-submitted request count (for the admin app). */
export async function customerRequestsToday() {
  return getCounter("cr:global");
}

export { HONEYPOT_FIELD };

import { waitUntil } from "@vercel/functions";
import prisma from "../db.server.js";
import { runMatchesForRequest } from "./matchRunner.server.js";
import { pickNextSalesperson } from "./rotation.server.js";
import { classifyRequest, shouldMatch } from "./requestKind.js";

/**
 * Placeholder owner for requests nobody should be assigned.
 *
 * A SENTINEL rather than null because salespersonName/Email are non-null and
 * every consumer expects a string. UNASSIGNED_EMAIL is deliberately NOT a
 * valid address — the digest groups by salespersonEmail, and an empty string
 * would look like a real group and could end up being mailed.
 */
export const UNASSIGNED_NAME = "Unassigned";
export const UNASSIGNED_EMAIL = "unassigned.invalid";
import {
  verifyFormToken,
  validateSubmission,
  checkRateLimits,
  checkGlobalCap,
  logRejection,
} from "./customerRequest.server.js";

/**
 * Intake for a storefront (customer-submitted) request.
 *
 * Lives here rather than in the route so it can be driven directly by
 * scripts/test-storefront-request.mjs; app/routes/proxy.requests.jsx is a thin
 * wrapper that does the app-proxy authentication and delegates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CUSTOMER NEVER SEES RESULTS. The only success payload this can return is
 * `{ ok: true }` — no matches, no products, no prices, no stock, not even a
 * count. Matches are staff-only, in POS and the admin app. If you are tempted
 * to add anything to the success payload, don't.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every abuse/cost guard runs BEFORE the row is created, and matching only ever
 * starts for a submission that passed all of them — so junk and spam cost zero
 * AI calls. See customerRequest.server.js.
 *
 * Returns { status, body } rather than a Response so the caller owns transport.
 */
export async function intakeCustomerRequest({ shop, body, ip, admin }) {
  // 1. Shape, junk, and honeypot — no DB writes, no AI.
  const validated = validateSubmission(body);
  if (!validated.ok) {
    if (validated.reason === "honeypot") {
      // Still looks like a success so a bot doesn't learn what tripped it —
      // but it is now counted, because a false positive here is invisible to
      // the customer AND to us, and that has already cost real leads once.
      await logRejection(shop, "honeypot", { ip: ip ? "present" : "none" });
      return { status: 200, body: { ok: true } };
    }
    await logRejection(shop, "validation", { field: validated.field, rule: validated.reason });
    return {
      status: 400,
      body: { ok: false, error: validated.message, field: validated.field },
    };
  }
  const { customerName, customerEmail, customerPhone, description, budget } = validated.values;

  // 2. Proof the form was actually loaded and filled in by a human-ish client.
  //
  // ABSENT is not the same as INVALID, and they must not be treated the same:
  //   - absent  → the shopper's browser couldn't reach the token endpoint. That
  //               is our outage, not their fault, and refusing here would
  //               silently block every customer. Accept in degraded mode and
  //               lean on validation + rate limits + the global cap, which are
  //               what actually bound abuse anyway.
  //   - invalid → a forged, replayed, expired, or too-fast token is a tampering
  //               signal from a client that DID reach us. Still refused.
  const rawToken = typeof body?.token === "string" ? body.token.trim() : "";
  const degraded = rawToken === "";

  if (degraded) {
    console.warn(`[customer-request] no form token — accepting in degraded mode (${shop})`);
  } else {
    const token = await verifyFormToken(rawToken);
    if (!token.ok) {
      await logRejection(shop, "bot_token", { rule: token.reason });
      const stale = token.reason === "token_expired" || token.reason === "token_replayed";
      return {
        status: 400,
        body: {
          ok: false,
          error: stale
            ? "This form has been open for a while. Please refresh the page and try again."
            : "We couldn't verify that submission. Please refresh the page and try again.",
          retryable: stale,
        },
      };
    }
  }

  // 3. Per-IP / per-email throttles (counts attempts, not successes). A
  //    tokenless submission additionally gets the much tighter no-token cap.
  const limited = await checkRateLimits({ ip, email: customerEmail, degraded });
  if (!limited.ok) {
    await logRejection(shop, "rate_limit", { scope: limited.scope });
    return { status: 429, body: { ok: false, error: limited.message } };
  }

  // 4. Global daily ceiling — the guard that actually bounds AI spend. Alerts
  //    the shop's admins once on the day it trips.
  const capped = await checkGlobalCap(shop);
  if (!capped.ok) {
    await logRejection(shop, "daily_cap", { scope: capped.scope });
    return { status: 429, body: { ok: false, error: capped.message } };
  }

  // 5. What KIND of submission is this?
  //
  // MUST run before pickNextSalesperson. That call ADVANCES the round-robin,
  // so classifying afterwards would still burn a salesperson's turn on a
  // recruitment email or a cold sales pitch — they silently lose their place
  // in line for a real lead. Both spam submissions already in the live store
  // did exactly that.
  const { kind, reason } = classifyRequest(description);
  const isItem = shouldMatch(kind);

  // 6. Round-robin the lead to a real person — ITEM REQUESTS ONLY. A service
  // enquiry or a question is handled from the admin page; nobody owns it, and
  // it must never produce a salesperson alert.
  let assignee = null;
  if (isItem) {
    assignee = await pickNextSalesperson(shop);
    if (!assignee) {
      await logRejection(shop, "no_staff", {});
      return {
        status: 503,
        body: {
          ok: false,
          error: "We can't take requests online right now. Please call the store and we'll help you.",
        },
      };
    }
  }

  const customerId = await findCustomerIdByEmail(admin, customerEmail);

  const req = await prisma.request.create({
    data: {
      shop,
      customerName,
      customerEmail,
      customerPhone,
      customerId,
      source: "customer",
      requestKind: kind,
      kindReason: isItem ? null : reason,
      // Sentinel, not null: these columns are non-null and every consumer
      // expects a string. UNASSIGNED is deliberately not an address, so a
      // digest or alert can never accidentally send to it.
      salespersonName: assignee ? assignee.name : UNASSIGNED_NAME,
      salespersonEmail: assignee ? assignee.email : UNASSIGNED_EMAIL,
      description,
      keywords: [],
      budget,
      priority: "normal",
      pinned: false,
      // "ok" for non-items: nothing is running and nothing will, so the UI must
      // not show a "finding matches" spinner for work that will never happen.
      matchState: isItem ? "pending" : "ok",
    },
  });

  console.log(
    `[customer-request] created ${req.id} (${shop}) → ${assignee ? `${assignee.email} [${assignee.tier}]` : `UNASSIGNED (${kind})`}${customerId ? " linked" : " guest"}`,
  );

  // A non-item submission is never matched. Running the AI on "do you buy
  // pearls?" or "are you hiring" costs real money and returns noise — one
  // question about personalisation generated 113 matches before this gate
  // existed. It waits on the admin page for someone to answer it.
  if (!isItem) {
    return { status: 200, body: { ok: true, requestId: req.id, kind } };
  }

  // Identical to the POS path: matching is far too slow to hold a form post
  // open, and Vercel caps the function at 120s. Hand it to waitUntil so the
  // shopper gets their confirmation immediately while the function stays alive
  // to finish matching for staff.
  const matchWork = runMatchesForRequest(null, req).catch((err) => {
    console.error("[customer-request] background matching failed:", err);
  });
  try {
    waitUntil(matchWork);
  } catch {
    void matchWork;
  }

  // Confirmation ONLY. See the banner above.
  return { status: 200, body: { ok: true } };
}

/**
 * Link the request to an existing Shopify customer when the email matches one,
 * otherwise leave it a guest. Best effort — a lookup failure must never lose
 * the lead.
 *
 * `email` is a tokenized field in Shopify's search syntax, so it has to be
 * quoted to get an exact match rather than everyone at the same domain.
 */
async function findCustomerIdByEmail(admin, email) {
  if (!admin) return null;
  try {
    const response = await admin.graphql(
      `#graphql
      query FindCustomerByEmail($query: String!) {
        customers(first: 2, query: $query) {
          nodes { id email }
        }
      }`,
      { variables: { query: `email:"${email.replace(/"/g, '\\"')}"` } },
    );
    const payload = await response.json();
    const nodes = payload?.data?.customers?.nodes || [];
    const exact = nodes.filter((n) => (n.email || "").toLowerCase() === email);
    // Only link on an unambiguous single match.
    return exact.length === 1 ? exact[0].id : null;
  } catch (err) {
    console.error("[customer-request] customer lookup failed:", err?.message || err);
    return null;
  }
}

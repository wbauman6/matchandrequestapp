import { authenticate, unauthenticated } from "../shopify.server";
import { issueFormToken } from "../lib/customerRequest.server";
import { intakeCustomerRequest } from "../lib/customerRequestIntake.server";

/**
 * PUBLIC storefront request form endpoint, reached through the Shopify App
 * Proxy (`/apps/requests` on the shop's own domain → this route). Served to the
 * theme app extension in extensions/request-form.
 *
 *   GET  → mint a single-use bot token for the form
 *   POST → validate, rate-limit, create the Request, assign it round-robin, and
 *          run the SAME matching pipeline staff-created requests use
 *
 * Anyone can submit — no Shopify account needed. This route only handles
 * transport and authentication; the intake logic (and the rule that the
 * customer is never shown results) lives in
 * app/lib/customerRequestIntake.server.js.
 */

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Shopify's app proxy sets X-Forwarded-For to the shopper's IP; Vercel appends
// its own hops, so the original client is the leftmost entry.
function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || request.headers.get("x-real-ip") || null;
}

/** GET /apps/requests — hand the form a fresh single-use token. */
export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  return json({ token: issueFormToken() });
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // Verifies Shopify's HMAC signature; throws a Response if the request did not
  // come through the proxy. `session` is the shop's offline session.
  const { session, admin } = await authenticate.public.appProxy(request);

  const shop = session?.shop || new URL(request.url).searchParams.get("shop");
  if (!shop) return json({ ok: false, error: "Unknown shop" }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  // The proxy only supplies an Admin client when the shop has a live session;
  // fall back to the stored offline session so customer linking still works.
  let adminClient = admin;
  if (!adminClient) {
    try {
      ({ admin: adminClient } = await unauthenticated.admin(shop));
    } catch {
      adminClient = null; // request is still taken, just stored as a guest
    }
  }

  const result = await intakeCustomerRequest({
    shop,
    body,
    ip: clientIp(request),
    admin: adminClient,
  });

  return json(result.body, result.status);
};

/**
 * Authorisation for scheduled (cron) endpoints.
 *
 * These routes are expensive or irreversible — one drains the AI budget,
 * another emails every salesperson — and they sit on a public URL.
 *
 * The previous pattern failed OPEN:
 *
 *     const secret = process.env.CRON_SECRET;
 *     if (secret) { ...check... }      // no secret configured => no check
 *
 * CRON_SECRET was present in the local .env but never set in the deployment,
 * so in production that `if` was simply skipped and every cron endpoint was
 * callable by anyone. Confirmed against the live site: an unauthenticated
 * GET of /api/drain-queue returned 200 and did work.
 *
 * This fails CLOSED instead. A request is allowed only if it proves it is
 * the scheduler:
 *
 *   1. a correct `Authorization: Bearer <CRON_SECRET>` — what Vercel sends
 *      automatically once CRON_SECRET is configured; or
 *   2. Vercel's own cron header, which an outside caller cannot set on a
 *      request to this app.
 *
 * Accepting either means configuring CRON_SECRET later cannot break the
 * existing schedules, and not configuring it still keeps the public out.
 */

/** True when this request came from Vercel's cron scheduler. */
function isVercelCron(request) {
  if (request.headers.get("x-vercel-cron")) return true;
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  return ua.includes("vercel-cron");
}

/**
 * @returns {Response|null} a 401 to return immediately, or null if allowed.
 */
export function requireCronAuth(request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (token === secret) return null;
  }

  if (isVercelCron(request)) return null;

  // Deliberately terse: never hint at whether a secret is configured.
  return new Response("Unauthorized", { status: 401 });
}

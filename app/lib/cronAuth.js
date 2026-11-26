/**
 * Authorisation for scheduled (cron) endpoints.
 *
 * These routes are expensive or irreversible — one drains the AI budget,
 * another emails every salesperson — and they sit on a guessable public URL.
 *
 * Two failures to learn from, both found by testing against the live site
 * rather than by reading the code:
 *
 * 1. The original guard failed OPEN:
 *
 *        const secret = process.env.CRON_SECRET;
 *        if (secret) { ...check... }    // no secret configured => no check
 *
 *    CRON_SECRET is in the local .env, so this looked correct in review, but
 *    it was never set in the deployment. An unauthenticated GET of
 *    /api/drain-queue against production returned 200 and did work.
 *
 * 2. The first fix ALSO accepted Vercel's `x-vercel-cron` header, assuming an
 *    outside caller could not set it. That assumption was WRONG — Vercel
 *    passes the header through from inbound requests. Verified against
 *    production: curl with that header on /api/weekly-drop returned 200 from
 *    the open internet. A header anyone can send is not authentication.
 *
 * So: a shared secret, or nothing. No header fallback, no environment
 * sniffing, no "looks like the scheduler" heuristics.
 *
 * CONSEQUENCE, AND IT IS DELIBERATE: if CRON_SECRET is not set in the
 * deployment, every scheduled endpoint returns 401 and the crons stop. That
 * is the correct failure. A paused drop is visible and recoverable; an open
 * endpoint that spends money and emails real customers is neither.
 */

let warned = false;

/**
 * @returns {Response|null} a 401 to return immediately, or null if allowed.
 */
export function requireCronAuth(request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // Logged once per instance — enough to diagnose, not enough to flood.
    if (!warned) {
      warned = true;
      console.error(
        "[cron-auth] CRON_SECRET is not set. Every scheduled endpoint will " +
          "return 401 until it is configured in the deployment environment. " +
          "This is intentional: without it these endpoints would be callable " +
          "by anyone.",
      );
    }
    return new Response("Unauthorized", { status: 401 });
  }

  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token && token === secret) return null;

  return new Response("Unauthorized", { status: 401 });
}

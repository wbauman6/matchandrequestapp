/**
 * GET /api/drain-queue
 *
 * Two jobs, deliberately separated by cost:
 *
 *  1. Reap stalled matching runs (always). Cheap — one UPDATE, no AI. A pass
 *     killed mid-flight can never record its own failure, so without this the
 *     request shows "Finding matches…" forever. Safe to run hourly.
 *
 *  2. Drain the product-event queue (opt-in via ?force=1). EXPENSIVE — this is
 *     the AI matching fan-out. Normally it may only run inside the weekly drop
 *     window (see app/lib/dropSchedule.js); mid-week churn accumulates in the
 *     queue at zero AI cost. The scheduled cron therefore does NOT force, so it
 *     drains only when the window is genuinely open. Manual callers pass
 *     ?force=1 to override, which is what the old unconditional behaviour did.
 *
 * Protected by CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */
import prisma from "../db.server.js";
import { drainProductQueue } from "../lib/productQueue.server.js";
import { reapStalledMatches } from "../lib/matchRunner.server.js";

export const loader = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (token !== secret) return new Response("Unauthorized", { status: 401 });
  }

  // Backstop for matching runs killed mid-flight (function timeout, deploy,
  // crashed worker). The loaders self-heal a request when someone opens it;
  // this catches the ones nobody opens.
  const reaped = await reapStalledMatches().catch((e) => {
    console.error("[drain-queue] stalled-match reap failed:", e?.message || e);
    return 0;
  });

  // Only a manual call forces past the weekly-drop window. An hourly cron must
  // never do this — it would run the AI fan-out every hour and defeat the
  // weekly batching the drop schedule exists to enforce.
  const force = new URL(request.url).searchParams.get("force") === "1";

  const shops = await prisma.productQueue.groupBy({
    by: ["shop"],
    where: { status: "queued" },
    _count: { _all: true },
  });

  const results = [];
  for (const s of shops) {
    const drained = await drainProductQueue(s.shop, { force }).catch((e) => {
      console.error("[drain-queue] drain failed for", s.shop, e?.message || e);
      return { processed: 0, matched: 0, aborted: true };
    });
    results.push({ shop: s.shop, queued: s._count._all, ...drained });
  }

  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    reaped,
    forced: force,
    results,
  });
};

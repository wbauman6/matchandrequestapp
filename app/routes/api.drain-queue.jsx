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
import { requireCronAuth } from "../lib/cronAuth.js";
import prisma from "../db.server.js";
import { drainProductQueue, prewarmEmbeddings } from "../lib/productQueue.server.js";
import { reapStalledMatches, retryBudgetKilledMatches } from "../lib/matchRunner.server.js";
import { isDropWindow } from "../lib/dropSchedule.js";

export const loader = async ({ request }) => {
  // Fails CLOSED — see app/lib/cronAuth.js. CRON_SECRET was never set in the
  // deployment, and the old inline check skipped itself when it was absent,
  // leaving this endpoint open to anyone.
  const denied = requireCronAuth(request);
  if (denied) return denied;

  // Backstop for matching runs killed mid-flight (function timeout, deploy,
  // crashed worker). The loaders self-heal a request when someone opens it;
  // this catches the ones nobody opens.
  const reaped = await reapStalledMatches().catch((e) => {
    console.error("[drain-queue] stalled-match reap failed:", e?.message || e);
    return 0;
  });

  // Requests the AI budget killed yesterday are retryable today — the counter
  // rolls over daily. Without this they stay in "error" permanently and nobody
  // finds out until a customer asks why they never heard back.
  const requeued = await retryBudgetKilledMatches().catch((e) => {
    console.error("[drain-queue] budget requeue failed:", e?.message || e);
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
    // Pre-compute embeddings, but ONLY when the drop window is shut.
    //
    // This is the cheap half (Voyage) and spends no AI budget. Doing it on the
    // other six days is what lets the weekly window spend its 90 seconds on
    // matching instead of exhausting it on embedding round-trips — which is
    // why every DropRun came back "partial" while the queue grew to 4,120 rows
    // with attempts=0 across the board.
    //
    // Skipped inside the window so the two cannot share one 120s function and
    // time each other out: drain already budgets 90s, and prewarm would push
    // the invocation past Vercel's cap.
    const windowOpen = isDropWindow();
    const prewarmed =
      force || windowOpen
        ? null
        : await prewarmEmbeddings(s.shop, { timeBudgetMs: 85_000, limit: 1000 }).catch((e) => {
            console.error("[drain-queue] prewarm failed for", s.shop, e?.message || e);
            return null;
          });

    // Catch-up draining: ON by default, set QUEUE_CATCHUP=0 to disable.
    //
    // The weekly window exists so a webhook flood can't fan out thousands of
    // AI calls. Measured against this store's real data, that fear does not
    // match the numbers: of 199,545 (request x product) pairs in the backlog,
    // 142k fall below the retrieval gate, 39k were already judged, and 10k are
    // outside budget — leaving ~8,800 candidates, about 220 batched reasoning
    // calls to clear the whole thing against a 1,500/day cap.
    //
    // So the backlog was never expensive, only starved: one 90-second window a
    // week cannot get through it, which is why DropRun has read "partial"
    // since October while the queue grew. Draining on the other six days
    // clears it in days instead of months, and leaves the Tuesday window with
    // only that week's genuinely new stock to judge.
    //
    // ANTHROPIC_DAILY_CALL_LIMIT remains the real circuit breaker, so the
    // worst case is bounded regardless of this flag.
    const catchUp = process.env.QUEUE_CATCHUP !== "0" && !windowOpen && !force;

    const drained = await drainProductQueue(s.shop, { force: force || catchUp }).catch((e) => {
      console.error("[drain-queue] drain failed for", s.shop, e?.message || e);
      return { processed: 0, matched: 0, aborted: true };
    });
    results.push({ shop: s.shop, queued: s._count._all, prewarmed, ...drained });
  }

  return Response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    reaped,
    requeued,
    forced: force,
    catchUp: process.env.QUEUE_CATCHUP !== "0",
    results,
  });
};

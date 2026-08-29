/**
 * GET /api/drain-queue
 *
 * Cron backstop for the product-event queue. Webhook-triggered drains handle
 * the normal flow; this picks up anything left behind — items queued while the
 * AI budget was exhausted, a crashed worker's expired claims, or bursts larger
 * than one drain's time budget. Safe to run often: it exits immediately when
 * the queue is empty or another worker holds the shop's drain lease.
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
  // crashed worker). Those can never record their own failure, so without this
  // the request shows "Finding matches…" forever. The loaders self-heal a
  // request when someone opens it; this catches the ones nobody opens.
  const reaped = await reapStalledMatches().catch((e) => {
    console.error("[drain-queue] stalled-match reap failed:", e?.message || e);
    return 0;
  });

  const shops = await prisma.productQueue.groupBy({
    by: ["shop"],
    where: { status: "queued" },
    _count: { _all: true },
  });

  const results = [];
  for (const s of shops) {
    // Manual, secret-protected route — force past the weekly-drop window gate.
    const drained = await drainProductQueue(s.shop, { force: true }).catch((e) => {
      console.error("[drain-queue] drain failed for", s.shop, e?.message || e);
      return { processed: 0, matched: 0, aborted: true };
    });
    results.push({ shop: s.shop, queued: s._count._all, ...drained });
  }

  return Response.json({ ok: true, timestamp: new Date().toISOString(), reaped, results });
};

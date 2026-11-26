/**
 * GET /api/weekly-drop
 *
 * Cron entry point for the WEEKLY drop match (Tuesday 4:00 PM Eastern — see
 * app/lib/dropSchedule.js). Delegates to runWeeklyDrop, which does complete
 * (watermark-based) detection, guaranteed embedding, evaluation against ALL
 * active requests with per-pair error tracking, a persisted audit report
 * (DropRun), self-healing catch-up, and a failure alert email.
 *
 * Outside the drop window it's a no-op (?force=1 overrides, for testing).
 * Protected by CRON_SECRET.
 */
import { requireCronAuth } from "../lib/cronAuth.js";
import prisma from "../db.server.js";
import { runWeeklyDrop } from "../lib/dropRun.server.js";
import { isDropWindow } from "../lib/dropSchedule.js";

export const loader = async ({ request }) => {
  // Fails CLOSED — see app/lib/cronAuth.js. CRON_SECRET was never set in the
  // deployment, and the old inline check skipped itself when it was absent,
  // leaving this endpoint open to anyone.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const trigger = url.searchParams.get("trigger") || "cron";
  if (!isDropWindow() && !force) {
    return Response.json({ ok: true, skipped: "outside weekly drop window" });
  }

  const sessions = await prisma.session.findMany({ where: { isOnline: false }, distinct: ["shop"] });
  const results = [];
  for (const session of sessions) {
    const r = await runWeeklyDrop(session.shop, { force, trigger }).catch((e) => ({
      ok: false,
      shop: session.shop,
      error: String(e?.message || e),
    }));
    results.push({ shop: session.shop, ...r });
  }

  return Response.json({ ok: true, timestamp: new Date().toISOString(), results });
};

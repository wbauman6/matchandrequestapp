/**
 * GET /api/digest
 *
 * The ONLY routine email path. Fired daily by Vercel Cron (time in
 * vercel.json); actually sends only on the weekdays configured in
 * app/lib/digestConfig.js (default Monday + Thursday, store timezone).
 * Purely scheduled — never triggered by matching events.
 *
 * One digest per salesperson covering all of THEIR open requests that
 * currently have high/medium-confidence matches (low never counts): customer +
 * match count only, urgent-priority requests named at the top, no product
 * details. Salespeople with nothing to report get no email.
 *
 * Safety: per-salesperson per-day dedupe (a digest is never sent twice) and
 * the global MATCH_EMAIL_DAILY_LIMIT cap, both via DailyCounter.
 *
 * Query params (both still CRON_SECRET-protected):
 *   ?force=1 — send even if today isn't a configured digest day (testing)
 *   ?dry=1   — compute and return what WOULD be sent, without sending
 *
 * Protected by CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */
import prisma from "../db.server.js";
import { sendDigestEmail } from "../lib/email.server.js";
import { isDigestDay, todayName, DIGEST_DAYS } from "../lib/digestConfig.js";
import { bumpCounter, getCounter, EMAIL_DAILY_LIMIT } from "../lib/aiBudget.server.js";

export const loader = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (token !== secret) return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";

  if (!isDigestDay() && !force) {
    return Response.json({ ok: true, skipped: `today is ${todayName()}, digest days are ${DIGEST_DAYS.join("/")}` });
  }
  if (!process.env.RESEND_API_KEY && !dry) {
    return Response.json({ skipped: true, reason: "RESEND_API_KEY not set" });
  }

  // Open requests that currently have at least one high/medium-confidence,
  // non-declined match. Low-confidence matches show in app/POS but never put
  // a request into the digest.
  const requests = await prisma.request.findMany({
    where: {
      status: { in: ["active", "pending", "in_review"] },
      matches: { some: { declined: false, confidence: { in: ["high", "medium"] } } },
    },
    include: {
      matches: {
        where: { declined: false, confidence: { in: ["high", "medium"] } },
        select: { id: true },
      },
    },
  });

  // One digest per salesperson (grouped by email).
  const bySalesperson = new Map();
  for (const r of requests) {
    const email = (r.salespersonEmail || "").trim().toLowerCase();
    if (!email) continue;
    if (!bySalesperson.has(email)) {
      bySalesperson.set(email, { salespersonName: r.salespersonName, salespersonEmail: email, shop: r.shop, entries: [] });
    }
    bySalesperson.get(email).entries.push({
      customerName: r.customerName,
      description: r.description || "",
      priority: r.priority,
      matchCount: r.matches.length,
    });
  }

  const results = [];
  let sent = 0;
  for (const digest of bySalesperson.values()) {
    // Per-salesperson per-run dedupe: never the same digest twice.
    const already = await getCounter(`digest:${digest.salespersonEmail}`).catch(() => 0);
    if (already > 0) {
      results.push({ to: digest.salespersonEmail, skipped: "already sent this run" });
      continue;
    }
    // Global daily backstop against bugs.
    const sentToday = await getCounter("match_emails").catch(() => 0);
    if (sentToday >= EMAIL_DAILY_LIMIT) {
      results.push({ to: digest.salespersonEmail, skipped: `daily email cap (${EMAIL_DAILY_LIMIT}) reached` });
      continue;
    }

    if (dry) {
      results.push({ to: digest.salespersonEmail, wouldSend: digest.entries });
      continue;
    }
    try {
      await sendDigestEmail(digest);
      await bumpCounter(`digest:${digest.salespersonEmail}`);
      await bumpCounter("match_emails");
      sent++;
      results.push({ to: digest.salespersonEmail, requests: digest.entries.length, urgent: digest.entries.filter((e) => e.priority === "urgent").length });
    } catch (err) {
      console.error("[digest] send failed for", digest.salespersonEmail, err?.message || err);
      results.push({ to: digest.salespersonEmail, error: err?.message || String(err) });
    }
  }

  return Response.json({ ok: true, timestamp: new Date().toISOString(), day: todayName(), dry, sent, results });
};

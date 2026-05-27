/**
 * GET /api/reminders
 *
 * Called daily by Vercel Cron (see vercel.json).
 * Sends follow-up emails to salespeople who have unread matches and haven't
 * acted on them within the reminder window:
 *   - urgent:  every 2 days
 *   - normal:  every 7 days
 *
 * Protected by CRON_SECRET env var (set the same value in Vercel dashboard).
 * Vercel automatically sends  Authorization: Bearer <CRON_SECRET>  on cron calls.
 */

import prisma from "../db.server.js";
import { sendReminderEmail } from "../lib/email.server.js";

const URGENT_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const NORMAL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const loader = async ({ request }) => {
  // --- Auth ---
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json({ skipped: true, reason: "RESEND_API_KEY not set" });
  }

  const now = new Date();

  // Find every active/pending request that has at least one unread, non-declined match.
  const candidates = await prisma.request.findMany({
    where: {
      status: { in: ["active", "pending"] },
      matches: { some: { read: false, declined: false } },
    },
    include: {
      matches: {
        where: { read: false, declined: false },
        orderBy: { score: "desc" },
      },
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const req of candidates) {
    const intervalMs =
      req.priority === "urgent" ? URGENT_INTERVAL_MS : NORMAL_INTERVAL_MS;

    // Skip if a reminder was sent recently enough
    if (req.lastReminderAt) {
      const elapsed = now - new Date(req.lastReminderAt);
      if (elapsed < intervalMs) {
        skipped++;
        continue;
      }
    }

    try {
      await sendReminderEmail({
        salespersonName: req.salespersonName,
        salespersonEmail: req.salespersonEmail,
        customerName: req.customerName,
        priority: req.priority,
        budget: req.budget,
        matches: req.matches.map((m) => ({
          productTitle: m.productTitle,
          productPrice: m.productPrice,
          productImage: m.productImage,
          score: m.score,
          matchedKeywords: m.matchedKeywords,
        })),
        shop: req.shop,
      });

      await prisma.request.update({
        where: { id: req.id },
        data: { lastReminderAt: now },
      });

      sent++;
    } catch (err) {
      console.error(`[reminders] Failed to send for request ${req.id}:`, err);
    }
  }

  return Response.json({
    ok: true,
    timestamp: now.toISOString(),
    checked: candidates.length,
    sent,
    skipped,
  });
};

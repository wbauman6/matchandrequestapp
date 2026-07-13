import prisma from "../db.server.js";

/**
 * Daily cost kill switch. Every Anthropic API attempt increments a per-day
 * counter; once the cap is hit, matching hard-stops (throws) instead of
 * spending. A runaway fan-out (bulk product sync, webhook retry storm) is
 * capped at the limit no matter what upstream does.
 *
 * Limits (editable via env):
 *   ANTHROPIC_DAILY_CALL_LIMIT — max Anthropic API calls per UTC day (default 500).
 *   MATCH_EMAIL_DAILY_LIMIT    — max match-alert emails per UTC day (default 50).
 */
export const AI_DAILY_CALL_LIMIT = parseInt(process.env.ANTHROPIC_DAILY_CALL_LIMIT || "500", 10);
export const EMAIL_DAILY_LIMIT = parseInt(process.env.MATCH_EMAIL_DAILY_LIMIT || "50", 10);

export class AiBudgetExceededError extends Error {
  constructor(count, limit) {
    super(`AI daily call budget exceeded (${count}/${limit}) — matching paused until tomorrow (raise ANTHROPIC_DAILY_CALL_LIMIT if intentional)`);
    this.name = "AiBudgetExceededError";
    this.budgetExceeded = true;
  }
}

// Atomically increment a daily counter and return the new count.
export async function bumpCounter(key, n = 1) {
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "DailyCounter" (id, day, key, count)
     VALUES (gen_random_uuid()::text, CURRENT_DATE, $1, $2)
     ON CONFLICT (day, key) DO UPDATE SET count = "DailyCounter".count + $2
     RETURNING count`,
    key,
    n,
  );
  return Number(rows?.[0]?.count ?? n);
}

export async function getCounter(key) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT count FROM "DailyCounter" WHERE day = CURRENT_DATE AND key = $1`,
    key,
  );
  return Number(rows?.[0]?.count ?? 0);
}

/**
 * Called before EVERY Anthropic API attempt. Throws AiBudgetExceededError once
 * the daily cap is passed. Fails open on DB error (a counter outage must not
 * take matching down).
 */
export async function trackAiCall() {
  let count;
  try {
    count = await bumpCounter("anthropic_calls");
  } catch (err) {
    console.error("[aiBudget] counter unavailable, allowing call:", err?.message || err);
    return;
  }
  if (count > AI_DAILY_CALL_LIMIT) {
    console.error(`[aiBudget] KILL SWITCH: ${count} Anthropic calls today > limit ${AI_DAILY_CALL_LIMIT}`);
    throw new AiBudgetExceededError(count, AI_DAILY_CALL_LIMIT);
  }
}

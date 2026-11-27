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

/**
 * Absolute ceiling. Work marked `critical` may pass AI_DAILY_CALL_LIMIT but
 * never this.
 *
 * Why two numbers instead of just raising the one: the soft cap exists to stop
 * routine churn quietly running up a bill, and it should keep doing that. But
 * two kinds of work must NOT be abandoned halfway:
 *
 *   - a weekly drop that has already started. Stopping at call 500 of 600
 *     leaves the catalogue half-judged, and nothing retries the remainder, so
 *     a customer's piece sits unmatched for a week for the sake of a few cents.
 *   - a request a customer just submitted. That is the one call that is
 *     definitely worth making.
 *
 * "Go past the cap if needed" still needs a backstop, or a runaway loop costs
 * real money overnight — which is the exact scenario the kill switch was
 * written for. Default is 4x the soft cap; override with
 * ANTHROPIC_DAILY_HARD_LIMIT.
 */
export const AI_DAILY_HARD_LIMIT = parseInt(
  process.env.ANTHROPIC_DAILY_HARD_LIMIT || String(AI_DAILY_CALL_LIMIT * 4),
  10,
);

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
 * Called before EVERY Anthropic API attempt.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.critical=false] Work that must not be abandoned
 *   halfway: an in-flight weekly drop, or matching a request a customer just
 *   submitted. Critical work passes AI_DAILY_CALL_LIMIT but is still stopped
 *   by AI_DAILY_HARD_LIMIT.
 * @param {string} [opts.reason] Shown in the log when the soft cap is passed,
 *   so an overage says what caused it instead of appearing unexplained.
 *
 * Fails open on DB error (a counter outage must not take matching down).
 */
export async function trackAiCall({ critical = false, reason = "" } = {}) {
  let count;
  try {
    count = await bumpCounter("anthropic_calls");
  } catch (err) {
    console.error("[aiBudget] counter unavailable, allowing call:", err?.message || err);
    return;
  }

  if (count <= AI_DAILY_CALL_LIMIT) return;

  // Over the soft cap. Routine work stops here.
  if (!critical) {
    console.error(`[aiBudget] KILL SWITCH: ${count} Anthropic calls today > limit ${AI_DAILY_CALL_LIMIT}`);
    throw new AiBudgetExceededError(count, AI_DAILY_CALL_LIMIT);
  }

  // Critical work continues, but not forever.
  if (count > AI_DAILY_HARD_LIMIT) {
    console.error(
      `[aiBudget] HARD CEILING: ${count} Anthropic calls today > ${AI_DAILY_HARD_LIMIT} — ` +
        `stopping even critical work (${reason || "no reason given"})`,
    );
    throw new AiBudgetExceededError(count, AI_DAILY_HARD_LIMIT);
  }

  // Logged every time, not once: an overage should be visible in the logs for
  // exactly as long as it is happening.
  console.warn(
    `[aiBudget] over the daily cap (${count}/${AI_DAILY_CALL_LIMIT}) but continuing — ` +
      `${reason || "critical work"}. Hard ceiling ${AI_DAILY_HARD_LIMIT}.`,
  );
}

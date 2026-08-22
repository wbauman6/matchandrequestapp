/**
 * Weekly inventory-drop schedule — background (keep-watching) matching runs
 * ONLY in this window, because store inventory changes only at the weekly
 * drop: Tuesday 4:00 PM Eastern.
 *
 * >>> EDIT THIS FILE to change the drop day/time. <<<
 *
 * The window is evaluated in DROP_TIMEZONE with Intl (never a fixed UTC hour),
 * so it opens at 4 PM Eastern year-round across daylight-saving changes.
 *
 * SCHEDULING NOTE: Vercel crons fire at a FIXED UTC time (no timezone support),
 * so no single UTC time is 4 PM ET in both DST regimes. The cron is 21:00 UTC:
 *   • Winter (EST): 21:00 UTC = 4:00 PM ET — exact.
 *   • Summer (EDT): 21:00 UTC = 5:00 PM ET — one hour after the drop (fine; the
 *     drop has fully landed). Never BEFORE 4 PM, so the window never rejects it.
 * (20:00 UTC would be 4 PM EDT but 3 PM EST — the window would skip it all
 * winter, so we don't use it.) Hobby-plan crons are also best-effort and can be
 * delayed by up to a few hours; the window (open until early Wed) absorbs that,
 * and the last-successful-run watermark guarantees a delayed/skipped run loses
 * no inventory — the next successful run detects everything since.
 * Triggers during the window:
 *   1. The drop's own products/create|update webhooks (exact timing).
 *   2. The /api/weekly-drop cron (Tue 21:00 UTC), inside the window both regimes.
 * Outside the window, webhooks only queue events + screen sold items (no AI).
 * The window extends into early Wednesday so a large drop can finish draining.
 */
export const DROP_DAY = "tuesday";
export const DROP_HOUR_LOCAL = 16; // 4 PM
export const DROP_TIMEZONE = "America/New_York";

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DROP_TIMEZONE,
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: (get("weekday") || "").toLowerCase(), hour: parseInt(get("hour"), 10) % 24 };
}

// Tuesday from 4 PM through the end of the local day, plus a tail into early
// Wednesday (before 4 AM) so a big drop's drain can keep running.
export function isDropWindow(date = new Date()) {
  const { weekday, hour } = localParts(date);
  if (weekday === DROP_DAY && hour >= DROP_HOUR_LOCAL) return true;
  if (weekday === "wednesday" && hour < 4) return true;
  return false;
}

/**
 * Weekly inventory-drop schedule — background (keep-watching) matching runs
 * ONLY in this window, because store inventory changes only at the weekly
 * drop: Tuesday 4:00 PM Eastern.
 *
 * >>> EDIT THIS FILE to change the drop day/time. <<<
 *
 * The window is evaluated in DROP_TIMEZONE with Intl (never a fixed UTC hour),
 * so it lands at 4 PM Eastern year-round across daylight-saving changes.
 * Triggers during the window:
 *   1. The drop's own products/create|update webhooks (exact timing).
 *   2. The /api/weekly-drop cron backstop (Tue 22:00 UTC = 5/6 PM ET, always
 *      inside the window in both DST regimes).
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

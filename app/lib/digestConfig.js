/**
 * Digest schedule — the ONLY routine email the app sends.
 *
 * >>> EDIT THIS FILE to change when digests go out. <<<
 *
 * The Vercel cron fires the /api/digest route once every day (time set in
 * vercel.json, currently 13:00 UTC ≈ 9 AM New York in summer / 8 AM winter);
 * the route then only actually sends on the weekdays listed here, evaluated
 * in DIGEST_TIMEZONE. So: to change the DAYS, edit this file; to change the
 * TIME of day, edit the cron expression in vercel.json.
 */
export const DIGEST_DAYS = ["monday", "thursday"];

export const DIGEST_TIMEZONE = "America/New_York";

// Which weekday is it right now, in the store's timezone? → "monday" etc.
export function todayName(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: DIGEST_TIMEZONE })
    .format(date)
    .toLowerCase();
}

export function isDigestDay(date = new Date()) {
  return DIGEST_DAYS.includes(todayName(date));
}

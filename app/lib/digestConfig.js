/**
 * Digest schedule — the ONLY routine email the app sends.
 *
 * >>> EDIT THIS FILE to change when digests go out. <<<
 *
 * The Vercel cron fires the /api/digest route on the days below (also encoded
 * in vercel.json's cron day-of-week field — keep them in sync) at 14:15 UTC:
 * 10:15 AM Eastern during daylight time, 9:15 AM in winter (Vercel Hobby crons
 * are fixed-UTC, so the exact local hour shifts one hour across DST).
 * To change the DAYS, edit this list AND the vercel.json cron; to change the
 * TIME, edit the cron expression in vercel.json.
 */
export const DIGEST_DAYS = ["wednesday", "saturday"];

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

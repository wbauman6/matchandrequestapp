import { namesDesignerBrand } from "./requestKind.js";
import { normalizeRequestTerms } from "./jewelryTerms.js";
import { nextAction, appraiserReady } from "./nextAction.js";

/**
 * Turn a loaded request into the counts nextAction() needs.
 *
 * Every screen that shows "what happens next" loads the request with the SAME
 * three relations (see WORK_INCLUDE) and runs it through here, so POS, the
 * admin list and the appraiser page cannot drift apart.
 */

/**
 * Prisma `include` for the work state. `matches` is LIVE matches only;
 * `_count.matches` is every match ever found, declined included — the
 * difference between the two is what tells "never found anything" apart from
 * "found pieces and the salesperson turned them all down".
 */
export const WORK_INCLUDE = {
  matches: {
    where: { declined: false },
    select: { id: true, read: true, keptAt: true },
  },
  estateSuggestions: {
    where: { status: { in: ["suggested", "approved"] } },
    select: { id: true, status: true, location: true, note: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
  _count: { select: { matches: true } },
};

/**
 * Brand detection runs on NORMALIZED text. Staff type brands the way they say
 * them — "e newton" for enewton — and checking raw text would send a branded
 * request to the appraiser.
 */
export function isNonDesigner(r) {
  return !namesDesignerBrand(normalizeRequestTerms(r.description || ""));
}

export function workState(r, now = new Date()) {
  const live = r.matches || [];
  const estate = r.estateSuggestions || [];
  const counts = {
    liveMatches: live.length,
    totalMatches: r._count?.matches ?? live.length,
    unreadMatches: live.filter((m) => !m.read).length,
    keptMatches: live.filter((m) => m.keptAt).length,
    pendingEstate: estate.filter((e) => e.status === "suggested").length,
    approvedEstate: estate.filter((e) => e.status === "approved").length,
    nonDesigner: isNonDesigner(r),
  };
  const input = {
    status: r.status,
    requestKind: r.requestKind,
    source: r.source,
    calledAt: r.calledAt,
    callOutcome: r.callOutcome,
    followUpAt: r.followUpAt,
    matchState: r.matchState,
    ...counts,
  };
  return {
    ...counts,
    declinedMatches: counts.totalMatches - counts.liveMatches,
    appraiserReady: appraiserReady(input),
    nextAction: nextAction(input, now),
  };
}

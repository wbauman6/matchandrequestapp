/**
 * What should happen next on a request, and whose turn it is.
 *
 * Before this, the screens were places to look ("Working on", "New matches",
 * "Nothing found yet") rather than an order of work. A salesperson opening the
 * iPad had no way to know where to start, and the appraiser saw every open
 * request whether or not sales still had pieces to show.
 *
 * One request gets exactly ONE next action. If a request both has a kept piece
 * and a follow-up call due today, it appears once, as the call.
 *
 * Pure functions, no I/O — the POS endpoint, the admin list and the appraiser
 * page all call these so the three screens can never disagree about whose turn
 * it is.
 */

export const GROUPS = { DO: "do", WAITING: "waiting", DONE: "done", OFFICE: "office" };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function endOfDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Is a follow-up call due today or overdue? */
export function followUpDue(followUpAt, now = new Date()) {
  if (!followUpAt) return false;
  return new Date(followUpAt).getTime() <= endOfDay(now).getTime();
}

/** Is a follow-up scheduled for a later day? */
export function followUpLater(followUpAt, now = new Date()) {
  return Boolean(followUpAt) && !followUpDue(followUpAt, now);
}

function shortDate(d) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Should the appraiser see this request?
 *
 * The rule, in the owner's words: requests do not go to the appraiser while
 * there are matches — only once the matches are denied.
 *
 *   - never had a match        -> NOT appraiser (nobody has rejected anything;
 *                                 that is "waiting for inventory")
 *   - any match still live     -> NOT appraiser (it is the salesperson's turn)
 *   - had matches, all denied  -> appraiser
 *
 * A new match arriving later makes liveMatches > 0 again, which takes the
 * request back off the appraiser's list with no extra bookkeeping.
 */
export function appraiserReady({ status, requestKind, nonDesigner, liveMatches, totalMatches }) {
  if (status !== "active" && status !== "pending") return false;
  if ((requestKind || "item") !== "item") return false;
  if (!nonDesigner) return false;
  return totalMatches > 0 && liveMatches === 0;
}

/**
 * @param {object} r
 * @param {string} r.status            active | pending | fulfilled | archived
 * @param {string} [r.requestKind]     item | vague | service | ...
 * @param {string} [r.source]          staff | customer
 * @param {Date|string|null} [r.calledAt]
 * @param {string|null} [r.callOutcome]
 * @param {Date|string|null} [r.followUpAt]
 * @param {string|null} [r.matchState]
 * @param {number} [r.liveMatches]     matches not declined
 * @param {number} [r.totalMatches]    matches ever found, declined included
 * @param {number} [r.unreadMatches]   live matches nobody has opened
 * @param {number} [r.keptMatches]     live matches marked "keep to show"
 * @param {number} [r.pendingEstate]   estate pieces awaiting a yes/no from sales
 * @param {number} [r.approvedEstate]  estate pieces approved, being appraised
 * @param {boolean} [r.nonDesigner]
 * @returns {{ key: string, group: string, rank: number, label: string }}
 */
export function nextAction(r, now = new Date()) {
  const kind = r.requestKind || "item";
  const live = r.liveMatches || 0;
  const total = r.totalMatches || 0;
  const unread = r.unreadMatches || 0;
  const kept = r.keptMatches || 0;

  if (r.status === "fulfilled") return { key: "sold", group: GROUPS.DONE, rank: 99, label: "Sold" };
  if (r.status === "archived") return { key: "archived", group: GROUPS.DONE, rank: 99, label: "Archived" };

  // Services, questions, buying enquiries and spam have no salesperson. They
  // are office work and must never be mixed into a salesperson's callbacks.
  if (kind !== "item" && kind !== "vague") {
    return { key: "office", group: GROUPS.OFFICE, rank: 90, label: "Office enquiry" };
  }

  // 1. A promised call that is due. Ahead of everything else: the customer was
  //    told they would hear back.
  if (followUpDue(r.followUpAt, now)) {
    return {
      key: "followUp",
      group: GROUPS.DO,
      rank: 1,
      label:
        r.callOutcome === "message"
          ? "Call again \u2014 you left a message"
          : "Call customer \u2014 follow-up due",
    };
  }

  const waitingOnCallback = followUpLater(r.followUpAt, now);

  // 2. Someone who has never been spoken to. A vague lead ("stunning
  //    earrings") cannot be searched until a person asks what they mean.
  if (!waitingOnCallback && !r.calledAt) {
    if (kind === "vague") {
      return { key: "callDetails", group: GROUPS.DO, rank: 2, label: "Call customer \u2014 ask what they want" };
    }
    if (r.source === "customer") {
      return { key: "call", group: GROUPS.DO, rank: 2, label: "Call customer \u2014 new website request" };
    }
  }

  // 3. A piece to decide on.
  if ((r.pendingEstate || 0) > 0) {
    return { key: "estate", group: GROUPS.DO, rank: 3, label: "Review estate piece from the appraiser" };
  }
  if (unread > 0) {
    return { key: "newMatches", group: GROUPS.DO, rank: 3, label: `Review ${plural(unread, "new match", "new matches")}` };
  }

  // 4. A piece was picked but the request is still open.
  if (kept > 0) {
    return {
      key: "show",
      group: GROUPS.DO,
      rank: 4,
      label: kept === 1 ? "Show customer the piece you picked" : `Show customer the ${kept} pieces you picked`,
    };
  }

  // 5. Matches that have been looked at but never decided either way.
  if (live > 0) {
    return { key: "decide", group: GROUPS.DO, rank: 5, label: `Decide on ${plural(live, "match", "matches")}` };
  }

  // ---- Nothing for the salesperson to do right now ----
  if (waitingOnCallback) {
    return {
      key: "callbackLater",
      group: GROUPS.WAITING,
      rank: 50,
      label:
        r.callOutcome === "message"
          ? `Left a message \u2014 call again ${shortDate(r.followUpAt)}`
          : `Call back ${shortDate(r.followUpAt)}`,
    };
  }
  if (kind === "vague") {
    // Called, but the request has not been rewritten into something searchable.
    return { key: "needsRewrite", group: GROUPS.DO, rank: 2, label: "Update the request with what they want" };
  }
  if ((r.approvedEstate || 0) > 0) {
    return { key: "appraising", group: GROUPS.WAITING, rank: 51, label: "Estate piece being appraised" };
  }
  if (r.matchState === "pending") {
    return { key: "searching", group: GROUPS.WAITING, rank: 52, label: "Searching inventory\u2026" };
  }
  if (r.matchState === "error") {
    return { key: "problem", group: GROUPS.WAITING, rank: 53, label: "Search didn\u2019t finish \u2014 will retry" };
  }
  if (appraiserReady({ ...r, liveMatches: live, totalMatches: total })) {
    return { key: "appraiser", group: GROUPS.WAITING, rank: 54, label: "With appraiser \u2014 checking estate stock" };
  }
  return { key: "watching", group: GROUPS.WAITING, rank: 55, label: "No match found yet \u2014 still watching" };
}

/**
 * Order a list for "do next": by rank, then longest-waiting first, so the
 * customer who has waited longest within a group is at the top of it.
 */
export function sortByNextAction(rows) {
  return [...rows].sort((a, b) => {
    const ra = a.nextAction?.rank ?? 99;
    const rb = b.nextAction?.rank ?? 99;
    if (ra !== rb) return ra - rb;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  });
}

/**
 * Find a request someone half-remembers. Every word typed must appear
 * somewhere in the customer's name, contact details, or the request text —
 * so "white chain" finds "18-inch white gold diamond-cut chain" without the
 * exact phrase. Phone digits match regardless of punctuation.
 */
export function matchesSearch(r, query) {
  const words = String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const phoneDigits = String(r.customerPhone || "").replace(/\D/g, "");
  const hay = [r.customerName, r.customerEmail, r.customerPhone, r.description, r.matchNotes, r.salespersonName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => {
    if (hay.includes(w)) return true;
    const digits = w.replace(/\D/g, "");
    return digits.length >= 3 && phoneDigits.includes(digits);
  });
}

/** When to try again after each call outcome. */
export function followUpFor(outcome, now = new Date()) {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  if (outcome === "message" || outcome === "later") {
    d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

export const DECLINE_REASONS = {
  price: "Too expensive",
  style: "Wrong style",
  size: "Wrong size",
  quality: "Not nice enough",
  other: "Other",
};

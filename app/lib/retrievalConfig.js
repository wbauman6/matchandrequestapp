// Dynamic retrieval cap — how many candidates the semantic search feeds to the
// AI reasoning pass. Instead of a fixed number, the pool SCALES with how many
// items genuinely resemble the request: narrow queries stay small and cheap,
// broad queries (hundreds of real diamond bracelets) surface many.
//
// Pipeline: hard-filter the FULL catalog first (in-stock only + budget, in SQL),
// order by cosine similarity, then:
//   • include every item at/above SIMILARITY_THRESHOLD,
//   • but never fewer than FLOOR (top-N by similarity — narrow queries still get
//     a workable set),
//   • and never more than CEILING (top-N by similarity — caps cost on very
//     broad queries; the slots are all in-stock/in-budget by construction).
//
// >>> EDIT THESE to trade recall vs cost. <<<
export const SIMILARITY_THRESHOLD = 0.48; // cosine (0–1); below this, items are usually off-topic
export const RETRIEVAL_FLOOR = 20; // always send at least this many candidates
export const RETRIEVAL_CEILING = 150; // never send more than this many

/**
 * Given rows pre-filtered + ordered by similarity DESC (each { sim, ... }),
 * apply threshold → floor → ceiling. Rows MUST already be capped at CEILING by
 * the SQL LIMIT and already hard-filtered (in-stock/budget).
 */
export function applyDynamicCap(rowsSortedBySim) {
  const above = rowsSortedBySim.filter((r) => r.sim >= SIMILARITY_THRESHOLD);
  const pool = above.length >= RETRIEVAL_FLOOR ? above : rowsSortedBySim.slice(0, RETRIEVAL_FLOOR);
  return pool.slice(0, RETRIEVAL_CEILING);
}

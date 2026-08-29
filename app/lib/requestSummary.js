/**
 * What is this request ACTUALLY being matched on?
 *
 * Matching embeds the description and the refinement notes TOGETHER (see
 * buildRequestText in embeddings.server.js), and the AI is told the note wins on
 * conflict. But the UI used to show only the frozen original description as the
 * heading, with the note buried in a field below it — so a request whose
 * description said "14K WG Dia Ring" and whose note said "Make it yellow gold"
 * displayed as white gold while returning 83 yellow-gold matches. Staff read
 * that as "my edit didn't save".
 *
 * This builds the one line the UI shows so the screen always agrees with what
 * the matcher is doing. Deliberately deterministic — no AI call, so it can't
 * add latency, cost, or a third version of the truth.
 */

/** The request as the matcher sees it: description, then any refinement note. */
export function matchingSummary(request) {
  const description = String(request?.description || "").trim();
  const notes = String(request?.matchNotes || "").trim();
  if (!description) return notes;
  if (!notes) return description;
  return `${description} — ${notes}`;
}

/** True when a note exists, i.e. the heading alone doesn't tell the whole story. */
export function hasRefinement(request) {
  return Boolean(String(request?.matchNotes || "").trim());
}

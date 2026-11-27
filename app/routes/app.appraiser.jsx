import { useLoaderData, Link, Form, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { WORK_INCLUDE, workState } from "../lib/requestWork.js";
import { matchingSummary } from "../lib/requestSummary.js";
import { DECLINE_REASONS } from "../lib/nextAction.js";

/**
 * Appraiser page.
 *
 * The shop buys estate pieces faster than they can be appraised, so the
 * appraiser needs a reason to pull one piece ahead of the backlog. That reason
 * is a customer who is waiting and whom sales could not help from stock.
 *
 * A request appears here ONLY when it is for a piece with no designer name,
 * matches were found, and the salesperson turned every one of them down:
 *
 *   never had a match        -> not here (waiting for inventory; nobody has
 *                               rejected anything yet)
 *   a match still to show    -> not here (it is the salesperson's turn)
 *   all suggestions declined -> here
 *
 * A new match arriving later takes the request back off this page on its own.
 *
 * This is a handoff of WORK, not of the customer. The salesperson still owns
 * the relationship. When the appraiser spots a piece that might fit they
 * suggest it; nothing is appraised until the salesperson says yes.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const requests = await prisma.request.findMany({
    where: { shop, requestKind: "item", status: { in: ["active", "pending"] } },
    include: WORK_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  const worked = requests.map((r) => ({ r, work: workState(r) }));
  const ready = worked.filter((x) => x.work.appraiserReady);
  const readyIds = ready.map((x) => x.r.id);

  // What was turned down, and why — the useful half of the handoff.
  const [declined, pastSuggestions, approved] = await Promise.all([
    readyIds.length
      ? prisma.match.findMany({
          where: { shop, requestId: { in: readyIds }, declined: true },
          select: { requestId: true, productTitle: true, productPrice: true, declineReason: true },
          orderBy: { declinedAt: "desc" },
        })
      : [],
    readyIds.length
      ? prisma.estateSuggestion.findMany({
          where: { shop, requestId: { in: readyIds }, status: "declined" },
          select: { requestId: true, location: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
    // Pieces sales has said yes to. Shown even if the request has since left
    // the list above (e.g. a new stock match arrived) — a yes is a yes.
    prisma.estateSuggestion.findMany({
      where: { shop, status: "approved" },
      include: {
        request: {
          select: { id: true, customerName: true, description: true, matchNotes: true, salespersonName: true, budget: true },
        },
      },
      orderBy: { decidedAt: "asc" },
    }),
  ]);

  const rows = ready.map(({ r }) => {
    const mine = declined.filter((d) => d.requestId === r.id);
    const reasonCounts = {};
    for (const d of mine) {
      if (d.declineReason) reasonCounts[d.declineReason] = (reasonCounts[d.declineReason] || 0) + 1;
    }
    return {
      id: r.id,
      lookingFor: matchingSummary(r),
      customerName: r.customerName,
      salespersonName: r.salespersonName,
      budget: r.budget,
      // Days waiting. An old request that sales could not fill is the
      // strongest signal on the page.
      ageDays: Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000),
      declinedCount: mine.length,
      reasons: Object.entries(reasonCounts).map(([k, n]) => ({ label: DECLINE_REASONS[k] || k, n })),
      declinedTitles: mine.slice(0, 3).map((d) => ({ title: d.productTitle, price: d.productPrice })),
      // Suggestions the appraiser already made that sales has not answered.
      waitingOnSales: r.estateSuggestions.filter((e) => e.status === "suggested"),
      turnedDown: pastSuggestions.filter((p) => p.requestId === r.id).map((p) => p.location),
    };
  });
  // Longest-waiting customer first.
  rows.sort((a, b) => b.ageDays - a.ageDays);

  return {
    rows,
    approved: approved.map((a) => ({
      id: a.id,
      location: a.location,
      note: a.note,
      decidedBy: a.decidedBy,
      requestId: a.request.id,
      lookingFor: matchingSummary(a.request),
      customerName: a.request.customerName,
      salespersonName: a.request.salespersonName,
    })),
    // Why the list is short: where every other open request is instead.
    elsewhere: {
      withSales: worked.filter((x) => x.work.liveMatches > 0).length,
      neverMatched: worked.filter((x) => x.work.totalMatches === 0 && x.work.nonDesigner).length,
      designer: worked.filter((x) => !x.work.nonDesigner && x.work.liveMatches === 0).length,
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const data = await request.formData();
  const act = data.get("_action");

  // Put an estate piece forward for a request. The request is looked up in
  // THIS shop first, so a tampered form cannot attach a suggestion to another
  // store's request.
  if (act === "suggest") {
    const requestId = String(data.get("requestId") || "");
    const location = String(data.get("location") || "").trim().slice(0, 200);
    const note = String(data.get("note") || "").trim().slice(0, 500) || null;
    if (!location) return { error: "Say where the piece is, so sales can find it." };
    const req = await prisma.request.findFirst({ where: { id: requestId, shop }, select: { id: true } });
    if (!req) return { error: "That request no longer exists." };
    await prisma.estateSuggestion.create({ data: { shop, requestId, location, note } });
    return { ok: true };
  }

  // Take back a suggestion sales has not answered yet.
  if (act === "withdraw") {
    await prisma.estateSuggestion.updateMany({
      where: { id: String(data.get("id") || ""), shop, status: "suggested" },
      data: { status: "withdrawn" },
    });
    return { ok: true };
  }

  // The approved piece has been appraised. Hidden from this page, kept in the
  // database — nothing here is ever deleted.
  if (act === "appraised") {
    await prisma.estateSuggestion.updateMany({
      where: { id: String(data.get("id") || ""), shop, status: "approved" },
      data: { status: "appraised" },
    });
    return { ok: true };
  }

  return null;
};

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString()}`);
const waited = (d) => (d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`);

export default function AppraiserPage() {
  const { rows, approved, elsewhere } = useLoaderData();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <s-page heading="Appraiser">
      <s-section heading="Ready to appraise">
        <p style={hint}>
          Estate pieces a salesperson has looked at and said <strong>yes</strong> to. These are
          the ones worth doing ahead of the rest of the backlog — a customer is waiting.
        </p>
        {approved.length === 0 ? (
          <p style={empty}>Nothing approved yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {approved.map((a) => (
              <div key={a.id} style={{ ...card, borderColor: "#95c9a7", background: "#f3faf5" }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{a.location}</div>
                  {a.note && <div style={sub}>{a.note}</div>}
                  <div style={{ ...sub, marginTop: 6 }}>
                    For{" "}
                    <Link to={`/app/requests/${a.requestId}`} style={link}>
                      {a.customerName}
                    </Link>{" "}
                    — {a.lookingFor}
                  </div>
                  <div style={sub}>
                    Approved by {a.decidedBy || a.salespersonName}. Tell {a.salespersonName} when
                    it is ready.
                  </div>
                </div>
                <Form method="post">
                  <input type="hidden" name="_action" value="appraised" />
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" disabled={busy} style={primaryBtn}>
                    Appraised — done
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading={`Customers waiting — check estate stock (${rows.length})`}>
        <p style={hint}>
          Each of these customers was shown what we have listed, and{" "}
          <strong>the salesperson said none of it was right</strong>. If a piece in the estate
          backlog could fit, suggest it. <strong>Suggesting is not appraising</strong> — the
          salesperson looks first and says yes or no. Longest-waiting customer first.
        </p>
        {rows.length === 0 ? (
          <p style={empty}>
            Nobody is waiting on estate stock. Requests appear here only after a salesperson
            has turned down every piece we suggested.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map((r) => (
              <div key={r.id} style={{ ...card, flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
                  <Link
                    to={`/app/requests/${r.id}`}
                    style={{ ...link, fontWeight: 700, fontSize: 16, flex: 1, minWidth: 260 }}
                  >
                    {r.lookingFor}
                  </Link>
                  <span style={{ fontSize: 13, color: r.ageDays > 30 ? "#a85100" : "#6d7175", fontWeight: 600 }}>
                    Waiting {waited(r.ageDays)}
                  </span>
                </div>
                <div style={sub}>
                  {r.budget != null ? `Budget ${money(r.budget)} · ` : ""}
                  For {r.customerName} · Salesperson {r.salespersonName}
                </div>

                <div style={{ ...sub, marginTop: 8, color: "#414547" }}>
                  <strong>
                    {r.declinedCount === 1
                      ? "The 1 piece we suggested was not a fit"
                      : `All ${r.declinedCount} pieces we suggested were not a fit`}
                  </strong>
                  {r.reasons.length > 0 && (
                    <>
                      {" — "}
                      {r.reasons.map((x) => (x.n > 1 ? `${x.label} (${x.n})` : x.label)).join(", ")}
                    </>
                  )}
                </div>
                {r.declinedTitles.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "#6d7175" }}>
                    {r.declinedTitles.map((d, i) => (
                      <li key={i}>
                        {d.title}
                        {d.price != null ? ` — ${money(d.price)}` : ""}
                      </li>
                    ))}
                    {r.declinedCount > r.declinedTitles.length && (
                      <li>and {r.declinedCount - r.declinedTitles.length} more</li>
                    )}
                  </ul>
                )}
                {r.turnedDown.length > 0 && (
                  <div style={{ ...sub, marginTop: 6 }}>
                    Estate pieces already tried and turned down: {r.turnedDown.join("; ")}
                  </div>
                )}

                {r.waitingOnSales.map((e) => (
                  <div key={e.id} style={waitingBox}>
                    <div style={{ flex: 1 }}>
                      <strong>Waiting for {r.salespersonName} to look:</strong> {e.location}
                      {e.note ? ` — ${e.note}` : ""}
                    </div>
                    <Form method="post">
                      <input type="hidden" name="_action" value="withdraw" />
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" disabled={busy} style={plainBtn}>
                        Take back
                      </button>
                    </Form>
                  </div>
                ))}

                <Form method="post" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <input type="hidden" name="_action" value="suggest" />
                  <input type="hidden" name="requestId" value={r.id} />
                  <label htmlFor={`loc-${r.id}`} style={srOnly}>
                    Where the piece is
                  </label>
                  <input
                    id={`loc-${r.id}`}
                    name="location"
                    required
                    maxLength={200}
                    placeholder="Found a piece? Say where it is — e.g. Estate tray B, envelope 14"
                    style={{ ...input, flex: 2, minWidth: 260 }}
                  />
                  <label htmlFor={`note-${r.id}`} style={srOnly}>
                    Note for the salesperson
                  </label>
                  <input
                    id={`note-${r.id}`}
                    name="note"
                    maxLength={500}
                    placeholder="Note (optional) — e.g. 2.5mm, heavier than it looks"
                    style={{ ...input, flex: 2, minWidth: 220 }}
                  />
                  <button type="submit" disabled={busy} style={primaryBtn}>
                    Suggest to {r.salespersonName.split(" ")[0]}
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Why other requests are not on this page">
        <p style={{ ...hint, marginBottom: 0 }}>
          <strong>{elsewhere.withSales}</strong> open request{elsewhere.withSales === 1 ? " has" : "s have"}{" "}
          pieces the salesperson is still deciding on. <strong>{elsewhere.neverMatched}</strong>{" "}
          {elsewhere.neverMatched === 1 ? "has" : "have"} never found a match and{" "}
          {elsewhere.neverMatched === 1 ? "is" : "are"} waiting for inventory — see them on the{" "}
          <Link to="/app" style={link}>
            Requests
          </Link>{" "}
          page under <em>Waiting for inventory</em>. <strong>{elsewhere.designer}</strong> name a
          designer and do not need appraising.
        </p>
      </s-section>
    </s-page>
  );
}

const hint = { color: "#6d7175", marginTop: 0, fontSize: 13, lineHeight: 1.5 };
const empty = { color: "#6d7175", textAlign: "center", padding: "28px 0", margin: 0 };
const sub = { fontSize: 13, color: "#6d7175", lineHeight: 1.5 };
const link = { color: "#005bd3", textDecoration: "none" };
const card = {
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "center",
  border: "1px solid #e1e3e5",
  borderRadius: 8,
  padding: 14,
  background: "#fff",
};
const waitingBox = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  marginTop: 10,
  padding: "8px 12px",
  borderRadius: 6,
  background: "#fff5ea",
  color: "#7a4100",
  fontSize: 13,
};
const input = {
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
const primaryBtn = {
  background: "#008060",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "9px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const plainBtn = {
  background: "#fff",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 12,
  cursor: "pointer",
  color: "#414547",
};
const srOnly = { position: "absolute", left: -9999 };

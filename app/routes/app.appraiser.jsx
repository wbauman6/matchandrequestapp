import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { namesDesignerBrand } from "../lib/requestKind.js";
import { normalizeRequestTerms } from "../lib/jewelryTerms.js";

/**
 * Appraiser dashboard.
 *
 * The appraiser's problem: estate pieces arrive faster than they can be
 * appraised, and nothing on any existing screen says which to do first. The
 * answer is demand — a piece customers are actively asking for is worth
 * appraising before one nobody has requested.
 *
 * Only NON-DESIGNER requests appear. A signed Cartier bracelet needs no
 * appraisal to identify or price; an unsigned estate ring is exactly the work.
 *
 * Ranked by "nothing found" first, because a request with no match is unmet
 * demand: either the piece is sitting unappraised in the back, or it is worth
 * sourcing. A request already showing matches is served.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const requests = await prisma.request.findMany({
    where: {
      shop,
      // Services, questions and spam are not appraisal work.
      requestKind: "item",
      status: { in: ["active", "pending"] },
    },
    include: { _count: { select: { matches: { where: { declined: false } } } } },
    orderBy: { createdAt: "desc" },
  });

  // Brand detection runs on NORMALIZED text. Staff type brands the way they
  // say them — "e newton" for enewton — and checking raw text would drop a
  // branded request into this queue.
  const nonDesigner = requests.filter(
    (r) => !namesDesignerBrand(normalizeRequestTerms(r.description || "")),
  );

  const rows = nonDesigner
    .map((r) => ({
      id: r.id,
      description: r.description,
      customerName: r.customerName,
      createdAt: r.createdAt,
      matchCount: r._count.matches,
      pinned: r.pinned,
      // Days waiting. An old unmet request is a stronger signal than a new one:
      // it has survived several inventory drops without being satisfied.
      ageDays: Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000),
    }))
    // Nothing-found first, then longest-waiting. Both are "unmet demand", and
    // age breaks the tie in favour of the customer who has waited longest.
    .sort((a, b) => {
      if ((a.matchCount === 0) !== (b.matchCount === 0)) return a.matchCount === 0 ? -1 : 1;
      if (a.matchCount !== b.matchCount) return a.matchCount - b.matchCount;
      return b.ageDays - a.ageDays;
    });

  const salespeople = await prisma.salesperson.findMany({
    where: { shop, role: "appraiser" },
    select: { name: true },
  });

  return {
    rows,
    totalItems: requests.length,
    unmet: rows.filter((r) => r.matchCount === 0).length,
    appraisers: salespeople.map((s) => s.name),
  };
};

export default function AppraiserPage() {
  const { rows, totalItems, unmet, appraisers } = useLoaderData();

  return (
    <s-page heading="Appraiser">
      <s-section heading="What to appraise first">
        <p style={{ color: "#6d7175", marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
          Requests for pieces with <strong>no designer name</strong> — the ones that need
          someone to identify and price them. Requests showing{" "}
          <strong>Nothing found</strong> are at the top: a customer is asking for something
          the shop isn&apos;t currently showing, so a matching piece waiting to be appraised
          is worth doing first.
        </p>
        <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap" }}>
          <Stat label="Need appraising" value={rows.length} />
          <Stat label="Nothing found yet" value={unmet} tone={unmet > 0 ? "warn" : "ok"} />
          <Stat label="All item requests" value={totalItems} />
        </div>
        {appraisers.length > 0 && (
          <p style={{ color: "#6d7175", fontSize: 12, marginBottom: 0, marginTop: 14 }}>
            Appraisers: {appraisers.join(", ")}
          </p>
        )}
      </s-section>

      <s-section heading={`Queue (${rows.length})`}>
        {rows.length === 0 ? (
          <p style={{ color: "#6d7175", textAlign: "center", padding: "40px 0", margin: 0 }}>
            Nothing waiting. Every open request either names a designer or already has
            something to show the customer.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e1e3e5", textAlign: "left" }}>
                  <Th>What they want</Th>
                  <Th>Customer</Th>
                  <Th>Waiting</Th>
                  <Th>In stock</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nothing = r.matchCount === 0;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                      <td style={{ padding: "12px 16px" }}>
                        <Link
                          to={`/app/requests/${r.id}`}
                          style={{ color: "#005bd3", textDecoration: "none", fontWeight: 600 }}
                        >
                          {r.description}
                        </Link>
                      </td>
                      <td style={{ padding: "12px 16px", color: "#6d7175" }}>
                        {r.customerName}
                      </td>
                      <td style={{ padding: "12px 16px", color: r.ageDays > 30 ? "#a85100" : "#6d7175" }}>
                        {r.ageDays === 0 ? "Today" : `${r.ageDays} day${r.ageDays === 1 ? "" : "s"}`}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            padding: "3px 9px",
                            borderRadius: 10,
                            background: nothing ? "#fff5ea" : "#e3f1df",
                            color: nothing ? "#a85100" : "#1a7a4a",
                          }}
                        >
                          {nothing ? "Nothing found" : `${r.matchCount} to show`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

function Th({ children }) {
  return (
    <th style={{ padding: "10px 16px", fontSize: 12, color: "#6d7175", fontWeight: 600 }}>
      {children}
    </th>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: tone === "warn" ? "#a85100" : tone === "ok" ? "#1a7a4a" : "#202223",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: "#6d7175" }}>{label}</div>
    </div>
  );
}

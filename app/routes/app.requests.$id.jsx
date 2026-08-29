import { useState, useEffect } from "react";
import { useLoaderData, Form, Link, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendNoteEmail } from "../lib/email.server";
import { runMatchesForRequest, isMatchStalled, reapStalledMatches } from "../lib/matchRunner.server";
import { parseBudgetFromNotes } from "../lib/budget";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const findReq = () =>
    prisma.request.findFirst({
      where: { id: params.id, shop: session.shop },
      include: {
        matches: {
          where: { declined: false },
          // In-budget matches first, then over-budget (ranked below), each by score.
          orderBy: [{ overBudget: "asc" }, { score: "desc" }, { createdAt: "desc" }],
        },
        notes: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

  let req = await findReq();
  if (!req) {
    throw new Response("Request not found", { status: 404 });
  }
  // Self-heal on view: a matching pass killed mid-flight (function timeout,
  // deploy, crashed worker) can never write its own error state, so the row
  // would otherwise show "Finding matches…" forever. Reap it and re-read so the
  // page renders the actionable Retry state instead of a permanent spinner.
  if (isMatchStalled(req)) {
    await reapStalledMatches(session.shop);
    req = (await findReq()) ?? req;
  }
  return { req };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  const act = data.get("_action");

  if (act === "mark-read") {
    await prisma.match.update({
      where: { id: String(data.get("matchId")) },
      data: { read: true },
    });
  }

  if (act === "mark-all-read") {
    await prisma.match.updateMany({
      where: { requestId: params.id, shop: session.shop, read: false },
      data: { read: true },
    });
  }

  if (act === "status") {
    await prisma.request.update({
      where: { id: params.id },
      data: { status: String(data.get("status")) },
    });
  }

  if (act === "rematch") {
    // Re-run matching for a request whose initial pass failed (or that a user
    // wants refreshed). Runs synchronously — runMatchesForRequest records the
    // new matchState ("ok"/"error") itself.
    const req = await prisma.request.findFirst({
      where: { id: params.id, shop: session.shop },
    });
    if (req) {
      await prisma.request.update({
        where: { id: req.id },
        data: { matchState: "pending", matchError: null },
      });
      await runMatchesForRequest(null, req);
    }
  }

  if (act === "save-match-notes") {
    // Save refinement notes and immediately re-run matching over the combined
    // description + notes. Clearing `embedding` forces a re-embed from the new
    // combined text; a budget stated in the notes updates the request budget.
    const matchNotes = String(data.get("matchNotes") || "").trim() || null;
    const parsedBudget = parseBudgetFromNotes(matchNotes);
    const req = await prisma.request.findFirst({
      where: { id: params.id, shop: session.shop },
    });
    if (req) {
      const updated = await prisma.request.update({
        where: { id: req.id },
        data: {
          matchNotes,
          embedding: null,
          matchState: "pending",
          matchError: null,
          ...(parsedBudget != null ? { budget: parsedBudget } : {}),
        },
      });
      await runMatchesForRequest(null, updated);
    }
    return { notesSaved: true };
  }

  if (act === "decline-all") {
    await prisma.match.updateMany({
      where: { requestId: params.id, shop: session.shop, declined: false },
      data: { declined: true, read: true },
    });
  }

  if (act === "add-note") {
    const authorName = String(data.get("authorName") || "Staff").trim();
    const body = String(data.get("body") || "").trim();
    const notifyStaff = data.get("notifyStaff") === "on";

    if (body && authorName) {
      await prisma.note.create({
        data: {
          shop: session.shop,
          requestId: params.id,
          authorName,
          body,
          notifyStaff,
        },
      });

      if (notifyStaff && process.env.RESEND_API_KEY) {
        const req = await prisma.request.findUnique({ where: { id: params.id } });
        if (req) {
          sendNoteEmail({
            salespersonName: req.salespersonName,
            salespersonEmail: req.salespersonEmail,
            customerName: req.customerName,
            authorName,
            body,
            shop: session.shop,
          }).catch((err) => console.error("[email] note send failed:", err));
        }
      }
    }
  }

  return null;
};

const PRIORITY_COLOR = {
  urgent: "#d72c0d",
  normal: "#616161",
};

function scoreColor(score) {
  if (score >= 70) return { bg: "#e3f1df", color: "#1a7a4a" };
  if (score >= 40) return { bg: "#fff5e6", color: "#a85100" };
  return { bg: "#f6f6f7", color: "#616161" };
}

// Convert a Shopify product GID (gid://shopify/Product/123) into an
// App Bridge link that opens the product page in the admin top frame.
function adminProductUrl(productGid) {
  const id = String(productGid || "").split("/").pop();
  return id ? `shopify:admin/products/${id}` : "#";
}

function DetailField({ label, value }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "#6d7175",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#212326" }}>{value}</div>
    </div>
  );
}

function MatchTile({ m, budget }) {
  const { bg, color } = scoreColor(m.score);
  const productHref = adminProductUrl(m.productId);
  const overAmount =
    m.overBudget && budget != null && m.productPrice != null
      ? m.productPrice - budget
      : 0;
  return (
    <div
      style={{
        border: `1px solid ${m.read ? "#e1e3e5" : "#005bd3"}`,
        borderRadius: 8,
        padding: 12,
        background: m.read ? "#fff" : "#f3f7fe",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <a
        href={productHref}
        target="_top"
        style={{
          textDecoration: "none",
          color: "inherit",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {m.productImage ? (
          <img
            src={m.productImage}
            alt={m.productTitle}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              objectFit: "cover",
              borderRadius: 4,
              border: "1px solid #e1e3e5",
              cursor: "pointer",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              background: "#f6f6f7",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#c9cccf",
              fontSize: 12,
            }}
          >
            No image
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              lineHeight: 1.3,
              flex: 1,
              color: "#005bd3",
            }}
          >
            {m.productTitle}
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 12,
              background: bg,
              color,
              flexShrink: 0,
            }}
          >
            {m.score}%
          </span>
        </div>

        {m.productPrice != null && (
          <div style={{ fontSize: 15, fontWeight: 700, color: "#212326" }}>
            ${m.productPrice.toLocaleString()}
          </div>
        )}
      </a>

      {m.overBudget && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#a85100",
            background: "#fff5e6",
            border: "1px solid #ffd79d",
            borderRadius: 6,
            padding: "4px 8px",
          }}
        >
          Slightly over budget{overAmount > 0 ? ` · $${overAmount.toLocaleString()} over` : ""}
        </div>
      )}

      {m.matchedKeywords.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {m.matchedKeywords.map((kw) => (
            <span
              key={kw}
              style={{
                fontSize: 10,
                padding: "1px 8px",
                borderRadius: 10,
                background: "#e3f1df",
                color: "#1a7a4a",
                fontWeight: 500,
              }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {!m.read && (
        <Form method="post">
          <input type="hidden" name="_action" value="mark-read" />
          <input type="hidden" name="matchId" value={m.id} />
          <button
            type="submit"
            style={{
              width: "100%",
              background: "none",
              border: "1px solid #c9cccf",
              borderRadius: 4,
              padding: "4px 8px",
              fontSize: 12,
              cursor: "pointer",
              color: "#616161",
            }}
          >
            Mark read
          </button>
        </Form>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle = { fontSize: 12, fontWeight: 600, marginBottom: 4, display: "block" };

function NotesSection({ notes, salespersonName }) {
  const fetcher = useFetcher();
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const submitting = fetcher.state !== "idle";

  // Clear body after successful note submission
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data !== undefined) {
      setBody("");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div>
      {notes.length === 0 ? (
        <p style={{ color: "#6d7175", margin: "0 0 24px", textAlign: "center", padding: "20px 0" }}>
          No notes yet. Add one below.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                background: "#f6f6f7",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 6,
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{n.authorName}</span>
                <span style={{ fontSize: 11, color: "#6d7175", flexShrink: 0 }}>
                  {new Date(n.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div style={{ fontSize: 14, color: "#212326", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {n.body}
              </div>
            </div>
          ))}
        </div>
      )}

      <fetcher.Form method="post">
        <input type="hidden" name="_action" value="add-note" />
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Your name</label>
          <input
            name="authorName"
            required
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            style={inputStyle}
            placeholder="Jane Doe"
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Note</label>
          <textarea
            name="body"
            required
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="Add a note or update about this request…"
          />
        </div>
        <div
          style={{
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <input type="checkbox" name="notifyStaff" id="notify-check" />
          <label htmlFor="notify-check" style={{ fontSize: 13, cursor: "pointer", color: "#414547" }}>
            Email <strong>{salespersonName}</strong> about this note
          </label>
        </div>
        <button
          type="submit"
          disabled={submitting}
          style={{
            background: "#008060",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Saving…" : "Add Note"}
        </button>
      </fetcher.Form>
    </div>
  );
}

/**
 * Refinement notes that live-refine matching. Saving re-runs matching over the
 * combined description + notes; the loader revalidates so the matched-products
 * list below refreshes automatically. Shows an "updating…" state while it runs.
 */
function RefineMatching({ req }) {
  const fetcher = useFetcher();
  const [notes, setNotes] = useState(req.matchNotes || "");
  const busy = fetcher.state !== "idle";
  // Keep the field in sync if the server-updated notes differ (e.g. after save).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.notesSaved) {
      // no-op: local text already reflects what was typed
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <s-section heading="Refine matching">
      <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 12px" }}>
        Add details to narrow, broaden, or nudge matches — no new request needed.
        Saving re-runs matching over the description <strong>plus</strong> these notes.
        Examples: &ldquo;must be pear-shaped&rdquo;, &ldquo;any yellow tone is fine&rdquo;,
        &ldquo;budget up to $8,000&rdquo;, &ldquo;prefers vintage&rdquo;.
      </p>
      <fetcher.Form method="post">
        <input type="hidden" name="_action" value="save-match-notes" />
        <textarea
          name="matchNotes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          style={{ ...inputStyle, resize: "vertical", opacity: busy ? 0.7 : 1 }}
          placeholder="e.g. must be pear-shaped; any yellow tone is fine; budget up to $8,000; prefers vintage"
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: "#008060",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Updating matches…" : "Save & re-match"}
          </button>
          {busy && (
            <span style={{ fontSize: 13, color: "#005bd3" }}>
              ⏳ Re-evaluating inventory against the refined request…
            </span>
          )}
        </div>
      </fetcher.Form>
    </s-section>
  );
}

export default function RequestDetailPage() {
  const { req } = useLoaderData();
  const unreadCount = req.matches.filter((m) => !m.read).length;
  const totalBudget = req.budget;

  return (
    <s-page heading={req.customerName} backAction={{ content: "Requests", url: "/app" }}>
      <s-section heading="Request details">
        {/* Customer-submitted requests were round-robin assigned; the assigned
            salesperson is expected to phone the customer, who has been told only
            that someone will be in touch. They have NOT seen any matches. */}
        {req.source === "customer" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              background: "#fff5ea",
              border: "1px solid #ffd79d",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            <strong style={{ color: "#a85100" }}>Submitted online</strong>
            <span style={{ color: "#4a4a4a" }}>
              Assigned to {req.salespersonName} by rotation — call the customer
              {req.customerPhone ? " on " : "."}
              {req.customerPhone && (
                <a href={`tel:${req.customerPhone.replace(/[^\d+]/g, "")}`} style={{ fontWeight: 600 }}>
                  {req.customerPhone}
                </a>
              )}
            </span>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 20,
            marginBottom: req.description || req.keywords.length > 0 ? 20 : 0,
          }}
        >
          <DetailField label="Customer" value={req.customerName} />
          <DetailField label="Customer Email" value={req.customerEmail || "—"} />
          <DetailField label="Customer Phone" value={req.customerPhone || "—"} />
          <DetailField label="Source" value={req.source === "customer" ? "Customer (storefront)" : "Staff"} />
          <DetailField label="Salesperson" value={req.salespersonName} />
          <DetailField label="Salesperson Email" value={req.salespersonEmail} />
          <DetailField
            label="Budget"
            value={totalBudget != null ? `$${totalBudget.toLocaleString()}` : "—"}
          />
          <DetailField
            label="Priority"
            value={
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: PRIORITY_COLOR[req.priority] || "#616161",
                }}
              >
                {req.priority}
              </span>
            }
          />
          <DetailField
            label="Status"
            value={
              <span style={{ textTransform: "capitalize" }}>{req.status}</span>
            }
          />
          <DetailField
            label="Created"
            value={new Date(req.createdAt).toLocaleDateString()}
          />
        </div>

        {req.description && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "#6d7175",
                marginBottom: 6,
              }}
            >
              Description
            </div>
            <div style={{ fontSize: 14, color: "#212326" }}>{req.description}</div>
          </div>
        )}

        {req.keywords.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "#6d7175",
                marginBottom: 6,
              }}
            >
              Keywords
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {req.keywords.map((kw) => (
                <span
                  key={kw}
                  style={{
                    fontSize: 12,
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: "#f6f6f7",
                    color: "#414547",
                    fontWeight: 500,
                  }}
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {req.status !== "fulfilled" && (
            <Form method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="status" value="fulfilled" />
              <button
                type="submit"
                style={{
                  background: "#008060",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Mark fulfilled
              </button>
            </Form>
          )}
          {req.status !== "archived" && (
            <Form method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="status" value="archived" />
              <button
                type="submit"
                style={{
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#414547",
                }}
              >
                Archive
              </button>
            </Form>
          )}
          {req.status !== "active" && (
            <Form method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="status" value="active" />
              <button
                type="submit"
                style={{
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#005bd3",
                }}
              >
                Reopen
              </button>
            </Form>
          )}
        </div>
      </s-section>

      <RefineMatching req={req} />

      <s-section
        heading={`Matched products (${req.matches.length}${
          unreadCount > 0 ? `, ${unreadCount} new` : ""
        })`}
      >
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {unreadCount > 0 && (
            <Form method="post">
              <input type="hidden" name="_action" value="mark-all-read" />
              <button
                type="submit"
                style={{
                  background: "none",
                  border: "1px solid #c9cccf",
                  borderRadius: 4,
                  padding: "4px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#616161",
                }}
              >
                Mark all read ({unreadCount})
              </button>
            </Form>
          )}
          {req.matches.length > 0 && (
            <Form method="post">
              <input type="hidden" name="_action" value="decline-all" />
              <button
                type="submit"
                style={{
                  background: "none",
                  border: "1px solid #d72c0d",
                  borderRadius: 4,
                  padding: "4px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#d72c0d",
                }}
                onClick={(e) => {
                  if (!confirm("Decline all current matches? These products won't be suggested for this request again (but can still match other requests).")) {
                    e.preventDefault();
                  }
                }}
              >
                Decline all matches ({req.matches.length})
              </button>
            </Form>
          )}
        </div>

        {req.matches.length === 0 ? (
          req.matchState === "error" ? (
            /* Matching failed (transient AI/service error) — offer a retry so a
               genuine result isn't mistaken for "nothing in stock". */
            <div style={{ textAlign: "center", padding: "40px 20px", margin: 0 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              <p style={{ color: "#b12b18", fontWeight: 600, margin: "0 0 4px" }}>
                Couldn&apos;t finish finding matches
              </p>
              <p style={{ color: "#6d7175", margin: "0 0 16px", fontSize: 13 }}>
                A temporary error interrupted matching for this request — this is
                <strong> not</strong> a &quot;nothing in stock&quot; result. Retry to run it again.
              </p>
              <Form method="post" style={{ display: "inline-block" }}>
                <input type="hidden" name="_action" value="rematch" />
                <button
                  type="submit"
                  style={{
                    background: "#008060",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 20px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Retry matching
                </button>
              </Form>
            </div>
          ) : req.matchState === "pending" ? (
            /* Background match still running (POS create returns instantly). */
            <div style={{ textAlign: "center", padding: "40px 20px", margin: 0 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
              <p style={{ color: "#202223", fontWeight: 600, margin: "0 0 4px" }}>
                Finding matches…
              </p>
              <p style={{ color: "#6d7175", margin: "0 0 16px", fontSize: 13 }}>
                Matching is running in the background. Refresh in a few seconds — or
                run it now.
              </p>
              <Form method="post" style={{ display: "inline-block" }}>
                <input type="hidden" name="_action" value="rematch" />
                <button
                  type="submit"
                  style={{
                    background: "#fff",
                    border: "1px solid #c9cccf",
                    borderRadius: 6,
                    padding: "8px 20px",
                    fontSize: 13,
                    cursor: "pointer",
                    color: "#414547",
                  }}
                >
                  Run now
                </button>
              </Form>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", margin: 0 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>👀</div>
              <p style={{ color: "#202223", fontWeight: 600, margin: "0 0 4px" }}>
                Not in stock yet — watching this request
              </p>
              <p style={{ color: "#6d7175", margin: "0 0 16px", fontSize: 13 }}>
                Nothing currently in inventory matches all of this request&apos;s
                requirements. This request stays active, and you&apos;ll be alerted
                automatically if matching inventory arrives.
              </p>
              <Form method="post" style={{ display: "inline-block" }}>
                <input type="hidden" name="_action" value="rematch" />
                <button
                  type="submit"
                  style={{
                    background: "#fff",
                    border: "1px solid #c9cccf",
                    borderRadius: 6,
                    padding: "6px 16px",
                    fontSize: 12,
                    cursor: "pointer",
                    color: "#616161",
                  }}
                >
                  Re-check inventory
                </button>
              </Form>
            </div>
          )
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {req.matches.map((m) => (
              <MatchTile key={m.id} m={m} budget={req.budget} />
            ))}
          </div>
        )}
      </s-section>

      <s-section heading={`Notes (${req.notes.length})`}>
        <NotesSection notes={req.notes} salespersonName={req.salespersonName} />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return (
    <s-page heading="Request not found">
      <s-section>
        <p style={{ margin: 0 }}>
          That request doesn&apos;t exist or doesn&apos;t belong to your shop.{" "}
          <Link to="/app" style={{ color: "#005bd3" }}>
            Back to Requests
          </Link>
        </p>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

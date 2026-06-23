import { useState, useEffect } from "react";
import { useLoaderData, Form, useNavigation, Link, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runMatchesForRequest } from "../lib/matchRunner.server";
import { classifyKeywordImportance } from "../lib/anthropic.server";
import { isMustHaveTag } from "../lib/tagTiers";
import { deriveFacets } from "../lib/facets";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [requests, salespeople] = await Promise.all([
    prisma.request.findMany({
      where: { shop: session.shop, status: { in: ["active", "pending"] } },
      include: { _count: { select: { matches: { where: { declined: false } } } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    }),
    prisma.salesperson.findMany({
      where: { shop: session.shop, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  return { requests, salespeople, hasAnthropicKey };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const data = await request.formData();
  const act = data.get("_action");

  if (act === "create") {
    const keywords = String(data.get("keywords") || "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const budgetStr = String(data.get("budget") || "").trim();
    const budget = budgetStr ? parseFloat(budgetStr) : null;
    // Derive typed facets from the canonical tags so we can index by item type
    // and inspect the structured query later.
    const facets = deriveFacets(keywords);
    const req = await prisma.request.create({
      data: {
        shop,
        customerName: String(data.get("customerName")),
        customerEmail: String(data.get("customerEmail") || "") || null,
        customerId: String(data.get("customerId") || "") || null,
        salespersonName: String(data.get("salespersonName")),
        salespersonEmail: String(data.get("salespersonEmail")),
        description: String(data.get("description") || "") || null,
        keywords,
        facets,
        itemType: facets.item_type,
        budget: Number.isFinite(budget) ? budget : null,
        priority: String(data.get("priority") || "normal"),
        pinned: data.get("pinned") === "on",
      },
    });
    // The curated tag-tier map decides which keywords are defining. Only when it
    // covers none of them (e.g. all were manual free-text not in the catalog) do
    // we ask the AI to classify importance. Non-fatal — the matcher falls back
    // to its catalog-rarity heuristic otherwise.
    let aiRequired = [];
    if (!keywords.some(isMustHaveTag) && process.env.ANTHROPIC_API_KEY) {
      aiRequired = await classifyKeywordImportance({
        keywords,
        description: req.description || "",
      }).catch(() => []);
    }
    await runMatchesForRequest(admin, req, aiRequired);
    return { created: true };
  }

  if (act === "delete") {
    await prisma.request.delete({ where: { id: String(data.get("id")) } });
  }

  if (act === "pin") {
    const r = await prisma.request.findUnique({ where: { id: String(data.get("id")) } });
    await prisma.request.update({ where: { id: r.id }, data: { pinned: !r.pinned } });
  }

  if (act === "status") {
    await prisma.request.update({
      where: { id: String(data.get("id")) },
      data: { status: String(data.get("status")) },
    });
  }

  return null;
};

const PRIORITY_COLOR = {
  urgent: "#d72c0d",
  normal: "#616161",
};

function RequestRow({ r }) {
  return (
    <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ fontWeight: 600 }}>
          {r.pinned && <span title="Pinned" style={{ marginRight: 4 }}>📌</span>}
          <Link
            to={`/app/requests/${r.id}`}
            style={{ color: "#005bd3", textDecoration: "none" }}
          >
            {r.customerName}
          </Link>
        </div>
        {r.customerEmail && (
          <div style={{ fontSize: 12, color: "#6d7175" }}>{r.customerEmail}</div>
        )}
      </td>
      <td style={{ padding: "12px 16px", color: "#6d7175", fontSize: 13 }}>
        {r.salespersonName}
      </td>
      <td style={{ padding: "12px 16px", fontSize: 13, color: "#212326" }}>
        {r.budget != null ? `$${r.budget.toLocaleString()}` : <span style={{ color: "#c9cccf" }}>—</span>}
      </td>
      <td style={{ padding: "12px 16px" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: PRIORITY_COLOR[r.priority] || "#616161",
          }}
        >
          {r.priority}
        </span>
      </td>
      <td style={{ padding: "12px 16px", fontSize: 12, color: "#6d7175", maxWidth: 200 }}>
        {r.keywords.slice(0, 4).join(", ")}
        {r.keywords.length > 4 && " …"}
      </td>
      <td style={{ padding: "12px 16px", textAlign: "center" }}>
        {r._count.matches > 0 ? (
          <Link
            to={`/app/requests/${r.id}`}
            style={{
              background: "#e3f1df",
              color: "#1a7a4a",
              fontWeight: 700,
              fontSize: 12,
              padding: "2px 10px",
              borderRadius: 12,
              textDecoration: "none",
            }}
          >
            {r._count.matches}
          </Link>
        ) : (
          <span style={{ color: "#c9cccf" }}>—</span>
        )}
      </td>
      <td style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Form method="post">
            <input type="hidden" name="_action" value="pin" />
            <input type="hidden" name="id" value={r.id} />
            <button type="submit" style={actionBtn}>
              {r.pinned ? "Unpin" : "Pin"}
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="status" />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value="fulfilled" />
            <button type="submit" style={{ ...actionBtn, color: "#1a7a4a" }}>
              Fulfill
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="status" />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value="archived" />
            <button type="submit" style={actionBtn}>
              Archive
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="delete" />
            <input type="hidden" name="id" value={r.id} />
            <button
              type="submit"
              style={{ ...actionBtn, color: "#d72c0d" }}
              onClick={(e) => {
                if (!confirm("Delete this request and all its matches?")) e.preventDefault();
              }}
            >
              Delete
            </button>
          </Form>
        </div>
      </td>
    </tr>
  );
}

const actionBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  color: "#616161",
  padding: "2px 4px",
  borderRadius: 4,
};

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle = { fontSize: 12, fontWeight: 600, marginBottom: 4, display: "block" };

/**
 * Customer search with Shopify customer autocomplete (name, email, or phone).
 * Selecting a result fills name/email/phone hidden fields and stores the GID.
 * Clearing the selection goes back to manual entry.
 */
function CustomerSection({ inputStyle, labelStyle }) {
  const fetcher = useFetcher();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Debounced search — fires 300 ms after the user stops typing
  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(() => {
      fetcher.load(`/api/customers/search?q=${encodeURIComponent(query.trim())}`);
      setShowDropdown(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, selected]);

  const customers = fetcher.data?.customers || [];
  const searchError = fetcher.data?.error || null;
  const searching = fetcher.state !== "idle";

  const handleSelect = (c) => {
    setSelected(c);
    setShowDropdown(false);
    setQuery("");
  };

  const handleClear = () => {
    setSelected(null);
    setQuery("");
  };

  return (
    <div style={{ gridColumn: "span 2" }}>
      <label style={labelStyle}>Customer</label>

      {/* Hidden inputs always submitted with the form */}
      <input type="hidden" name="customerId" value={selected?.id || ""} />
      {selected && <input type="hidden" name="customerName" value={selected.name} />}
      {selected && <input type="hidden" name="customerEmail" value={selected.email || ""} />}

      {selected ? (
        /* ── Selected customer card ── */
        <div
          style={{
            padding: "10px 14px",
            border: "1px solid #005bd3",
            borderRadius: 6,
            background: "#f3f7fe",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{selected.name}</div>
            <div style={{ fontSize: 12, color: "#414547" }}>
              {[selected.email, selected.phone].filter(Boolean).join(" · ")}
            </div>
            {(selected.city || selected.province) && (
              <div style={{ fontSize: 12, color: "#6d7175" }}>
                {[selected.city, selected.province].filter(Boolean).join(", ")}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleClear}
            title="Remove — search for a different customer"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: "#6d7175",
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ) : (
        /* ── Search box + dropdown ── */
        <div style={{ position: "relative" }}>
          <div style={{ position: "relative" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => (customers.length > 0 || !!searchError) && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 160)}
              placeholder="Search by name, email, or phone number…"
              style={{ ...inputStyle, paddingRight: 34 }}
            />
            {searching && (
              <span
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 12,
                  color: "#6d7175",
                }}
              >
                …
              </span>
            )}
          </div>

          {showDropdown && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1px solid #c9cccf",
                borderRadius: 6,
                boxShadow: "0 4px 14px rgba(0,0,0,.14)",
                zIndex: 20,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {searchError ? (
                <div style={{ padding: "12px 14px", fontSize: 12, color: "#d72c0d" }}>
                  ⚠ Customer search not available — enable Protected Customer Data in your Partners Dashboard.
                </div>
              ) : customers.length === 0 ? (
                <div style={{ padding: "12px 14px", fontSize: 13, color: "#6d7175" }}>
                  No customers found
                </div>
              ) : (
                customers.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={() => handleSelect(c)}
                    style={{
                      display: "flex",
                      width: "100%",
                      padding: "10px 14px",
                      background: "none",
                      border: "none",
                      borderBottom: i < customers.length - 1 ? "1px solid #f1f2f3" : "none",
                      cursor: "pointer",
                      textAlign: "left",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    {/* Avatar circle with initials */}
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: "50%",
                        background: "#e3f1df",
                        color: "#1a7a4a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 13,
                        flexShrink: 0,
                      }}
                    >
                      {(c.firstName?.[0] || c.name?.[0] || "?").toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#212326" }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 12, color: "#6d7175", marginTop: 1 }}>
                        {[c.email, c.phone].filter(Boolean).join(" · ")}
                      </div>
                      {(c.city || c.province) && (
                        <div style={{ fontSize: 11, color: "#9da1a5" }}>
                          {[c.city, c.province].filter(Boolean).join(", ")}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual name/email — only shown when no Shopify customer is linked */}
      {!selected && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label style={labelStyle}>Customer Name *</label>
            <input name="customerName" required style={inputStyle} placeholder="Sarah Johnson" />
          </div>
          <div>
            <label style={labelStyle}>Customer Email</label>
            <input name="customerEmail" type="email" style={inputStyle} placeholder="customer@email.com" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Chip/pill tag input. Press Enter or comma to add; Backspace removes last. */
function TagInput({ tags, onChange }) {
  const [inputVal, setInputVal] = useState("");

  const commit = (raw) => {
    const cleaned = raw.trim().toLowerCase().replace(/,/g, "");
    if (cleaned && !tags.includes(cleaned)) onChange([...tags, cleaned]);
    setInputVal("");
  };

  const remove = (tag) => onChange(tags.filter((t) => t !== tag));

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(inputVal);
    } else if (e.key === "Backspace" && inputVal === "" && tags.length > 0) {
      remove(tags[tags.length - 1]);
    }
  };

  const handleBlur = () => {
    if (inputVal.trim()) commit(inputVal);
  };

  return (
    <div
      onClick={(e) => e.currentTarget.querySelector("input")?.focus()}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "6px 10px",
        border: "1px solid #c9cccf",
        borderRadius: 6,
        minHeight: 40,
        alignItems: "center",
        cursor: "text",
        background: "#fff",
      }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "#f1f2f3",
            borderRadius: 20,
            padding: "3px 10px 3px 12px",
            fontSize: 13,
            color: "#212326",
          }}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); remove(tag); }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
              color: "#6d7175",
              fontSize: 15,
              display: "flex",
              alignItems: "center",
            }}
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={tags.length === 0 ? "Type a keyword and press Enter…" : ""}
        style={{
          border: "none",
          outline: "none",
          fontSize: 14,
          flex: 1,
          minWidth: 120,
          background: "transparent",
          padding: "2px 0",
        }}
      />
    </div>
  );
}

export default function RequestsPage() {
  const { requests, salespeople, hasAnthropicKey } = useLoaderData();
  const nav = useNavigation();
  const suggestFetcher = useFetcher();
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState([]);
  const [salespersonId, setSalespersonId] = useState("");
  const [useManualSp, setUseManualSp] = useState(salespeople.length === 0);
  const submitting = nav.state === "submitting";
  const suggesting = suggestFetcher.state !== "idle";

  // Merge AI suggestions into existing tags (no dupes).
  useEffect(() => {
    if (suggestFetcher.data?.keywords?.length) {
      setTags((prev) => {
        const next = [...prev];
        for (const kw of suggestFetcher.data.keywords) {
          if (!next.includes(kw)) next.push(kw);
        }
        return next;
      });
    }
  }, [suggestFetcher.data]);

  const selectedSp = salespeople.find((s) => s.id === salespersonId);

  const handleSuggest = () => {
    if (!description.trim()) return;
    const fd = new FormData();
    fd.append("description", description);
    suggestFetcher.submit(fd, { method: "post", action: "/api/suggest-keywords" });
  };

  const resetForm = () => {
    setDescription("");
    setTags([]);
    setSalespersonId("");
    setUseManualSp(salespeople.length === 0);
  };

  return (
    <s-page heading="Customer Requests">
      <s-button slot="primary-action" onClick={() => setShowForm((s) => !s)}>
        {showForm ? "Cancel" : "+ New Request"}
      </s-button>

      {showForm && (
        <s-section heading="New Request">
          <Form
            method="post"
            onSubmit={() => {
              if (!submitting) {
                resetForm();
                setShowForm(false);
              }
            }}
          >
            <input type="hidden" name="_action" value="create" />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <CustomerSection inputStyle={inputStyle} labelStyle={labelStyle} />

              {salespeople.length > 0 && !useManualSp ? (
                <>
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={labelStyle}>
                      Salesperson *{" "}
                      <button
                        type="button"
                        onClick={() => setUseManualSp(true)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#005bd3",
                          fontSize: 11,
                          cursor: "pointer",
                          padding: 0,
                          marginLeft: 6,
                        }}
                      >
                        (enter manually)
                      </button>
                    </label>
                    <select
                      value={salespersonId}
                      onChange={(e) => setSalespersonId(e.target.value)}
                      required
                      style={inputStyle}
                    >
                      <option value="">Choose a salesperson…</option>
                      {salespeople.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name} ({sp.email})
                        </option>
                      ))}
                    </select>
                    <input type="hidden" name="salespersonName" value={selectedSp?.name || ""} />
                    <input type="hidden" name="salespersonEmail" value={selectedSp?.email || ""} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={labelStyle}>
                      Salesperson Name *
                      {salespeople.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setUseManualSp(false)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#005bd3",
                            fontSize: 11,
                            cursor: "pointer",
                            padding: 0,
                            marginLeft: 6,
                          }}
                        >
                          (use saved list)
                        </button>
                      )}
                    </label>
                    <input name="salespersonName" required style={inputStyle} placeholder="Jane Doe" />
                  </div>
                  <div>
                    <label style={labelStyle}>Salesperson Email *</label>
                    <input name="salespersonEmail" type="email" required style={inputStyle} placeholder="staff@store.com" />
                  </div>
                </>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Description</label>
                {hasAnthropicKey && (
                  <button
                    type="button"
                    onClick={handleSuggest}
                    disabled={suggesting || !description.trim()}
                    style={{
                      background: "none",
                      border: "1px solid #c9cccf",
                      borderRadius: 4,
                      padding: "4px 10px",
                      fontSize: 12,
                      cursor: suggesting || !description.trim() ? "not-allowed" : "pointer",
                      color: "#414547",
                      opacity: suggesting || !description.trim() ? 0.6 : 1,
                    }}
                  >
                    {suggesting ? "Suggesting…" : "✨ Suggest keywords"}
                  </button>
                )}
              </div>
              <textarea
                name="description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ ...inputStyle, resize: "vertical" }}
                placeholder="What is the customer looking for? (e.g. 'art deco engagement ring with sapphire')"
              />
              {suggestFetcher.data?.error && (
                <div style={{ fontSize: 12, color: "#d72c0d", marginTop: 4 }}>
                  {suggestFetcher.data.error}
                </div>
              )}
            </div>

            {/* Hidden input carries tags as comma-separated string to the action */}
            <input type="hidden" name="keywords" value={tags.join(", ")} />

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Keywords</label>
              <TagInput tags={tags} onChange={setTags} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 16, marginBottom: 20 }}>
              <div>
                <label style={labelStyle}>Budget ($)</label>
                <input
                  name="budget"
                  type="number"
                  min="0"
                  step="0.01"
                  style={inputStyle}
                  placeholder="2500"
                />
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select name="priority" defaultValue="normal" style={inputStyle}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div style={{ paddingTop: 20, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" name="pinned" id="pinned-check" />
                <label htmlFor="pinned-check" style={{ fontSize: 13, cursor: "pointer" }}>
                  Pin
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                background: "#008060",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "10px 24px",
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Saving…" : "Save Request"}
            </button>
          </Form>
        </s-section>
      )}

      <s-section heading={`Active Requests (${requests.length})`}>
        {requests.length === 0 ? (
          <p style={{ color: "#6d7175", textAlign: "center", padding: "40px 0", margin: 0 }}>
            No active requests. Click &quot;+ New Request&quot; to get started.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f6f6f7", textAlign: "left" }}>
                  {["Customer", "Salesperson", "Budget", "Priority", "Keywords", "Matches", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 16px",
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          color: "#6d7175",
                          textAlign: h === "Matches" ? "center" : "left",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <RequestRow key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Modal />, document.body);
};

const EMPTY_FORM = {
  budget: "",
  description: "",
};

// Matches shown per page. A broad request can legitimately return 80+; rendering
// them all is unusable on an iPad with a customer waiting.
const MATCH_PAGE = 10;

// What the request is ACTUALLY matched on: description + refinement notes, which
// is what gets embedded server-side (see buildRequestText). Kept in sync with
// app/lib/requestSummary.js — deliberately duplicated rather than imported,
// because the extension is bundled as its own package and must not reach into
// the app's source tree. Same logic lives there with unit tests.
function matchingSummary(request) {
  const description = String(request?.description || "").trim();
  const notes = String(request?.matchNotes || "").trim();
  if (!description) return notes;
  if (!notes) return description;
  return `${description} — ${notes}`;
}

async function authHeaders(base = {}) {
  const headers = { ...base };
  try {
    const token = await shopify.session.getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // getSessionToken rejects if the user lacks app permissions — the platform
    // still auto-attaches auth for same-domain relative URLs.
  }
  return headers;
}

const money = (n) => (n == null ? null : `$${Number(n).toLocaleString()}`);

function confInfo(m) {
  const c = (m.confidence || "").toLowerCase();
  if (c === "high" || (!c && m.score >= 70)) {
    return { tone: "success", label: "High confidence" };
  }
  if (c === "medium" || (!c && m.score >= 40)) {
    return { tone: "warning", label: "Medium confidence" };
  }
  return {
    tone: "neutral",
    label: c ? `${c[0].toUpperCase()}${c.slice(1)} confidence` : "Low confidence",
  };
}

function Modal() {
  // Identity bootstrap: "loading" | "ready" | "error"
  const [boot, setBoot] = useState({ status: "loading" });
  // View: "home" | "create" | "saved" | "detail"
  const [view, setView] = useState("home");

  // Requests list (role-filtered) + the request currently open in detail.
  const [reqState, setReqState] = useState({ status: "idle", requests: [] });
  const [detailReq, setDetailReq] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [pickedEmail, setPickedEmail] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Request/match actions (fulfill, decline).
  const [actionBusy, setActionBusy] = useState(null); // e.g. "req:<id>" | "match:<id>"
  const [actionError, setActionError] = useState("");

  // Refinement notes + editable description (live-refine matching).
  const [notesDraft, setNotesDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [refining, setRefining] = useState(false);
  // Confirmation after a save, so a slow re-match doesn't read as "nothing
  // happened" and invite a second tap.
  const [saveNotice, setSaveNotice] = useState("");
  // How many matches are rendered (paged — see MATCH_PAGE).
  const [matchLimit, setMatchLimit] = useState(MATCH_PAGE);

  // Customer picker (search Shopify customers by name/email/phone).
  const [customer, setCustomer] = useState(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [custSearching, setCustSearching] = useState(false);
  const [custError, setCustError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = shopify.session.currentSession;
        const staffMemberId = session?.staffMemberId;
        const userId = session?.userId;
        const res = await fetch(
          `/api/pos/me?staffMemberId=${encodeURIComponent(
            staffMemberId ?? "",
          )}&userId=${encodeURIComponent(userId ?? "")}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setBoot({ status: "ready", data, staffMemberId, userId });
          if (data.linked) setPickedEmail(data.salesperson.email);
        }
      } catch (err) {
        if (!cancelled) {
          setBoot({ status: "error", message: String(err?.message || err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadRequests() {
    if (boot.status !== "ready" || !boot.data?.linked) return;
    setReqState((s) => ({ ...s, status: "loading" }));
    try {
      const res = await fetch(
        `/api/pos/requests?staffMemberId=${encodeURIComponent(
          boot.staffMemberId ?? "",
        )}`,
        { headers: await authHeaders() },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setReqState({
        status: "ready",
        requests: data.requests || [],
        role: data.role,
      });
    } catch (err) {
      setReqState({
        status: "error",
        requests: [],
        error: String(err?.message || err),
      });
    }
  }

  // Load the request list once identity is resolved.
  useEffect(() => {
    if (boot.status === "ready" && boot.data?.linked) loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.status]);

  // Debounced customer search — fires 300ms after typing stops.
  useEffect(() => {
    if (customer || custQuery.trim().length < 2) {
      setCustResults([]);
      setCustError("");
      return;
    }
    let cancelled = false;
    setCustSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pos/customers/search?q=${encodeURIComponent(custQuery.trim())}`,
          { headers: await authHeaders() },
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setCustResults(data.customers || []);
          setCustError(data.error || "");
        }
      } catch (err) {
        if (!cancelled) {
          setCustResults([]);
          setCustError(String(err?.message || err));
        }
      } finally {
        if (!cancelled) setCustSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [custQuery, customer]);

  const updateForm = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const clearCustomer = () => {
    setCustomer(null);
    setCustQuery("");
    setCustResults([]);
    setCustError("");
  };

  const selectCustomer = (c) => {
    setCustomer(c);
    setCustQuery("");
    setCustResults([]);
  };

  const startNew = () => {
    setForm(EMPTY_FORM);
    setSaveError("");
    setAssigning(false);
    clearCustomer();
    if (boot.status === "ready" && boot.data.linked) {
      setPickedEmail(boot.data.salesperson.email);
    }
    setView("create");
  };

  const openRequest = (r) => {
    setActionError("");
    setSaveNotice("");
    setDetailReq(r);
    setNotesDraft(r.matchNotes || "");
    setDescDraft(r.description || "");
    setMatchLimit(MATCH_PAGE); // fresh request → back to the first page
    setView("detail");
  };

  // Open the edit screen with the current wording loaded.
  const startEdit = (r) => {
    setActionError("");
    setSaveNotice("");
    setNotesDraft(r.matchNotes || "");
    setDescDraft(r.description || "");
    setView("edit");
  };

  // Save the request (description and/or notes) and re-run matching. Shows an
  // explicit confirmation with the new match count, because re-matching takes
  // ~a minute and silence reads as failure.
  async function saveRequest(r) {
    const description = descDraft.trim();
    if (!description) {
      setActionError("Tell us what they're looking for — this can't be empty.");
      return;
    }
    setRefining(true);
    setActionError("");
    setSaveNotice("");
    try {
      const res = await fetch(`/api/pos/requests/${r.id}`, {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          _action: "save-request",
          description,
          matchNotes: notesDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      if (data.request) {
        setDetailReq(data.request);
        setNotesDraft(data.request.matchNotes || "");
        setDescDraft(data.request.description || "");
        const n = data.request.matchCount || 0;
        setSaveNotice(
          n > 0
            ? `Saved — ${n} match${n === 1 ? "" : "es"} found.`
            : "Saved — nothing in stock yet. We'll keep watching.",
        );
      }
      setMatchLimit(MATCH_PAGE); // new result set → back to the first page
      setView("detail");
      loadRequests();
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setRefining(false);
    }
  }

  // Mark a request fulfilled — same status change the admin app makes. On success
  // the request leaves the active list, so return home and refresh.
  async function fulfillRequest(r) {
    setActionBusy(`req:${r.id}`);
    setActionError("");
    try {
      const res = await fetch(`/api/pos/requests/${r.id}`, {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: "fulfilled" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      await loadRequests();
      setView("home");
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  // Decline a single match — same fields the admin app sets (declined + read).
  async function declineMatch(m) {
    setActionBusy(`match:${m.id}`);
    setActionError("");
    try {
      const res = await fetch(`/api/pos/matches/${m.id}`, {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ _action: "decline" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      // Remove it locally and keep the list in sync.
      setDetailReq((r) =>
        r
          ? {
              ...r,
              matches: r.matches.filter((x) => x.id !== m.id),
              matchCount: Math.max(0, (r.matchCount || 0) - 1),
            }
          : r,
      );
      loadRequests();
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  // Open a matched product's listing on the native POS product-details screen.
  //
  // `navigation` is a POS RUNTIME GLOBAL, not an import and not `shopify.*` —
  // this is exactly what the Navigation API docs show:
  //   navigation.navigate('shopify:point-of-sale/products/123')
  // Do NOT "fix" it by reaching for shopify.navigation — that property doesn't
  // exist and the call throws, which is what broke this button once already.
  // (The global is declared for eslint in .eslintrc.cjs.)
  //
  // Navigation is only available in modal targets, and POS shows a permissions
  // dialog instead of navigating if the staff member can't view the screen.
  const openProduct = (productGid) => {
    const numId = String(productGid || "").split("/").pop();
    if (!numId) return;
    try {
      const result = navigation.navigate(`shopify:point-of-sale/products/${numId}`);
      // navigate() returns a promise; a rejection would otherwise be unhandled
      // and silent.
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          setActionError("Couldn't open that product on this device.");
          console.error("[pos] openProduct navigate rejected:", err?.message || err);
        });
      }
    } catch (err) {
      setActionError("Couldn't open that product on this device.");
      console.error("[pos] openProduct failed:", err?.message || err);
    }
  };

  async function submit() {
    const me = boot.data.salesperson;
    const isAdmin = me.role === "admin";
    const roster = boot.data.salespeople || [];

    let salesperson = { name: me.name, email: me.email };
    if (isAdmin && pickedEmail && pickedEmail !== me.email) {
      const found = roster.find((s) => s.email === pickedEmail);
      if (found) salesperson = { name: found.name, email: found.email };
    }

    if (!customer) {
      setSaveError("Select a customer first.");
      return;
    }
    if (!form.description.trim()) {
      setSaveError("Description is required.");
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/pos/requests", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          customerId: customer.id,
          customerName: customer.name,
          customerEmail: customer.email,
          salespersonName: salesperson.name,
          salespersonEmail: salesperson.email,
          budget: form.budget,
          description: form.description,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      loadRequests();
      setView("saved");
    } catch (err) {
      setSaveError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  // ---- Identity states ----
  if (boot.status === "loading") {
    return (
      <s-page heading="Match and Request">
        <s-box padding="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner accessibilityLabel="Identifying you" />
            <s-text>Identifying you…</s-text>
          </s-stack>
        </s-box>
      </s-page>
    );
  }

  if (boot.status === "error") {
    return (
      <s-page heading="Match and Request">
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-banner tone="critical" heading="Couldn't identify you" />
            <s-text>{boot.message}. Reopen the tile to retry.</s-text>
          </s-stack>
        </s-box>
      </s-page>
    );
  }

  const { data, staffMemberId, userId } = boot;

  if (!data.linked) {
    return (
      <s-page heading="Match and Request">
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <s-banner tone="warning" heading="You're not linked yet" />
              <s-stack direction="block" gap="small">
                <s-text>
                  Your POS account isn't connected to a salesperson profile yet,
                  so you won't see any requests.
                </s-text>
                <s-text>POS Staff ID: {String(staffMemberId ?? "unknown")}</s-text>
                <s-text>User ID: {String(userId ?? "unknown")}</s-text>
                <s-text>
                  An admin pastes the POS Staff ID into your profile under
                  Settings → Salespeople.
                </s-text>
              </s-stack>
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  const me = data.salesperson;
  const isAdmin = me.role === "admin";
  const roster = data.salespeople || [];
  const assignedName =
    isAdmin && pickedEmail && pickedEmail !== me.email
      ? roster.find((s) => s.email === pickedEmail)?.name || me.name
      : me.name;

  // ---- Request detail (matched products) ----
  if (view === "detail" && detailReq) {
    const r = detailReq;
    const shown = r.matches.slice(0, matchLimit);
    const remaining = r.matches.length - shown.length;
    return (
      <s-page heading={r.customerName}>
        <s-button slot="secondary-actions" onClick={() => setView("home")}>
          Back
        </s-button>
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="small">
                {/* Customer-submitted requests arrive with nobody having spoken
                    to the shopper yet — lead with the callback details. */}
                {r.source === "customer" ? (
                  <s-stack direction="block" gap="small">
                    <s-badge tone="warning">Submitted online — call the customer</s-badge>
                    {r.customerPhone ? (
                      <s-text>Phone: {r.customerPhone}</s-text>
                    ) : null}
                    {r.customerEmail ? (
                      <s-text>Email: {r.customerEmail}</s-text>
                    ) : null}
                  </s-stack>
                ) : null}

                {/* LOOKING FOR — what matching is ACTUALLY running on, notes
                    folded in. Previously the heading showed only the frozen
                    description, so a request corrected by a note ("make it
                    yellow gold") still read as white gold and staff thought
                    their edit was lost. */}
                <s-text>Looking for</s-text>
                <s-text>{matchingSummary(r)}</s-text>
                {r.budget != null ? <s-text>Budget: {money(r.budget)}</s-text> : null}
                <s-text>Salesperson: {r.salespersonName}</s-text>

                <s-button variant="secondary" onClick={() => startEdit(r)}>
                  Change what they&apos;re looking for
                </s-button>

                {/* Ends the request — must NOT look like the routine save
                    button it used to sit next to in identical blue. */}
                {r.status !== "fulfilled" ? (
                  <s-button
                    variant="secondary"
                    loading={actionBusy === `req:${r.id}`}
                    onClick={() => fulfillRequest(r)}
                  >
                    Mark fulfilled
                  </s-button>
                ) : (
                  <s-badge tone="success">Fulfilled</s-badge>
                )}
              </s-stack>

              {actionError ? (
                <s-text tone="critical">{actionError}</s-text>
              ) : null}
              {saveNotice ? <s-banner tone="success" heading={saveNotice} /> : null}

              {refining ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-spinner accessibilityLabel="Updating matches" />
                  <s-text>Saved. Finding new matches — this takes about a minute…</s-text>
                </s-stack>
              ) : r.matches.length === 0 ? (
                <s-section heading="Matches">
                  <s-banner tone="info" heading="Nothing in stock yet" />
                  <s-text>
                    Nothing in inventory matches yet. This request stays active
                    and the salesperson is alerted when matching stock arrives.
                  </s-text>
                </s-section>
              ) : (
                <s-section heading={`Matches (${r.matchCount})`}>
                  {shown.flatMap((m, i) => {
                    const conf = confInfo(m);
                    const row = (
                      <s-box key={m.id} padding="base">
                        <s-stack direction="block" gap="small">
                          {/* Image kept — staff recognise stock visually — but
                              smaller, so more than one match fits on screen. */}
                          {m.productImage ? (
                            <s-box blockSize="120px">
                              <s-image
                                src={m.productImage}
                                alt={m.productTitle}
                                inlineSize="fill"
                                objectFit="contain"
                              />
                            </s-box>
                          ) : null}
                          <s-text>{m.productTitle}</s-text>
                          <s-stack direction="inline" gap="small" alignItems="center">
                            {m.productPrice != null ? (
                              <s-text>{money(m.productPrice)}</s-text>
                            ) : null}
                            <s-badge tone={conf.tone}>
                              {conf.label}
                              {m.overBudget ? " · over budget" : ""}
                            </s-badge>
                          </s-stack>
                          {/* Actions side by side instead of two full-width
                              buttons, so a match is a compact block. */}
                          <s-stack direction="inline" gap="small">
                            <s-button
                              variant="secondary"
                              onClick={() => openProduct(m.productId)}
                            >
                              Open product
                            </s-button>
                            <s-button
                              variant="secondary"
                              tone="critical"
                              loading={actionBusy === `match:${m.id}`}
                              onClick={() => declineMatch(m)}
                            >
                              Decline
                            </s-button>
                          </s-stack>
                        </s-stack>
                      </s-box>
                    );
                    return i === 0 ? [row] : [<s-divider key={`d-${m.id}`} />, row];
                  })}
                  {/* 83 matches used to render at once — unscrollable on an
                      iPad with a customer waiting. */}
                  {remaining > 0 ? (
                    <s-box padding="base">
                      <s-button
                        variant="secondary"
                        onClick={() => setMatchLimit((n) => n + MATCH_PAGE)}
                      >
                        Show {remaining} more
                      </s-button>
                    </s-box>
                  ) : null}
                </s-section>
              )}
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Edit what the customer is looking for ----
  // The description is now editable in place. A correction changes the request
  // itself instead of being appended as a footnote that contradicts the heading.
  if (view === "edit" && detailReq) {
    const r = detailReq;
    return (
      <s-page heading="What are they looking for?">
        <s-button slot="secondary-actions" onClick={() => setView("detail")}>
          Back
        </s-button>
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <s-text-area
                label="Looking for"
                value={descDraft}
                rows={3}
                disabled={refining}
                details="Edit this to correct the request — e.g. change 'white gold' to 'yellow gold'."
                onInput={(e) => setDescDraft(e.currentTarget.value)}
              />
              <s-text-area
                label="Anything to add?"
                value={notesDraft}
                rows={3}
                disabled={refining}
                details="Optional extra details, e.g. 'prefers vintage' or 'budget up to $8,000'."
                onInput={(e) => setNotesDraft(e.currentTarget.value)}
              />
              {actionError ? <s-text tone="critical">{actionError}</s-text> : null}
              <s-button
                variant="primary"
                loading={refining}
                onClick={() => saveRequest(r)}
              >
                {refining ? "Updating…" : "Update"}
              </s-button>
              {refining ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-spinner accessibilityLabel="Updating matches" />
                  <s-text>Saved. Finding new matches — this takes about a minute…</s-text>
                </s-stack>
              ) : null}
              <s-button
                variant="secondary"
                disabled={refining}
                onClick={() => setView("detail")}
              >
                Cancel
              </s-button>
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Saved confirmation ----
  if (view === "saved") {
    return (
      <s-page heading="Request created">
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <s-banner tone="success" heading="Request saved" />
              <s-text>
                We're searching inventory for matches now. The salesperson is
                emailed automatically on strong matches, and the request stays
                active — new arrivals are matched as they come in. Matches appear
                on the requests list (refresh in a moment).
              </s-text>
              <s-button variant="primary" onClick={startNew}>
                New request
              </s-button>
              <s-button variant="secondary" onClick={() => setView("home")}>
                Done
              </s-button>
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Create form ----
  if (view === "create") {
    return (
      <s-page heading="New request">
        <s-button
          slot="secondary-actions"
          variant="primary"
          loading={saving}
          onClick={submit}
        >
          Save
        </s-button>
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              {/* Customer — searchable Shopify customer picker */}
              {customer ? (
                <s-stack direction="block" gap="small">
                  <s-text>Customer</s-text>
                  <s-text>{customer.name}</s-text>
                  {customer.email ? <s-text>{customer.email}</s-text> : null}
                  {customer.phone ? <s-text>{customer.phone}</s-text> : null}
                  <s-button variant="secondary" onClick={clearCustomer}>
                    Change customer
                  </s-button>
                </s-stack>
              ) : (
                <s-stack direction="block" gap="small">
                  <s-text>Customer</s-text>
                  <s-search-field
                    placeholder="Search name, email, or phone"
                    value={custQuery}
                    onInput={(e) => setCustQuery(e.currentTarget.value)}
                  />
                  {custSearching ? <s-text>Searching…</s-text> : null}
                  {custError ? <s-text tone="critical">{custError}</s-text> : null}
                  {custResults.length > 0 ? (
                    <s-section heading="Select a customer">
                      {custResults.flatMap((c, i) => {
                        const row = (
                          <s-clickable key={c.id} onClick={() => selectCustomer(c)}>
                            <s-box padding="base">
                              <s-stack direction="block" gap="small">
                                <s-text>{c.name}</s-text>
                                {c.email || c.phone ? (
                                  <s-text>
                                    {[c.email, c.phone].filter(Boolean).join(" · ")}
                                  </s-text>
                                ) : null}
                              </s-stack>
                            </s-box>
                          </s-clickable>
                        );
                        return i === 0
                          ? [row]
                          : [<s-divider key={`d-${c.id}`} />, row];
                      })}
                    </s-section>
                  ) : null}
                  {!custSearching &&
                  !custError &&
                  custQuery.trim().length >= 2 &&
                  custResults.length === 0 ? (
                    <s-text>No customers found.</s-text>
                  ) : null}
                </s-stack>
              )}

              {/* Description (required) */}
              <s-text-area
                label="What are they looking for?"
                value={form.description}
                rows={4}
                required
                details="In plain English, the way the customer said it."
                placeholder="e.g. grand seiko watch with a round dial"
                onInput={(e) => updateForm("description", e.currentTarget.value)}
              />

              {/* Budget (optional) */}
              <s-text-field
                label="Budget (optional)"
                value={form.budget}
                placeholder="2500"
                onInput={(e) => updateForm("budget", e.currentTarget.value)}
              />

              {/* Salesperson auto-set. Admins may reassign. */}
              {isAdmin &&
                roster.length > 0 &&
                (assigning ? (
                  <s-stack direction="block" gap="small">
                    <s-text>Assign to salesperson</s-text>
                    <s-choice-list
                      onChange={(e) =>
                        setPickedEmail(e.currentTarget.values?.[0] ?? me.email)
                      }
                    >
                      {roster.map((s) => (
                        <s-choice key={s.email} value={s.email} selected={s.email === pickedEmail}>
                          {s.name}
                          {s.email === me.email ? " (you)" : ""}
                        </s-choice>
                      ))}
                    </s-choice-list>
                  </s-stack>
                ) : (
                  <s-stack direction="block" gap="small">
                    <s-text>Salesperson: {assignedName}</s-text>
                    <s-button
                      variant="secondary"
                      onClick={() => setAssigning(true)}
                    >
                      Assign to another salesperson
                    </s-button>
                  </s-stack>
                ))}

              {saveError ? <s-text tone="critical">{saveError}</s-text> : null}

              <s-button
                variant="secondary"
                disabled={saving}
                onClick={() => setView("home")}
              >
                Cancel
              </s-button>
            </s-stack>
          </s-box>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Home: identity + role-filtered request list ----
  const requests = reqState.requests || [];
  return (
    <s-page heading="Match and Request">
      <s-button slot="secondary-actions" variant="primary" onClick={startNew}>
        New request
      </s-button>
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text>Signed in as {me.name}</s-text>
              <s-badge tone={isAdmin ? "info" : "success"}>
                {isAdmin ? "Admin — all requests" : "Salesperson — your requests"}
              </s-badge>
            </s-stack>

            <s-button
              variant="secondary"
              loading={reqState.status === "loading"}
              onClick={loadRequests}
            >
              Refresh
            </s-button>

            {reqState.status === "loading" && requests.length === 0 ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-spinner accessibilityLabel="Loading requests" />
                <s-text>Loading requests…</s-text>
              </s-stack>
            ) : reqState.status === "error" ? (
              <s-text tone="critical">
                Couldn't load requests: {reqState.error}
              </s-text>
            ) : requests.length === 0 ? (
              <s-section heading="Requests">
                <s-text>No active requests yet. Tap “New request” to add one.</s-text>
              </s-section>
            ) : (
              <s-section
                heading={`${isAdmin ? "All requests" : "Your requests"} (${requests.length})`}
              >
                {requests.flatMap((r, i) => {
                  const row = (
                    <s-clickable key={r.id} onClick={() => openRequest(r)}>
                      <s-box padding="base">
                        <s-stack direction="block" gap="small">
                          <s-stack
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >
                            <s-text>{r.customerName}</s-text>
                            <s-badge tone={r.matchCount > 0 ? "success" : "neutral"}>
                              {r.matchCount > 0
                                ? `${r.matchCount} match${r.matchCount === 1 ? "" : "es"}`
                                : "Nothing in stock yet"}
                            </s-badge>
                            {r.source === "customer" ? (
                              <s-badge tone="warning">Call customer</s-badge>
                            ) : null}
                          </s-stack>
                          {r.source === "customer" && r.customerPhone ? (
                            <s-text>Submitted online · {r.customerPhone}</s-text>
                          ) : null}
                          {isAdmin ? (
                            <s-text>Salesperson: {r.salespersonName}</s-text>
                          ) : null}
                          {r.description ? <s-text>{r.description}</s-text> : null}
                          {r.budget != null ? (
                            <s-text>Budget: {money(r.budget)}</s-text>
                          ) : null}
                        </s-stack>
                      </s-box>
                    </s-clickable>
                  );
                  return i === 0
                    ? [row]
                    : [<s-divider key={`d-${r.id}`} />, row];
                })}
              </s-section>
            )}
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}

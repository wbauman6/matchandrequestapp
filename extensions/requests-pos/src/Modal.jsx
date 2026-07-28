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

  // Refinement notes (live-refine matching).
  const [notesDraft, setNotesDraft] = useState("");
  const [refining, setRefining] = useState(false);

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
    setDetailReq(r);
    setNotesDraft(r.matchNotes || "");
    setView("detail");
  };

  // Save refinement notes and re-run matching. Shows an "updating…" state, then
  // swaps in the refreshed request (matches added/removed per the new notes).
  async function saveNotes(r) {
    setRefining(true);
    setActionError("");
    try {
      const res = await fetch(`/api/pos/requests/${r.id}`, {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ _action: "save-notes", matchNotes: notesDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      if (data.request) {
        setDetailReq(data.request);
        setNotesDraft(data.request.matchNotes || "");
      }
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
  const openProduct = (productGid) => {
    const numId = String(productGid || "").split("/").pop();
    if (!numId) return;
    try {
      navigation.navigate(`shopify:point-of-sale/products/${numId}`);
    } catch {
      // navigation may be unavailable in some contexts — no-op.
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
    return (
      <s-page heading={r.customerName}>
        <s-button slot="secondary-actions" onClick={() => setView("home")}>
          Back
        </s-button>
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="small">
                {r.description ? <s-text>{r.description}</s-text> : null}
                {r.budget != null ? <s-text>Budget: {money(r.budget)}</s-text> : null}
                <s-text>Salesperson: {r.salespersonName}</s-text>
                {r.status !== "fulfilled" ? (
                  <s-button
                    variant="primary"
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

              {/* Refine matching — narrow, broaden, or nudge without a new request */}
              <s-stack direction="block" gap="small">
                <s-text-area
                  label="Refine matching (notes)"
                  value={notesDraft}
                  rows={3}
                  disabled={refining}
                  details="Add details to narrow, broaden, or nudge matches. Saving re-runs matching. e.g. 'must be pear-shaped', 'any yellow tone is fine', 'budget up to $8,000', 'prefers vintage'."
                  onInput={(e) => setNotesDraft(e.currentTarget.value)}
                />
                <s-button
                  variant="primary"
                  loading={refining}
                  onClick={() => saveNotes(r)}
                >
                  {refining ? "Updating matches…" : "Save & re-match"}
                </s-button>
                {refining ? (
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-spinner accessibilityLabel="Updating matches" />
                    <s-text>Re-evaluating inventory against the refined request…</s-text>
                  </s-stack>
                ) : null}
              </s-stack>

              {refining ? null : r.matches.length === 0 ? (
                <s-section heading="Matches">
                  <s-banner tone="info" heading="Not in stock yet — watching" />
                  <s-text>
                    Nothing in inventory matches yet. This request stays active
                    and the salesperson is alerted when matching stock arrives.
                  </s-text>
                </s-section>
              ) : (
                <s-section heading={`Matches (${r.matchCount})`}>
                  {r.matches.flatMap((m, i) => {
                    const conf = confInfo(m);
                    const row = (
                      <s-box key={m.id} padding="base">
                        <s-stack direction="block" gap="small">
                          {m.productImage ? (
                            <s-box blockSize="200px">
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
                          {m.reasoning ? <s-text>{m.reasoning}</s-text> : null}
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
                      </s-box>
                    );
                    return i === 0 ? [row] : [<s-divider key={`d-${m.id}`} />, row];
                  })}
                </s-section>
              )}
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
                  <s-text-field
                    label="Customer (search name, email, or phone)"
                    value={custQuery}
                    placeholder="Jane, jane@email.com, or 555-1234"
                    onInput={(e) => setCustQuery(e.currentTarget.value)}
                  />
                  {custSearching ? <s-text>Searching…</s-text> : null}
                  {custError ? <s-text tone="critical">{custError}</s-text> : null}
                  {custResults.map((c) => (
                    <s-clickable onClick={() => selectCustomer(c)}>
                      <s-box padding="small">
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
                  ))}
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
                label="Description"
                value={form.description}
                rows={4}
                required
                details="What the customer is looking for, in plain English."
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
                        <s-choice value={s.email} selected={s.email === pickedEmail}>
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
                                : "watching"}
                            </s-badge>
                          </s-stack>
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

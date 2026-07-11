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
    setDetailReq(r);
    setView("detail");
  };

  // Open a matched product's listing on the native POS product-details screen.
  // Match.productId is a GID (gid://shopify/Product/123); POS deep links use the
  // numeric id.
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
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-spinner accessibilityLabel="Identifying you" />
          <s-text>Identifying you…</s-text>
        </s-stack>
      </s-page>
    );
  }

  if (boot.status === "error") {
    return (
      <s-page heading="Match and Request">
        <s-section heading="Couldn't identify you">
          <s-text>{boot.message}. Reopen the tile to retry.</s-text>
        </s-section>
      </s-page>
    );
  }

  const { data, staffMemberId, userId } = boot;

  if (!data.linked) {
    return (
      <s-page heading="Match and Request">
        <s-scroll-box>
          <s-stack direction="block" gap="base">
            <s-banner tone="warning" heading="You're not linked yet" />
            <s-section heading="Ask an admin to link you">
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
            </s-section>
          </s-stack>
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
        <s-scroll-box>
          <s-stack direction="block" gap="base">
            <s-button variant="secondary" onClick={() => setView("home")}>
              ← Back to requests
            </s-button>

            <s-section heading="Request">
              <s-stack direction="block" gap="small">
                {r.description ? <s-text>{r.description}</s-text> : null}
                {r.budget != null ? <s-text>Budget: {money(r.budget)}</s-text> : null}
                <s-text>Salesperson: {r.salespersonName}</s-text>
              </s-stack>
            </s-section>

            <s-section heading={`Matches (${r.matchCount})`}>
              {r.matches.length === 0 ? (
                <s-stack direction="block" gap="small">
                  <s-banner tone="info" heading="Not in stock yet — watching" />
                  <s-text>
                    Nothing in inventory matches yet. This request stays active and
                    the salesperson is alerted when matching stock arrives.
                  </s-text>
                </s-stack>
              ) : (
                r.matches.map((m) => {
                  const conf = confInfo(m);
                  return (
                    <s-section heading={m.productTitle}>
                      <s-clickable onClick={() => openProduct(m.productId)}>
                        <s-box padding="small">
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
                            {m.productPrice != null ? (
                              <s-text>{money(m.productPrice)}</s-text>
                            ) : null}
                            <s-badge tone={conf.tone}>
                              {conf.label}
                              {m.overBudget ? " · over budget" : ""}
                            </s-badge>
                            {m.reasoning ? <s-text>{m.reasoning}</s-text> : null}
                            <s-text tone="info">Tap to open product →</s-text>
                          </s-stack>
                        </s-box>
                      </s-clickable>
                    </s-section>
                  );
                })
              )}
            </s-section>
          </s-stack>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Saved confirmation ----
  if (view === "saved") {
    return (
      <s-page heading="Request created">
        <s-scroll-box>
          <s-stack direction="block" gap="base">
            <s-banner tone="success" heading="Request saved" />
            <s-section heading="What happens next">
              <s-text>
                We're searching inventory for matches now. The salesperson is
                emailed automatically on strong matches, and the request stays
                active — new arrivals are matched as they come in. Matches appear
                on the requests list (refresh in a moment).
              </s-text>
            </s-section>
            <s-stack direction="block" gap="base">
              <s-button variant="primary" onClick={startNew}>
                New request
              </s-button>
              <s-button variant="secondary" onClick={() => setView("home")}>
                Done
              </s-button>
            </s-stack>
          </s-stack>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Create form ----
  if (view === "create") {
    return (
      <s-page heading="New request">
        <s-scroll-box>
          <s-stack direction="block" gap="base">
            {/* Customer — searchable Shopify customer picker */}
            {customer ? (
              <s-section heading="Customer">
                <s-stack direction="block" gap="small">
                  <s-text>{customer.name}</s-text>
                  {customer.email ? <s-text>{customer.email}</s-text> : null}
                  {customer.phone ? <s-text>{customer.phone}</s-text> : null}
                  <s-button variant="secondary" onClick={clearCustomer}>
                    Change customer
                  </s-button>
                </s-stack>
              </s-section>
            ) : (
              <s-section heading="Customer">
                <s-stack direction="block" gap="small">
                  <s-text-field
                    label="Search by name, email, or phone"
                    value={custQuery}
                    placeholder="Jane, jane@email.com, or 555-1234"
                    onInput={(e) => setCustQuery(e.currentTarget.value)}
                  />
                  {custSearching ? <s-text>Searching…</s-text> : null}
                  {custError ? <s-text tone="critical">{custError}</s-text> : null}
                  {custResults.map((c) => (
                    <s-button
                      variant="secondary"
                      onClick={() => selectCustomer(c)}
                    >
                      {c.name}
                      {c.email ? ` · ${c.email}` : ""}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </s-button>
                  ))}
                  {!custSearching &&
                  !custError &&
                  custQuery.trim().length >= 2 &&
                  custResults.length === 0 ? (
                    <s-text>No customers found.</s-text>
                  ) : null}
                </s-stack>
              </s-section>
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

            {/* Budget (optional) — below description */}
            <s-text-field
              label="Budget (optional)"
              value={form.budget}
              placeholder="2500"
              onInput={(e) => updateForm("budget", e.currentTarget.value)}
            />

            {/* Salesperson auto-set to the logged-in person. Admins may reassign. */}
            {isAdmin &&
              roster.length > 0 &&
              (assigning ? (
                <s-section heading="Assign to salesperson">
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
                </s-section>
              ) : (
                <s-stack direction="block" gap="small">
                  <s-text>Salesperson: {assignedName}</s-text>
                  <s-button variant="secondary" onClick={() => setAssigning(true)}>
                    Assign to another salesperson
                  </s-button>
                </s-stack>
              ))}

            {saveError ? <s-text tone="critical">{saveError}</s-text> : null}

            <s-stack direction="block" gap="base">
              <s-button variant="primary" loading={saving} onClick={submit}>
                Save & find matches
              </s-button>
              <s-button
                variant="secondary"
                disabled={saving}
                onClick={() => setView("home")}
              >
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </s-scroll-box>
      </s-page>
    );
  }

  // ---- Home: identity + role-filtered request list ----
  const requests = reqState.requests || [];
  return (
    <s-page heading="Match and Request">
      <s-scroll-box>
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small">
            <s-text>Signed in as {me.name}</s-text>
            <s-badge tone={isAdmin ? "info" : "success"}>
              {isAdmin ? "Admin — all requests" : "Salesperson — your requests"}
            </s-badge>
          </s-stack>

          <s-stack direction="block" gap="base">
            <s-button variant="primary" onClick={startNew}>
              New request
            </s-button>
            <s-button
              variant="secondary"
              loading={reqState.status === "loading"}
              onClick={loadRequests}
            >
              Refresh
            </s-button>
          </s-stack>

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
            requests.map((r) => (
              <s-section heading={r.customerName}>
                <s-stack direction="block" gap="small">
                  {isAdmin ? (
                    <s-text>Salesperson: {r.salespersonName}</s-text>
                  ) : null}
                  {r.description ? <s-text>{r.description}</s-text> : null}
                  {r.budget != null ? <s-text>Budget: {money(r.budget)}</s-text> : null}
                  <s-button variant="secondary" onClick={() => openRequest(r)}>
                    {r.matchCount > 0
                      ? `View ${r.matchCount} match${r.matchCount === 1 ? "" : "es"}`
                      : "Watching — no matches yet"}
                  </s-button>
                </s-stack>
              </s-section>
            ))
          )}
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}

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

function Modal() {
  // Identity bootstrap: "loading" | "ready" | "error"
  const [boot, setBoot] = useState({ status: "loading" });
  // In-app view once linked: "home" | "create" | "saved"
  const [view, setView] = useState("home");

  const [form, setForm] = useState(EMPTY_FORM);
  // Salesperson defaults to the logged-in person; admins can optionally reassign.
  const [pickedEmail, setPickedEmail] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Customer picker (search Shopify customers by name/email/phone).
  const [customer, setCustomer] = useState(null); // { id, name, email, phone }
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
                active — new arrivals are matched as they come in. (Viewing
                matches directly on POS is coming next.)
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

  // ---- Home ----
  return (
    <s-page heading="Match and Request">
      <s-stack direction="block" gap="base">
        <s-section heading="Signed in as">
          <s-stack direction="block" gap="small">
            <s-text>{me.name}</s-text>
            <s-badge tone={isAdmin ? "info" : "success"}>
              {isAdmin ? "Admin — sees all requests" : "Salesperson — sees own requests"}
            </s-badge>
          </s-stack>
        </s-section>
        <s-button variant="primary" onClick={startNew}>
          New request
        </s-button>
      </s-stack>
    </s-page>
  );
}

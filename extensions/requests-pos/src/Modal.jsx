import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Modal />, document.body);
};

const EMPTY_FORM = {
  customerName: "",
  customerEmail: "",
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
  const [pickedEmail, setPickedEmail] = useState(null); // salesperson email for admins
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [result, setResult] = useState(null); // { matchCount }
  const [debug, setDebug] = useState(null); // TEMP diagnostic for submit bug

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

  const updateForm = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const startNew = () => {
    setForm(EMPTY_FORM);
    setSaveError("");
    setResult(null);
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

    // TEMP diagnostic: build payload from current state and send it REGARDLESS
    // of validation, so we can see exactly what state the form holds and what the
    // backend receives. (Client validation intentionally bypassed for diagnosis.)
    const payload = {
      customerName: form.customerName,
      customerEmail: form.customerEmail,
      salespersonName: salesperson.name,
      salespersonEmail: salesperson.email,
      budget: form.budget,
      description: form.description,
    };

    setSaving(true);
    setSaveError("");
    setDebug({ formSnapshot: { ...form }, sent: payload, received: null });
    try {
      const res = await fetch("/api/pos/requests", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      setDebug((d) => ({
        ...d,
        received: data.received ?? null,
        status: res.status,
        serverError: data.error ?? null,
        matchCount: data.matchCount ?? null,
      }));
      setView("debug");
    } catch (err) {
      setDebug((d) => ({ ...d, fetchError: String(err?.message || err) }));
      setView("debug");
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
        <s-stack direction="block" gap="base">
          <s-banner tone="warning" heading="You're not linked yet" />
          <s-section heading="Ask an admin to link you">
            <s-stack direction="block" gap="small">
              <s-text>
                Your POS account isn't connected to a salesperson profile yet, so
                you won't see any requests.
              </s-text>
              <s-text>POS Staff ID: {String(staffMemberId ?? "unknown")}</s-text>
              <s-text>User ID: {String(userId ?? "unknown")}</s-text>
              <s-text>
                An admin pastes the POS Staff ID into your profile under Settings
                → Salespeople.
              </s-text>
            </s-stack>
          </s-section>
        </s-stack>
      </s-page>
    );
  }

  const me = data.salesperson;
  const isAdmin = me.role === "admin";
  const roster = data.salespeople || [];

  // ---- TEMP diagnostic view ----
  if (view === "debug") {
    return (
      <s-page heading="Submit diagnostic">
        <s-stack direction="block" gap="base">
          <s-section heading="Form state at submit">
            <s-text>{JSON.stringify(debug?.formSnapshot ?? {})}</s-text>
          </s-section>
          <s-section heading="Payload sent">
            <s-text>{JSON.stringify(debug?.sent ?? {})}</s-text>
          </s-section>
          <s-section heading="Backend received">
            <s-text>{JSON.stringify(debug?.received ?? debug?.fetchError ?? "no response")}</s-text>
          </s-section>
          <s-section heading="Result">
            <s-text>
              status={String(debug?.status ?? "—")} matchCount=
              {String(debug?.matchCount ?? "—")} error=
              {String(debug?.serverError ?? "none")}
            </s-text>
          </s-section>
          <s-button variant="secondary" onClick={() => setView("create")}>
            Back to form
          </s-button>
        </s-stack>
      </s-page>
    );
  }

  // ---- Saved confirmation ----
  if (view === "saved") {
    const n = result?.matchCount ?? 0;
    return (
      <s-page heading="Request created">
        <s-stack direction="block" gap="base">
          <s-banner
            tone="success"
            heading={
              n > 0
                ? `Found ${n} match${n === 1 ? "" : "es"}`
                : "No matches yet — watching"
            }
          />
          <s-section heading="What happens next">
            <s-text>
              {n > 0
                ? "Matches are ready in the app. Viewing and acting on matches directly on POS is coming in the next step."
                : "Nothing in stock matches yet. The request stays active and the salesperson is alerted automatically when matching inventory arrives."}
            </s-text>
          </s-section>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={startNew}>
              New request
            </s-button>
            <s-button variant="secondary" onClick={() => setView("home")}>
              Done
            </s-button>
          </s-stack>
        </s-stack>
      </s-page>
    );
  }

  // ---- Create form ----
  if (view === "create") {
    return (
      <s-page heading="New request">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Customer name"
            value={form.customerName}
            required
            onChange={(e) => updateForm("customerName", e.currentTarget.value)}
          />
          <s-text-field
            label="Customer email"
            value={form.customerEmail}
            placeholder="optional"
            onChange={(e) => updateForm("customerEmail", e.currentTarget.value)}
          />

          {isAdmin && roster.length > 0 && (
            <s-section heading="Salesperson">
              <s-choice-list
                onChange={(e) =>
                  setPickedEmail(e.currentTarget.values?.[0] ?? me.email)
                }
              >
                {roster.map((s) => (
                  <s-choice
                    value={s.email}
                    selected={s.email === pickedEmail}
                  >
                    {s.name}
                    {s.email === me.email ? " (you)" : ""}
                  </s-choice>
                ))}
              </s-choice-list>
            </s-section>
          )}

          <s-text-field
            label="Budget ($)"
            value={form.budget}
            placeholder="2500"
            onChange={(e) => updateForm("budget", e.currentTarget.value)}
          />
          <s-text-area
            label="Description"
            value={form.description}
            rows={4}
            required
            placeholder="Describe what the customer wants in plain English (e.g. 'grand seiko watch with a round dial' or 'yellow gold tennis bracelet under $3000')"
            onChange={(e) => updateForm("description", e.currentTarget.value)}
          />

          {saveError ? <s-text tone="critical">{saveError}</s-text> : null}

          <s-section heading="Live form state (diagnostic)">
            <s-text>{JSON.stringify(form)}</s-text>
          </s-section>

          <s-stack direction="inline" gap="base">
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

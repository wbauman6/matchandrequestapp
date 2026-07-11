import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

export default async () => {
  render(<Modal />, document.body);
};

function Modal() {
  // status: "loading" | "ready" | "error"
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = shopify.session.currentSession;
        const staffMemberId = session?.staffMemberId;
        const userId = session?.userId;

        // Relative URLs resolve against the app_url and auto-include the auth
        // header; we also attach the token explicitly when available.
        const headers = {};
        try {
          const token = await shopify.session.getSessionToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        } catch {
          // getSessionToken rejects if the user lacks app permissions — the
          // platform still auto-attaches auth for same-domain relative URLs.
        }

        const res = await fetch(
          `/api/pos/me?staffMemberId=${encodeURIComponent(
            staffMemberId ?? "",
          )}&userId=${encodeURIComponent(userId ?? "")}`,
          { headers },
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();

        if (!cancelled) setState({ status: "ready", data, staffMemberId, userId });
      } catch (err) {
        if (!cancelled) {
          setState({ status: "error", message: String(err?.message || err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <s-page heading="Match and Request">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-spinner accessibilityLabel="Identifying you" />
          <s-text>Identifying you…</s-text>
        </s-stack>
      </s-page>
    );
  }

  if (state.status === "error") {
    return (
      <s-page heading="Match and Request">
        <s-section heading="Couldn't identify you">
          <s-text>{state.message}. Reopen the tile to retry.</s-text>
        </s-section>
      </s-page>
    );
  }

  const { data, staffMemberId, userId } = state;

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

  const sp = data.salesperson;
  const isAdmin = sp.role === "admin";

  return (
    <s-page heading="Match and Request">
      <s-stack direction="block" gap="base">
        <s-section heading="Signed in as">
          <s-stack direction="block" gap="small">
            <s-text>{sp.name}</s-text>
            <s-text>{sp.email}</s-text>
            <s-badge tone={isAdmin ? "info" : "success"}>
              {isAdmin
                ? "Admin — sees all requests"
                : "Salesperson — sees own requests"}
            </s-badge>
          </s-stack>
        </s-section>
        <s-text>POS Staff ID: {String(staffMemberId ?? "unknown")}</s-text>
      </s-stack>
    </s-page>
  );
}

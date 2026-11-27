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

// Plain words, no percentages. A number invites arguing with it instead of
// looking at the piece.
function fitInfo(m) {
  const c = (m.confidence || "").toLowerCase();
  if (c === "high" || (!c && m.score >= 70)) return { tone: "success", label: "Close match" };
  return { tone: "neutral", label: "Possible match" };
}

const clip = (text, n) => {
  const t = String(text || "").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}\u2026` : t;
};

function dayLabel(d) {
  if (!d) return "soon";
  const when = new Date(d);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (when.toDateString() === today.toDateString() || when < today) return "today";
  if (when.toDateString() === tomorrow.toDateString()) return "tomorrow";
  return `on ${when.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`;
}

// Kept in sync with DECLINE_REASONS in app/lib/nextAction.js (the server
// rejects any key not in its own list).
const DECLINE_REASONS = {
  price: "Too expensive",
  style: "Wrong style",
  size: "Wrong size",
  quality: "Not nice enough",
  other: "Other",
};

// Next-action keys that mean "pick up the phone".
const CALL_KEYS = ["followUp", "call", "callDetails", "needsRewrite"];

// Find a half-remembered request: every word typed must appear somewhere in
// the name, contact details or request text. Mirror of matchesSearch in
// app/lib/nextAction.js, which has the unit tests.
function matchesSearch(r, query) {
  const words = String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const phoneDigits = String(r.customerPhone || "").replace(/\D/g, "");
  const hay = [r.customerName, r.customerEmail, r.customerPhone, r.description, r.matchNotes, r.salespersonName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => {
    if (hay.includes(w)) return true;
    const digits = w.replace(/\D/g, "");
    return digits.length >= 3 && phoneDigits.includes(digits);
  });
}

// The server works out the next action (app/lib/nextAction.js) so POS, admin
// and the appraiser page agree. This fallback only runs if this build is ever
// talking to a server that predates that field — it keeps the list usable
// rather than blank.
function actionFor(r) {
  if (r.nextAction && r.nextAction.label) return r.nextAction;
  if (r.status === "fulfilled") return { key: "sold", group: "done", rank: 99, label: "Sold" };
  if (r.source === "customer" && !r.calledAt) {
    return { key: "call", group: "do", rank: 2, label: "Call customer" };
  }
  const unread = r.unreadCount || 0;
  if (unread > 0) {
    return { key: "newMatches", group: "do", rank: 3, label: `Review ${unread} new match${unread === 1 ? "" : "es"}` };
  }
  if ((r.matchCount || 0) > 0) {
    return { key: "decide", group: "do", rank: 5, label: `Decide on ${r.matchCount} match${r.matchCount === 1 ? "" : "es"}` };
  }
  return { key: "watching", group: "waiting", rank: 55, label: "No match found yet" };
}

function actionTone(na) {
  if (CALL_KEYS.includes(na.key)) return "warning";
  if (na.group === "do") return "info";
  return "neutral";
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
  // Which list is showing. Defaults to "do": the ordered list of what needs
  // this person next, so opening the tile answers "where do I start?".
  const [posFilter, setPosFilter] = useState("do");
  // Find-a-request box on the home screen.
  const [search, setSearch] = useState("");
  // The match most recently marked "Not a fit", so it can be put back and
  // given a reason. { id, title, requestId, reason }
  const [lastDeclined, setLastDeclined] = useState(null);

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
      const fresh = data.requests || [];
      setReqState({ status: "ready", requests: fresh, role: data.role });
      // The open request is a snapshot taken when its row was tapped. Refresh
      // it from the list so an action never appears to have done nothing.
      setDetailReq((prev) => (prev ? fresh.find((x) => x.id === prev.id) || prev : prev));
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
    setLastDeclined(null);
    setView("detail");
    // Opening a request is "seeing" its matches. Nothing on POS ever cleared
    // "new", so every match stayed new forever. Best-effort, in the background.
    if ((r.unreadCount || 0) > 0) {
      postRequest(r.id, { _action: "mark-seen" })
        .then(() => loadRequests())
        .catch(() => {});
    }
  };

  async function postRequest(id, body) {
    const res = await fetch(`/api/pos/requests/${id}`, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.ok) {
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    return data;
  }

  async function postMatch(id, body) {
    const res = await fetch(`/api/pos/matches/${id}`, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.ok) {
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    return data;
  }

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
        // Merge rather than replace: the save response carries fewer fields
        // than the list, and loadRequests() below brings the full row back.
        setDetailReq((prev) => ({ ...(prev || {}), ...data.request }));
        setNotesDraft(data.request.matchNotes || "");
        setDescDraft(data.request.description || "");
        const n = data.request.matchCount || 0;
        setSaveNotice(
          n > 0
            ? `Saved — ${n} match${n === 1 ? "" : "es"} found.`
            : "Saved — no match found yet. We'll keep watching.",
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

  // Mark a request sold (or reopen one marked by mistake) — the same status
  // change the admin app makes. Selling leaves the working lists, so go home.
  async function setRequestStatus(r, status) {
    setActionBusy(`req:${r.id}`);
    setActionError("");
    try {
      await postRequest(r.id, { status });
      await loadRequests();
      if (status === "fulfilled") setView("home");
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  // Record a call AND what came of it: spoke | message | later | reset.
  // Does not leave the screen — they are usually still on the phone.
  async function logCall(r, outcome) {
    setActionBusy(`call:${r.id}:${outcome}`);
    setActionError("");
    try {
      await postRequest(r.id, {
        _action: "log-call",
        outcome,
        staffMemberId: boot.staffMemberId ?? "",
      });
      await loadRequests();
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  // "Keep to show" — the salesperson's yes on a piece (or taking it back).
  async function keepMatch(m, keep) {
    setActionBusy(`keep:${m.id}`);
    setActionError("");
    try {
      await postMatch(m.id, { _action: keep ? "keep" : "unkeep" });
      await loadRequests();
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  // "Not a fit". No confirmation dialog — instead the piece can be put back
  // with one tap, which is kinder than interrupting every decision.
  async function declineMatch(m) {
    const requestId = detailReq?.id;
    setActionBusy(`match:${m.id}`);
    setActionError("");
    try {
      await postMatch(m.id, { _action: "decline" });
      setLastDeclined({ id: m.id, title: m.productTitle, requestId, reason: null });
      await loadRequests();
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  async function undoDecline() {
    if (!lastDeclined) return;
    setActionBusy(`match:${lastDeclined.id}`);
    setActionError("");
    try {
      await postMatch(lastDeclined.id, { _action: "undo-decline" });
      setLastDeclined(null);
      await loadRequests();
    } catch (err) {
      setActionError(String(err?.message || err));
    } finally {
      setActionBusy(null);
    }
  }

  // Why the piece was wrong — optional, one tap, for the appraiser's benefit.
  async function setDeclineReason(reason) {
    if (!lastDeclined) return;
    setActionError("");
    try {
      await postMatch(lastDeclined.id, { _action: "reason", reason });
      setLastDeclined((d) => (d ? { ...d, reason } : d));
    } catch (err) {
      setActionError(String(err?.message || err));
    }
  }

  // Yes / no on an estate piece the appraiser put forward.
  async function decideEstate(r, suggestion, decision) {
    setActionBusy(`estate:${suggestion.id}:${decision}`);
    setActionError("");
    try {
      await postRequest(r.id, {
        _action: "estate-decide",
        suggestionId: suggestion.id,
        decision,
        staffMemberId: boot.staffMemberId ?? "",
      });
      await loadRequests();
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
    const na = actionFor(r);
    const sold = r.status === "fulfilled";
    const shown = r.matches.slice(0, matchLimit);
    const remaining = r.matches.length - shown.length;
    const lookingFor = matchingSummary(r);
    const estate = r.estateSuggestions || [];
    const pendingEstate = estate.filter((e) => e.status === "suggested");
    const approvedEstate = estate.filter((e) => e.status === "approved");
    // A website customer, a lead too vague to search, or anyone with a call
    // already logged gets the call block. Hidden once sold — a finished
    // request must never ask for a callback.
    const showCall =
      !sold &&
      (r.source === "customer" || r.requestKind === "vague" || r.callOutcome || r.followUpAt);
    const undo = lastDeclined && lastDeclined.requestId === r.id ? lastDeclined : null;
    const lastOne = r.matches.length === 1;
    return (
      // The subheading sits in the bar at the top and does not scroll away, so
      // what the customer wants stays in sight while comparing 20 pieces.
      <s-page heading={r.customerName} subheading={`Looking for: ${clip(lookingFor, 90)}`}>
        <s-button slot="secondary-actions" onClick={() => setView("home")}>
          Back
        </s-button>
        <s-scroll-box>
          <s-box padding="base">
            <s-stack direction="block" gap="base">
              {/* The one thing to do next, in words. */}
              {sold ? (
                <s-banner tone="success" heading="Sold" />
              ) : (
                <s-banner
                  tone={na.group === "do" ? "info" : "auto"}
                  heading={na.group === "do" ? `Next: ${na.label}` : na.label}
                />
              )}

              {showCall ? (
                <s-section heading="Call the customer">
                  <s-stack direction="block" gap="small">
                    {r.customerPhone ? <s-text type="strong">Phone: {r.customerPhone}</s-text> : null}
                    {r.customerEmail ? <s-text>Email: {r.customerEmail}</s-text> : null}
                    {r.requestKind === "vague" ? (
                      <s-text>
                        This request is too general to search. Ask what metal and what stone,
                        then tap &quot;Change what they&apos;re looking for&quot; below.
                      </s-text>
                    ) : null}
                    <s-text>
                      {r.calledAt
                        ? "You spoke to this customer."
                        : r.callOutcome === "message"
                          ? `You left a message. Call again ${dayLabel(r.followUpAt)}.`
                          : r.callOutcome === "later"
                            ? `Call back ${dayLabel(r.followUpAt)}.`
                            : "Nobody has spoken to this customer yet. What happened when you called?"}
                    </s-text>
                    <s-stack direction="inline" gap="small">
                      {!r.calledAt ? (
                        <s-button
                          variant="primary"
                          loading={actionBusy === `call:${r.id}:spoke`}
                          onClick={() => logCall(r, "spoke")}
                        >
                          Spoke to customer
                        </s-button>
                      ) : null}
                      <s-button
                        variant="secondary"
                        loading={actionBusy === `call:${r.id}:message`}
                        onClick={() => logCall(r, "message")}
                      >
                        Left a message
                      </s-button>
                      <s-button
                        variant="secondary"
                        loading={actionBusy === `call:${r.id}:later`}
                        onClick={() => logCall(r, "later")}
                      >
                        Call tomorrow
                      </s-button>
                      {r.calledAt || r.callOutcome ? (
                        <s-button
                          variant="secondary"
                          loading={actionBusy === `call:${r.id}:reset`}
                          onClick={() => logCall(r, "reset")}
                        >
                          Undo
                        </s-button>
                      ) : null}
                    </s-stack>
                  </s-stack>
                </s-section>
              ) : null}

              <s-stack direction="block" gap="small">
                {/* LOOKING FOR — what matching is ACTUALLY running on, notes
                    folded in, so a request corrected by a note never reads as
                    the old wording. */}
                <s-text color="subdued">Looking for</s-text>
                <s-text type="strong">{lookingFor}</s-text>
                {r.budget != null ? <s-text>Budget: {money(r.budget)}</s-text> : null}
                <s-text>Salesperson: {r.salespersonName}</s-text>

                <s-stack direction="inline" gap="small">
                  <s-button variant="secondary" onClick={() => startEdit(r)}>
                    Change what they&apos;re looking for
                  </s-button>
                  {!sold && !showCall ? (
                    <s-button
                      variant="secondary"
                      loading={actionBusy === `call:${r.id}:later`}
                      onClick={() => logCall(r, "later")}
                    >
                      Remind me to call tomorrow
                    </s-button>
                  ) : null}
                  {/* Ends the request — kept apart from the per-piece buttons
                      so it cannot be mistaken for a decision on one piece. */}
                  {!sold ? (
                    <s-button
                      variant="secondary"
                      loading={actionBusy === `req:${r.id}`}
                      onClick={() => setRequestStatus(r, "fulfilled")}
                    >
                      Mark sold
                    </s-button>
                  ) : (
                    <s-button
                      variant="secondary"
                      loading={actionBusy === `req:${r.id}`}
                      onClick={() => setRequestStatus(r, "active")}
                    >
                      Not sold — reopen
                    </s-button>
                  )}
                </s-stack>
              </s-stack>

              {actionError ? <s-text tone="critical">{actionError}</s-text> : null}
              {saveNotice ? <s-banner tone="success" heading={saveNotice} /> : null}

              {/* A mistap must be recoverable — and this is the one moment the
                  salesperson knows WHY the piece was wrong. One optional tap. */}
              {undo ? (
                <s-banner tone="info" heading={`Removed: ${clip(undo.title, 60)}`}>
                  <s-stack direction="block" gap="small">
                    <s-text>
                      {undo.reason
                        ? `Noted: ${DECLINE_REASONS[undo.reason]}.`
                        : "Why wasn't it right? (optional — helps the appraiser)"}
                    </s-text>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        variant="primary"
                        loading={actionBusy === `match:${undo.id}`}
                        onClick={undoDecline}
                      >
                        Undo — put it back
                      </s-button>
                      {Object.entries(DECLINE_REASONS).map(([key, label]) => (
                        <s-button
                          key={key}
                          variant="secondary"
                          disabled={undo.reason === key}
                          onClick={() => setDeclineReason(key)}
                        >
                          {label}
                        </s-button>
                      ))}
                    </s-stack>
                  </s-stack>
                </s-banner>
              ) : null}

              {/* Estate pieces the appraiser spotted. Nothing is appraised
                  until the salesperson says yes. */}
              {!sold && pendingEstate.length > 0 ? (
                <s-section heading="Estate piece from the appraiser">
                  {pendingEstate.map((e) => (
                    <s-box key={e.id} padding="base">
                      <s-stack direction="block" gap="small">
                        <s-text>
                          The appraiser found a piece that may fit. It has not been appraised
                          yet. Have a look, then decide.
                        </s-text>
                        <s-text type="strong">Where it is: {e.location}</s-text>
                        {e.note ? <s-text>{e.note}</s-text> : null}
                        <s-stack direction="inline" gap="small">
                          <s-button
                            variant="primary"
                            loading={actionBusy === `estate:${e.id}:approved`}
                            onClick={() => decideEstate(r, e, "approved")}
                          >
                            Yes, please appraise
                          </s-button>
                          <s-button
                            variant="secondary"
                            loading={actionBusy === `estate:${e.id}:declined`}
                            onClick={() => decideEstate(r, e, "declined")}
                          >
                            Not a fit
                          </s-button>
                        </s-stack>
                      </s-stack>
                    </s-box>
                  ))}
                </s-section>
              ) : null}
              {!sold && approvedEstate.length > 0 ? (
                <s-section heading="Being appraised for this customer">
                  {approvedEstate.map((e) => (
                    <s-text key={e.id}>{e.location}</s-text>
                  ))}
                </s-section>
              ) : null}

              {refining ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-spinner accessibilityLabel="Updating matches" />
                  <s-text>Saved. Finding new matches — this takes about a minute…</s-text>
                </s-stack>
              ) : r.requestKind === "vague" ? null : r.matches.length === 0 ? (
                <s-section heading="Matches">
                  {(r.declinedCount || 0) > 0 ? (
                    <s-stack direction="block" gap="small">
                      <s-banner tone="info" heading="All suggested pieces were not a fit" />
                      <s-text>
                        {r.appraiserOnLastDecline
                          ? "The appraiser can now see what this customer is looking for and will check estate stock. New stock is still matched automatically."
                          : "This request stays active. New stock is matched automatically and you are alerted."}
                      </s-text>
                    </s-stack>
                  ) : (
                    <s-stack direction="block" gap="small">
                      <s-banner tone="info" heading="No match found yet" />
                      <s-text>
                        Nothing we have listed matches yet. This request stays active and you
                        are alerted when matching stock arrives.
                      </s-text>
                    </s-stack>
                  )}
                </s-section>
              ) : (
                <s-section heading={`Pieces to consider (${r.matches.length})`}>
                  {shown.flatMap((m, i) => {
                    const fit = fitInfo(m);
                    const row = (
                      <s-box key={m.id} padding="base">
                        {/* Photo beside the details. An inline stack wraps when
                            there is no room, which falls back to the old
                            photo-above-text layout rather than squashing. */}
                        <s-stack direction="inline" gap="base" alignItems="start">
                          {m.productImage ? (
                            <s-box inlineSize="170px" blockSize="170px">
                              <s-image
                                src={m.productImage}
                                alt={m.productTitle}
                                inlineSize="fill"
                                objectFit="contain"
                              />
                            </s-box>
                          ) : null}
                          <s-stack direction="block" gap="small" inlineSize="60%" minInlineSize="260px">
                            <s-text color="subdued">
                              Piece {i + 1} of {r.matches.length}
                            </s-text>
                            <s-text type="strong">{m.productTitle}</s-text>
                            <s-stack direction="inline" gap="small" alignItems="center">
                              {m.productPrice != null ? (
                                <s-text type="strong">{money(m.productPrice)}</s-text>
                              ) : null}
                              <s-badge tone={fit.tone}>{fit.label}</s-badge>
                              {m.overBudget ? <s-badge tone="warning">Over budget</s-badge> : null}
                              {m.keptAt ? <s-badge tone="success">Kept to show</s-badge> : null}
                            </s-stack>
                            {m.reasoning ? <s-text>{clip(m.reasoning, 160)}</s-text> : null}
                            {/* Say what the tap will do BEFORE it is tapped —
                                only on the one decision that changes whose
                                turn it is. */}
                            {lastOne && !sold && r.appraiserOnLastDecline ? (
                              <s-text tone="warning">
                                This is the last match. If it&apos;s not a fit, the appraiser will
                                see what the customer is looking for.
                              </s-text>
                            ) : null}
                            {!sold ? (
                              <s-stack direction="inline" gap="small">
                                <s-button
                                  variant={m.keptAt ? "secondary" : "primary"}
                                  loading={actionBusy === `keep:${m.id}`}
                                  onClick={() => keepMatch(m, !m.keptAt)}
                                >
                                  {m.keptAt ? "Kept — undo" : "Keep to show"}
                                </s-button>
                                <s-button
                                  variant="secondary"
                                  loading={actionBusy === `match:${m.id}`}
                                  onClick={() => declineMatch(m)}
                                >
                                  Not a fit
                                </s-button>
                                <s-button
                                  variant="secondary"
                                  onClick={() => openProduct(m.productId)}
                                >
                                  Open product
                                </s-button>
                              </s-stack>
                            ) : (
                              <s-button
                                variant="secondary"
                                onClick={() => openProduct(m.productId)}
                              >
                                Open product
                              </s-button>
                            )}
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
                We're searching inventory now. If something fits, this request
                appears under “Do next” with the pieces to review. It stays
                active, and new arrivals are matched as they come in.
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

  // ---- Home: find a request, then the ordered list of what to do next ----
  const allRequests = (reqState.requests || []).map((r) => ({ ...r, nextAction: actionFor(r) }));
  const isSold = (r) => r.status === "fulfilled";
  const byOrder = (a, b) =>
    a.nextAction.rank - b.nextAction.rank ||
    new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();

  // The same five views, always in the same place. They used to disappear
  // when empty, which moved the buttons around and made "nothing sold lately"
  // look like the Sold list had been taken away.
  const POS_FILTERS = {
    do: (r) => !isSold(r) && r.nextAction.group === "do",
    needCall: (r) => !isSold(r) && CALL_KEYS.includes(r.nextAction.key),
    toCheck: (r) => !isSold(r) && ["newMatches", "estate"].includes(r.nextAction.key),
    waiting: (r) => !isSold(r) && r.nextAction.group !== "do",
    fulfilled: isSold,
  };
  const FILTER_LABELS = [
    ["do", "Do next"],
    ["needCall", "Need to call"],
    ["toCheck", "New matches"],
    ["waiting", "Waiting"],
    ["fulfilled", "Sold"],
  ];
  const searching = search.trim().length > 0;
  // A search looks everywhere — the salesperson should not have to guess
  // which list a half-remembered request is filed under.
  const requests = (
    searching
      ? allRequests.filter((r) => matchesSearch(r, search))
      : allRequests.filter(POS_FILTERS[posFilter] || POS_FILTERS.do)
  ).sort(byOrder);
  const numbered = !searching && posFilter === "do";
  const listHeading = searching
    ? `Search results (${requests.length})`
    : posFilter === "do"
      ? `Do next, in this order (${requests.length})`
      : posFilter === "needCall"
        ? `Customers to call (${requests.length})`
        : posFilter === "toCheck"
          ? `Requests with new matches (${requests.length})`
          : posFilter === "waiting"
            ? `Waiting — nothing for you to do (${requests.length})`
            : `Sold in the last 90 days (${requests.length})`;

  return (
    <s-page heading="Match and Request">
      <s-button slot="secondary-actions" variant="primary" onClick={startNew}>
        New request
      </s-button>
      <s-scroll-box>
        <s-box padding="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text>Signed in as {me.name}</s-text>
              <s-badge tone={isAdmin ? "info" : "success"}>
                {isAdmin ? "Admin — all requests" : "Your requests"}
              </s-badge>
            </s-stack>

            <s-search-field
              placeholder="Find a request — customer name, phone, or item"
              value={search}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />

            {searching ? (
              <s-button variant="secondary" onClick={() => setSearch("")}>
                Clear search
              </s-button>
            ) : (
              <s-stack direction="inline" gap="small">
                {FILTER_LABELS.map(([key, label]) => (
                  <s-button
                    key={key}
                    variant={posFilter === key ? "primary" : "secondary"}
                    onClick={() => setPosFilter(key)}
                  >
                    {label} ({allRequests.filter(POS_FILTERS[key]).length})
                  </s-button>
                ))}
              </s-stack>
            )}

            {reqState.status === "loading" && allRequests.length === 0 ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-spinner accessibilityLabel="Loading requests" />
                <s-text>Loading requests…</s-text>
              </s-stack>
            ) : reqState.status === "error" ? (
              <s-text tone="critical">
                Couldn't load requests: {reqState.error}
              </s-text>
            ) : requests.length === 0 ? (
              <s-section heading={listHeading}>
                {/* Name the view, so an empty one never reads as "all my
                    requests are gone". */}
                <s-text>
                  {searching
                    ? "No request found. Try fewer words — just a last name or one word for the item. Requests sold more than 90 days ago are on the office computer under History."
                    : posFilter === "needCall"
                      ? "Nobody is waiting on a call."
                      : posFilter === "toCheck"
                        ? "No new matches to look at."
                        : posFilter === "waiting"
                          ? "Nothing is waiting."
                          : posFilter === "fulfilled"
                            ? "Nothing sold in the last 90 days."
                            : allRequests.some((r) => !isSold(r))
                              ? "You're caught up. Nothing needs you right now — open requests are under Waiting."
                              : "No requests yet. Tap \u201CNew request\u201D to add one."}
                </s-text>
              </s-section>
            ) : (
              <s-section heading={listHeading}>
                {requests.flatMap((r, i) => {
                  const na = r.nextAction;
                  const sold = isSold(r);
                  const calling = !sold && CALL_KEYS.includes(na.key);
                  const row = (
                    <s-clickable key={r.id} onClick={() => openRequest(r)}>
                      <s-box padding="base">
                        <s-stack direction="block" gap="small">
                          {/* The ITEM leads — it is what staff remember and
                              what they are scanning for. */}
                          <s-text type="strong">
                            {numbered ? `${i + 1}. ` : ""}
                            {clip(r.description || "(no description)", 110)}
                          </s-text>
                          <s-text>
                            {r.customerName}
                            {r.budget != null ? ` \u00b7 Budget ${money(r.budget)}` : ""}
                            {isAdmin ? ` \u00b7 ${r.salespersonName}` : ""}
                          </s-text>
                          {/* Exactly one badge: the next thing to do. A sold
                              request says Sold and nothing else — it used to
                              keep asking for a call. */}
                          <s-stack direction="inline" gap="small" alignItems="center">
                            <s-badge tone={sold ? "success" : actionTone(na)}>{na.label}</s-badge>
                            {calling && r.customerPhone ? <s-text>{r.customerPhone}</s-text> : null}
                          </s-stack>
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

            <s-button
              variant="secondary"
              loading={reqState.status === "loading"}
              onClick={loadRequests}
            >
              Refresh list
            </s-button>
          </s-stack>
        </s-box>
      </s-scroll-box>
    </s-page>
  );
}

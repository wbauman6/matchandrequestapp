import { Resend } from "resend";

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set — email alerts are disabled.");
    }
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

// Must be an address at the Resend-verified domain (walterbauman.com).
const FROM =
  process.env.RESEND_FROM_EMAIL || "notifications@walterbauman.com";

function header(title) {
  return `
    <div style="background:#008060;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">${title}</h1>
    </div>`;
}

function footer() {
  return `
    <div style="padding:16px 32px;background:#f6f6f7;font-size:12px;color:#6d7175;">
      Sent by the Match &amp; Request app.
    </div>`;
}


function shell(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
               color:#212326;margin:0;padding:0;background:#f6f6f7;">
    <div style="max-width:620px;margin:40px auto;background:#fff;
                border-radius:8px;overflow:hidden;
                box-shadow:0 1px 3px rgba(0,0,0,.12);">
      ${body}
    </div>
  </body></html>`;
}

/**
 * Note / internal message email — sent when a staff member adds a note and
 * ticks "notify salesperson".
 */
export async function sendNoteEmail({
  salespersonName,
  salespersonEmail,
  customerName,
  authorName,
  body,
  shop,
}) {
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;

  const html = shell(`
    ${header(`Note added for ${customerName}`)}
    <div style="padding:24px 32px;">
      <p style="margin:0 0 20px;font-size:15px;">
        Hi <strong>${salespersonName}</strong>,
        <strong>${authorName}</strong> left a note on
        <strong>${customerName}</strong>'s request.
      </p>
      <div style="background:#f6f6f7;border-left:4px solid #008060;
                  border-radius:0 6px 6px 0;padding:14px 18px;
                  font-size:14px;color:#212326;white-space:pre-wrap;
                  margin-bottom:24px;">${body}</div>
      <a href="${appUrl}"
         style="display:inline-block;background:#008060;color:#fff;
                text-decoration:none;padding:12px 24px;border-radius:6px;
                font-weight:600;font-size:14px;">
        View in app →
      </a>
    </div>
    ${footer()}`);

  const resend = getClient();
  await resend.emails.send({
    from: FROM,
    to: salespersonEmail,
    subject: `Note from ${authorName} on ${customerName}'s request`,
    html,
  });
}

/**
 * Twice-weekly digest — the ONLY routine email the app sends (see
 * app/lib/digestConfig.js for the schedule). One email per salesperson,
 * summarizing each of THEIR requests that currently has high/medium-confidence
 * matches: customer, request, match count. Urgent-priority requests are named
 * at the top. Deliberately NO product details — the email points them to POS.
 *
 * entries: [{ customerName, description, priority, matchCount }]
 */
export async function sendDigestEmail({ salespersonName, salespersonEmail, entries, shop }) {
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
  const urgent = entries.filter((e) => e.priority === "urgent");
  const total = entries.length;

  const urgentBanner = urgent.length
    ? `<div style="background:#fdf3f1;border-left:4px solid #d72c0d;padding:12px 16px;
                   margin-bottom:20px;border-radius:0 6px 6px 0;">
         <div style="font-size:13px;color:#d72c0d;font-weight:700;margin-bottom:4px;">
           URGENT — needs attention first
         </div>
         <div style="font-size:14px;color:#212326;">
           ${urgent.map((e) => `<strong>${e.customerName}</strong> (${e.matchCount} match${e.matchCount > 1 ? "es" : ""})`).join(" · ")}
         </div>
       </div>`
    : "";

  const row = (e) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e1e3e5;">
        <strong style="font-size:14px;">${e.customerName}</strong>
        ${e.priority === "urgent"
          ? `<span style="background:#fdf3f1;color:#d72c0d;padding:1px 8px;border-radius:10px;
                          font-size:10px;font-weight:700;text-transform:uppercase;margin-left:6px;">urgent</span>`
          : ""}
        <div style="font-size:12px;color:#6d7175;margin-top:2px;">${(e.description || "").slice(0, 80)}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e1e3e5;text-align:right;white-space:nowrap;">
        <span style="background:#e3f1df;color:#1a7a4a;padding:2px 10px;border-radius:12px;
                     font-size:12px;font-weight:700;">${e.matchCount} match${e.matchCount > 1 ? "es" : ""}</span>
      </td>
    </tr>`;

  // Urgent requests first, then by match count.
  const sorted = [...entries].sort(
    (a, b) => (b.priority === "urgent") - (a.priority === "urgent") || b.matchCount - a.matchCount,
  );

  const html = shell(`
    ${header("Your match digest")}
    <div style="padding:24px 32px;">
      <p style="margin:0 0 20px;font-size:15px;">
        Hi <strong>${salespersonName}</strong> — <strong>${total}</strong> of your
        request${total > 1 ? "s have" : " has"} matching inventory right now.
      </p>
      ${urgentBanner}
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tbody>${sorted.map(row).join("")}</tbody>
      </table>
      <p style="margin:0 0 24px;font-size:13px;color:#6d7175;">
        Open the <strong>Requests</strong> tile on POS (or the admin app) to see the
        matched products and act on them.
      </p>
      <a href="${appUrl}"
         style="display:inline-block;background:#008060;color:#fff;
                text-decoration:none;padding:12px 24px;border-radius:6px;
                font-weight:600;font-size:14px;">
        Review matches →
      </a>
    </div>
    ${footer()}`);

  const resend = getClient();
  await resend.emails.send({
    from: FROM,
    to: salespersonEmail,
    subject: `Match digest: ${total} request${total > 1 ? "s" : ""} with matches${urgent.length ? ` · ${urgent.length} urgent` : ""}`,
    html,
  });
}

/**
 * Customer-request daily cap alert — sent ONCE on the day the storefront form
 * hits CUSTOMER_REQUEST_DAILY_CAP. Past the cap, further storefront submissions
 * are refused (with a "call the store" message) and no AI is spent on them, so
 * this is both an abuse signal and a "you may be turning away real customers"
 * signal. Staff-created requests are unaffected.
 */
export async function sendCustomerRequestCapAlert({ shop, count, limit, to }) {
  const recipients = (to || []).filter(Boolean);
  if (recipients.length === 0) return;
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;

  const html = shell(`
    ${header("⚠ Storefront request cap reached")}
    <div style="padding:24px 32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#a85100;font-weight:600;">
        The storefront request form hit its daily cap of <strong>${limit}</strong>
        (${count} attempts so far today).
      </p>
      <p style="margin:0 0 16px;font-size:14px;">
        Further customer submissions are being refused for the rest of the day and are
        <strong>not</strong> running matching, so no AI spend is accruing from them.
        Requests created by staff in POS and the admin app are unaffected.
      </p>
      <p style="margin:0 0 16px;font-size:14px;">
        If this is genuine demand rather than abuse, raise
        <code style="background:#f6f6f7;padding:2px 6px;border-radius:4px;">CUSTOMER_REQUEST_DAILY_CAP</code>
        and redeploy. If it looks like spam, leave it — the cap is doing its job.
      </p>
      <a href="${appUrl}" style="display:inline-block;background:#008060;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">
        Open the app →
      </a>
    </div>
    ${footer()}`);

  const resend = getClient();
  await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `⚠ Storefront request cap reached (${count}/${limit} today)`,
    html,
  });
}

/**
 * Weekly-drop failure alert — sent when a drop run finishes "partial" or
 * "failed" (NOT the routine digest). Loud, with the audit numbers and the
 * failure list, so a silent zero-match run can never hide a real failure.
 *
 * to: array of recipient emails (admins). audit/failures from the DropRun.
 */
export async function sendDropAlertEmail({ shop, status, audit = {}, failures = [], note, to }) {
  const recipients = (to || []).filter(Boolean);
  if (recipients.length === 0) return;
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}/app/drops`;
  const tone = status === "failed" ? "#d72c0d" : "#a85100";
  const row = (k, v) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#6d7175;">${k}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;text-align:right;">${v}</td></tr>`;
  const failLines = failures.length
    ? `<ul style="margin:8px 0;padding-left:20px;font-size:13px;color:#414547;">${failures.map((f) => `<li>${[f.stage, f.note || f.error, f.productId].filter(Boolean).join(" — ")}</li>`).join("")}</ul>`
    : "<p style='font-size:13px;color:#6d7175;'>No itemized failures recorded.</p>";

  const html = shell(`
    ${header(`⚠ Weekly drop ${status.toUpperCase()}`)}
    <div style="padding:24px 32px;">
      <p style="margin:0 0 12px;font-size:15px;color:${tone};font-weight:600;">
        The Tuesday inventory-drop match run finished <strong>${status}</strong>${note ? ` — ${note}` : ""}.
      </p>
      <p style="margin:0 0 16px;font-size:14px;">This is NOT a "nothing matched" result — something needs attention. Anything unfinished is retried on the next run, but review it:</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
        ${row("Products detected", audit.productsDetected ?? "—")}
        ${row("Embedded this run", audit.productsEmbedded ?? "—")}
        ${row("Embedding failures", audit.embedFailures ?? "—")}
        ${row("Active requests", audit.activeRequests ?? "—")}
        ${row("Evaluations attempted", audit.evalsAttempted ?? "—")}
        ${row("Evaluations completed", audit.evalsCompleted ?? "—")}
        ${row("Evaluation errors", audit.evalErrors ?? "—")}
        ${row("New matches created", audit.matchesCreated ?? "—")}
        ${row("Queue remaining", audit.queueRemaining ?? "—")}
      </table>
      <strong style="font-size:13px;">Failures / skips:</strong>
      ${failLines}
      <a href="${appUrl}" style="display:inline-block;margin-top:16px;background:#008060;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">View drop report →</a>
    </div>
    ${footer()}`);

  const resend = getClient();
  await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `⚠ Weekly drop ${status} — ${audit.matchesCreated ?? 0} matches, ${(audit.embedFailures ?? 0) + (audit.evalErrors ?? 0)} failures`,
    html,
  });
}

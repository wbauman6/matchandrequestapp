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

const FROM =
  process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

function scoreStyle(score) {
  if (score >= 70) return { bg: "#e3f1df", color: "#1a7a4a" };
  if (score >= 40) return { bg: "#fff5e6", color: "#a85100" };
  return { bg: "#f6f6f7", color: "#616161" };
}

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

function productRow(m) {
  const { bg, color } = scoreStyle(m.score);
  return `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #e1e3e5;width:72px;">
        ${m.productImage
      ? `<img src="${m.productImage}" alt="${m.productTitle}"
             style="width:60px;height:60px;object-fit:cover;border-radius:4px;display:block;"/>`
      : `<div style="width:60px;height:60px;background:#f6f6f7;border-radius:4px;"></div>`}
      </td>
      <td style="padding:12px;border-bottom:1px solid #e1e3e5;">
        <strong style="font-size:14px;">${m.productTitle}</strong>
        ${m.productPrice != null
      ? `<br/><span style="color:#414547;font-size:13px;">$${m.productPrice.toLocaleString()}</span>`
      : ""}
      </td>
      <td style="padding:12px;border-bottom:1px solid #e1e3e5;text-align:center;white-space:nowrap;">
        <span style="background:${bg};color:${color};padding:2px 10px;
                     border-radius:12px;font-size:12px;font-weight:700;">
          ${m.score}%
        </span>
      </td>
      <td style="padding:12px;border-bottom:1px solid #e1e3e5;font-size:12px;color:#6d7175;">
        ${m.matchedKeywords.join(", ")}
      </td>
    </tr>`;
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
 * Summary email when a request is first created and matches are found.
 * One email covers all N matched products.
 */
export async function sendMatchSummaryEmail({
  salespersonName,
  salespersonEmail,
  customerName,
  budget,
  matches,   // array of { productTitle, productPrice, productImage, score, matchedKeywords }
  shop,
}) {
  const count = matches.length;
  const budgetNote = budget != null ? ` (budget: $${budget.toLocaleString()})` : "";
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;

  const rows = matches
    .sort((a, b) => b.score - a.score)
    .map(productRow)
    .join("");

  const html = shell(`
    ${header(`${count} inventory match${count > 1 ? "es" : ""} found`)}
    <div style="padding:24px 32px;">
      <p style="margin:0 0 20px;font-size:15px;">
        Hi <strong>${salespersonName}</strong>, we found <strong>${count}</strong>
        product${count > 1 ? "s" : ""} that may match
        <strong>${customerName}</strong>'s request${budgetNote}.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f6f6f7;text-align:left;">
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;"></th>
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;">Product</th>
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;">Match</th>
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;">Keywords</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
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
    subject: `${count} match${count > 1 ? "es" : ""} found for ${customerName}`,
    html,
  });
}

/**
 * Recurring reminder email — sent by the daily cron job when a request has
 * unread matches and enough time has passed (2 days for urgent, 7 for normal).
 */
export async function sendReminderEmail({
  salespersonName,
  salespersonEmail,
  customerName,
  priority,
  budget,
  matches, // array of { productTitle, productPrice, productImage, score, matchedKeywords }
  shop,
}) {
  const count = matches.length;
  const budgetNote = budget != null ? ` (budget: $${budget.toLocaleString()})` : "";
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
  const isUrgent = priority === "urgent";

  const rows = matches
    .sort((a, b) => b.score - a.score)
    .map(productRow)
    .join("");

  const urgentBanner = isUrgent
    ? `<div style="background:#fdf3f1;border-left:4px solid #d72c0d;padding:10px 16px;
                  margin-bottom:20px;font-size:13px;color:#d72c0d;font-weight:600;">
         URGENT — Action needed within 2 days
       </div>`
    : "";

  const html = shell(`
    ${header(`Reminder: ${count} match${count > 1 ? "es" : ""} awaiting review`)}
    <div style="padding:24px 32px;">
      ${urgentBanner}
      <p style="margin:0 0 20px;font-size:15px;">
        Hi <strong>${salespersonName}</strong>, this is a reminder that
        <strong>${customerName}</strong>'s request${budgetNote} still has
        <strong>${count}</strong> unreviewed match${count > 1 ? "es" : ""}.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#f6f6f7;text-align:left;">
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;"></th>
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;">Product</th>
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;">Match</th>
            <th style="padding:10px 12px;font-size:11px;color:#6d7175;font-weight:600;text-transform:uppercase;">Keywords</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
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
    subject: `${isUrgent ? "⚠ URGENT — " : ""}${count} match${count > 1 ? "es" : ""} still pending for ${customerName}`,
    html,
  });
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
 * Single-product alert when a newly listed product matches an existing request.
 * Fired by the products/create and products/update webhooks.
 */
export async function sendNewProductMatchEmail({
  salespersonName,
  salespersonEmail,
  customerName,
  budget,
  match,   // { productTitle, productPrice, productImage, score, matchedKeywords }
  shop,
}) {
  const budgetNote = budget != null ? ` (budget: $${budget.toLocaleString()})` : "";
  const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
  const { bg, color } = scoreStyle(match.score);

  const html = shell(`
    ${header("New product may match a customer request")}
    <div style="padding:24px 32px;">
      <p style="margin:0 0 20px;font-size:15px;">
        Hi <strong>${salespersonName}</strong>, a newly listed product may match
        <strong>${customerName}</strong>'s request${budgetNote}.
      </p>
      <div style="border:1px solid #e1e3e5;border-radius:8px;
                  padding:16px;margin-bottom:24px;
                  display:flex;gap:16px;align-items:flex-start;">
        ${match.productImage
      ? `<img src="${match.productImage}" alt="${match.productTitle}"
             style="width:80px;height:80px;object-fit:cover;
                    border-radius:4px;flex-shrink:0;display:block;"/>`
      : ""}
        <div>
          <div style="font-weight:600;font-size:15px;margin-bottom:4px;">
            ${match.productTitle}
          </div>
          ${match.productPrice != null
      ? `<div style="font-size:14px;color:#414547;margin-bottom:8px;">
               $${match.productPrice.toLocaleString()}
             </div>`
      : ""}
          <span style="background:${bg};color:${color};padding:2px 10px;
                       border-radius:12px;font-size:12px;font-weight:700;">
            ${match.score}% match
          </span>
          <div style="margin-top:8px;font-size:12px;color:#6d7175;">
            Keywords: ${match.matchedKeywords.join(", ")}
          </div>
        </div>
      </div>
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
    subject: `New match: "${match.productTitle}" for ${customerName}`,
    html,
  });
}

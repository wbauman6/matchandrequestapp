import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DECLINE_REASONS } from "../lib/nextAction.js";

function cleanReason(raw) {
  const key = String(raw || "").trim();
  return Object.prototype.hasOwnProperty.call(DECLINE_REASONS, key) ? key : null;
}

// Per-match actions for the POS UI extension. Declining sets the same fields the
// admin app's "decline" does (declined + read), scoped to the request's shop.

function shopFromDest(dest) {
  try {
    return new URL(dest).host;
  } catch {
    return String(dest || "").replace(/^https?:\/\//, "");
  }
}

export const action = async ({ request, params }) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  const shop = shopFromDest(sessionToken.dest);

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const act = String(body._action || body.action || "decline");

  //   keep          "Keep to show" — the salesperson's yes. Until this existed
  //                 the only decision that could be recorded was no.
  //   unkeep        change of mind on a kept piece.
  //   decline       "Not a fit" — plus when, and optionally why.
  //   undo-decline  a mistap must not be permanent: declining the LAST match
  //                 hands the request to the appraiser.
  //   reason        add the why after the fact (one optional tap).
  let data = null;
  if (act === "decline") {
    data = {
      declined: true,
      read: true,
      keptAt: null,
      declinedAt: new Date(),
      declineReason: cleanReason(body.reason),
    };
  } else if (act === "undo-decline") {
    data = { declined: false, declinedAt: null, declineReason: null };
  } else if (act === "reason") {
    data = { declineReason: cleanReason(body.reason) };
  } else if (act === "keep") {
    data = { keptAt: new Date(), read: true, declined: false, declinedAt: null, declineReason: null };
  } else if (act === "unkeep") {
    data = { keptAt: null };
  }

  if (!data) {
    return cors(Response.json({ error: "Unknown action." }, { status: 400 }));
  }

  // Scoped to the shop from the validated POS session token, so a match
  // belonging to another store cannot be touched.
  const result = await prisma.match.updateMany({ where: { id: params.id, shop }, data });
  return cors(Response.json({ ok: result.count > 0 }));
};

// authenticate.pos handles the CORS preflight (OPTIONS).
export const loader = async ({ request }) => {
  const { cors } = await authenticate.pos(request);
  return cors(Response.json({ ok: true }));
};

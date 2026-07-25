import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Per-request actions for the POS UI extension. Mirrors the admin app's request
// status action (app.requests.$id.jsx: prisma.request.update status) — same data
// change, scoped to the shop from the validated POS session token.

function shopFromDest(dest) {
  try {
    return new URL(dest).host;
  } catch {
    return String(dest || "").replace(/^https?:\/\//, "");
  }
}

const ALLOWED_STATUS = ["active", "fulfilled", "archived"];

export const action = async ({ request, params }) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  const shop = shopFromDest(sessionToken.dest);

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const status = String(body.status || "").trim();
  if (!ALLOWED_STATUS.includes(status)) {
    return cors(Response.json({ error: "Invalid status." }, { status: 400 }));
  }

  // Scope by shop so a POS session can only touch its own store's requests.
  const result = await prisma.request.updateMany({
    where: { id: params.id, shop },
    data: { status },
  });

  return cors(Response.json({ ok: result.count > 0, status }));
};

// authenticate.pos handles the CORS preflight (OPTIONS).
export const loader = async ({ request }) => {
  const { cors } = await authenticate.pos(request);
  return cors(Response.json({ ok: true }));
};

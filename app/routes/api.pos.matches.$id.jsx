import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  if (act === "decline") {
    const result = await prisma.match.updateMany({
      where: { id: params.id, shop },
      data: { declined: true, read: true },
    });
    return cors(Response.json({ ok: result.count > 0 }));
  }

  return cors(Response.json({ error: "Unknown action." }, { status: 400 }));
};

// authenticate.pos handles the CORS preflight (OPTIONS).
export const loader = async ({ request }) => {
  const { cors } = await authenticate.pos(request);
  return cors(Response.json({ ok: true }));
};

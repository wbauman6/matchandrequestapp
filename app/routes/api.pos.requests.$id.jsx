import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runMatchesForRequest } from "../lib/matchRunner.server";
import { parseBudgetFromNotes } from "../lib/budget";

// Per-request actions for the POS UI extension. Mirrors the admin app
// (app.requests.$id.jsx): status changes, and saving refinement notes (which
// re-runs matching over description + notes). Scoped to the shop from the
// validated POS session token.

function shopFromDest(dest) {
  try {
    return new URL(dest).host;
  } catch {
    return String(dest || "").replace(/^https?:\/\//, "");
  }
}

const ALLOWED_STATUS = ["active", "fulfilled", "archived"];

// Shape a request's non-declined matches for the POS UI (same fields as the
// list loader in api.pos.requests.jsx).
async function shapeRequest(shop, id) {
  const r = await prisma.request.findFirst({
    where: { id, shop },
    include: {
      matches: {
        where: { declined: false },
        orderBy: [{ overBudget: "asc" }, { score: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          productId: true,
          productTitle: true,
          productPrice: true,
          productImage: true,
          score: true,
          confidence: true,
          reasoning: true,
          overBudget: true,
        },
      },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    customerName: r.customerName,
    description: r.description,
    matchNotes: r.matchNotes,
    budget: r.budget,
    salespersonName: r.salespersonName,
    status: r.status,
    matchState: r.matchState,
    matchCount: r.matches.length,
    matches: r.matches,
  };
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

  // ---- Save refinement notes + re-run matching over description + notes ----
  if (body._action === "save-notes" || typeof body.matchNotes === "string") {
    const matchNotes = String(body.matchNotes || "").trim() || null;
    const parsedBudget = parseBudgetFromNotes(matchNotes);
    const req = await prisma.request.findFirst({ where: { id: params.id, shop } });
    if (!req) return cors(Response.json({ error: "Request not found." }, { status: 404 }));
    // Clearing embedding forces a re-embed from the combined description+notes.
    const updated = await prisma.request.update({
      where: { id: req.id },
      data: {
        matchNotes,
        embedding: null,
        matchState: "pending",
        matchError: null,
        ...(parsedBudget != null ? { budget: parsedBudget } : {}),
      },
    });
    await runMatchesForRequest(null, updated).catch((err) => {
      console.error("[pos/notes] re-match failed:", err?.message || err);
    });
    const shaped = await shapeRequest(shop, req.id);
    return cors(Response.json({ ok: true, request: shaped }));
  }

  // ---- Status change ----
  const status = String(body.status || "").trim();
  if (!ALLOWED_STATUS.includes(status)) {
    return cors(Response.json({ error: "Invalid status." }, { status: 400 }));
  }
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

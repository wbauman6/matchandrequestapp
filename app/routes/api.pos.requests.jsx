import { waitUntil } from "@vercel/functions";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runMatchesForRequest } from "../lib/matchRunner.server";

// Create-request endpoint for the POS UI extension. Reuses the exact same create
// + matching path as the admin web app (app._index.jsx): create the Request row,
// then runMatchesForRequest (semantic retrieval + AI reasoning; emails the
// salesperson on high-confidence matches). The `admin` arg to runMatchesForRequest
// is unused, so no Admin API client is needed here.

function shopFromDest(dest) {
  try {
    return new URL(dest).host;
  } catch {
    return String(dest || "").replace(/^https?:\/\//, "");
  }
}

export const action = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  const shop = shopFromDest(sessionToken.dest);

  let body;
  try {
    body = await request.json();
  } catch {
    return cors(Response.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const customerName = String(body.customerName || "").trim();
  const description = String(body.description || "").trim();
  const salespersonName = String(body.salespersonName || "").trim();
  const salespersonEmail = String(body.salespersonEmail || "").trim().toLowerCase();

  if (!customerName || !description || !salespersonEmail) {
    return cors(
      Response.json(
        { error: "Customer name, description, and salesperson are required." },
        { status: 400 },
      ),
    );
  }

  const budgetRaw = String(body.budget ?? "").trim();
  const budget = budgetRaw ? parseFloat(budgetRaw.replace(/[^0-9.]/g, "")) : null;

  const req = await prisma.request.create({
    data: {
      shop,
      customerName,
      customerEmail: String(body.customerEmail || "").trim() || null,
      customerId: String(body.customerId || "").trim() || null,
      salespersonName: salespersonName || salespersonEmail,
      salespersonEmail,
      description,
      keywords: [],
      budget: Number.isFinite(budget) ? budget : null,
      priority: "normal",
      pinned: false,
    },
  });

  // Matching (semantic retrieval + AI reasoning) takes longer than a POS user
  // should wait and can exceed a normal request budget. Run it in the background
  // via waitUntil so the create returns instantly; the function stays alive to
  // finish matching (and email on strong matches). Matches are viewed on the
  // results screen. On non-Vercel runtimes waitUntil is unavailable, so fall
  // back to a detached promise.
  const matchWork = runMatchesForRequest(null, req).catch((err) => {
    console.error("[pos/requests] background matching failed:", err);
  });
  try {
    waitUntil(matchWork);
  } catch {
    void matchWork;
  }

  return cors(Response.json({ ok: true, id: req.id }));
};

// authenticate.pos handles the CORS preflight (OPTIONS) here too.
export const loader = async ({ request }) => {
  const { cors } = await authenticate.pos(request);
  return cors(Response.json({ ok: true }));
};

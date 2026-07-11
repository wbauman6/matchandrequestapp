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

  // TEMP diagnostic — log the raw received body and echo it back so we can see
  // exactly what the POS extension sent. Remove after the submit bug is fixed.
  console.log("[pos/requests] received body:", JSON.stringify(body));
  const received = {
    customerName: body.customerName ?? null,
    customerEmail: body.customerEmail ?? null,
    salespersonName: body.salespersonName ?? null,
    salespersonEmail: body.salespersonEmail ?? null,
    budget: body.budget ?? null,
    description: body.description ?? null,
  };

  const customerName = String(body.customerName || "").trim();
  const description = String(body.description || "").trim();
  const salespersonName = String(body.salespersonName || "").trim();
  const salespersonEmail = String(body.salespersonEmail || "").trim().toLowerCase();

  if (!customerName || !description || !salespersonEmail) {
    return cors(
      Response.json(
        {
          error: "Customer name, description, and salesperson are required.",
          received,
        },
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
      customerId: null,
      salespersonName: salespersonName || salespersonEmail,
      salespersonEmail,
      description,
      keywords: [],
      budget: Number.isFinite(budget) ? budget : null,
      priority: "normal",
      pinned: false,
    },
  });

  let matchCount = 0;
  try {
    matchCount = await runMatchesForRequest(null, req);
  } catch (err) {
    // The request is saved regardless; matching failures shouldn't lose the entry.
    console.error("[pos/requests] matching failed:", err);
  }

  return cors(Response.json({ ok: true, id: req.id, matchCount, received }));
};

// authenticate.pos handles the CORS preflight (OPTIONS) here too.
export const loader = async ({ request }) => {
  const { cors } = await authenticate.pos(request);
  return cors(Response.json({ ok: true }));
};

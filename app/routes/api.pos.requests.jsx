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
      matchState: "pending",
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

// GET /api/pos/requests?staffMemberId=123 — list active requests for the person,
// role-filtered exactly like the admin app: admins see all, salespeople see only
// their own (by salespersonEmail). Includes each request's non-declined matches
// (image, title, price, confidence, reason), ordered in-budget first then score.
// authenticate.pos also handles the CORS preflight (OPTIONS) here.
export const loader = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  const shop = shopFromDest(sessionToken.dest);

  const url = new URL(request.url);
  const staffMemberId = (url.searchParams.get("staffMemberId") || "").trim();

  const salesperson = staffMemberId
    ? await prisma.salesperson.findFirst({ where: { shop, posStaffId: staffMemberId } })
    : null;

  if (!salesperson) {
    return cors(Response.json({ linked: false, role: "salesperson", requests: [] }));
  }

  // Fulfilled requests used to vanish from POS completely — salespeople want
  // to still find them ("what did I sell her last time?"), just not mixed into
  // the working list. They come back here and are reachable via the Fulfilled
  // filter; recent ones only, so the payload stays small on an iPad.
  const FULFILLED_WINDOW_DAYS = 90;
  const fulfilledSince = new Date(Date.now() - FULFILLED_WINDOW_DAYS * 86400000);

  const where = {
    shop,
    // Non-item submissions (services, questions, spam) are handled from the
    // admin page and must never clutter the shop floor.
    requestKind: "item",
    OR: [
      { status: { in: ["active", "pending"] } },
      { status: "fulfilled", updatedAt: { gte: fulfilledSince } },
    ],
  };
  if (salesperson.role !== "admin") {
    where.salespersonEmail = salesperson.email;
  }

  const requests = await prisma.request.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
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
          // Needed for the "Matches to check" filter — without selecting it,
          // every match looks unread (undefined) and the count is wrong.
          read: true,
        },
      },
    },
  });

  const shaped = requests.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    // Storefront submissions carry a phone number the salesperson is expected
    // to call — surfaced with the "customer submitted" flag on POS.
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    source: r.source,
    // Set once a salesperson has actually phoned a website customer, so POS can
    // stop telling everyone to call someone who has already been called.
    calledAt: r.calledAt,
    description: r.description,
    matchNotes: r.matchNotes,
    budget: r.budget,
    salespersonName: r.salespersonName,
    status: r.status,
    matchCount: r.matches.length,
    // Matches nobody has opened yet — drives the "Matches to check" filter.
    unreadCount: r.matches.filter((m) => !m.read).length,
    matches: r.matches,
  }));

  return cors(Response.json({ linked: true, role: salesperson.role, requests: shaped }));
};

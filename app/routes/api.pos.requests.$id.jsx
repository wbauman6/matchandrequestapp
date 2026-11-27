import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runMatchesForRequest, isMatchStalled } from "../lib/matchRunner.server";
import { parseBudgetFromNotes } from "../lib/budget";
import { assessLead } from "../lib/leadQuality.js";
import { followUpFor } from "../lib/nextAction.js";

// The canned instruction intake writes on a vague lead. Once the request has
// been rewritten it is no longer true, and left in place it would be embedded
// and matched on as if the customer had said it.
const VAGUE_NOTE_PREFIX = "Needs to be more specific before we can search.";

async function staffName(shop, staffMemberId) {
  const staffId = String(staffMemberId || "").trim();
  if (!staffId) return null;
  const sp = await prisma.salesperson
    .findFirst({ where: { shop, posStaffId: staffId }, select: { name: true } })
    .catch(() => null);
  return sp?.name || null;
}

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
    // A killed matching pass can't write its own error state, so report a
    // stalled "pending" row as "error" — POS then shows a real outcome rather
    // than a spinner that never resolves.
    matchState: isMatchStalled(r) ? "error" : r.matchState,
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

  // ---- Save the request (description and/or notes) + re-run matching ----
  // "save-notes" is kept as an alias so an older installed extension build keeps
  // working; both paths accept either field.
  if (
    body._action === "save-request" ||
    body._action === "save-notes" ||
    typeof body.matchNotes === "string" ||
    typeof body.description === "string"
  ) {
    const req = await prisma.request.findFirst({ where: { id: params.id, shop } });
    if (!req) return cors(Response.json({ error: "Request not found." }, { status: 404 }));

    // Only touch fields the caller actually sent, so saving a note can't wipe
    // the description (and vice versa).
    const data = { embedding: null, matchState: "pending", matchError: null };

    if (typeof body.description === "string") {
      const description = body.description.trim();
      // The description is what the whole match runs on — never let it be blanked.
      if (!description) {
        return cors(Response.json({ error: "Description can't be empty." }, { status: 400 }));
      }
      data.description = description;
    }

    if (typeof body.matchNotes === "string") {
      data.matchNotes = body.matchNotes.trim() || null;
      const parsedBudget = parseBudgetFromNotes(data.matchNotes);
      if (parsedBudget != null) data.budget = parsedBudget;
    }

    // A vague lead ("stunning earrings") is never matched. The salesperson is
    // told to call and rewrite it — but nothing ever turned it back into an
    // item request, so the rewritten request sat unmatched forever. Re-check
    // it here: once the wording is searchable it becomes a normal request.
    if ((req.requestKind || "item") === "vague") {
      const notes = typeof body.matchNotes === "string" ? data.matchNotes : req.matchNotes;
      const cleanNotes = notes && notes.startsWith(VAGUE_NOTE_PREFIX) ? null : notes;
      const text = [data.description ?? req.description, cleanNotes].filter(Boolean).join(" ");
      if (assessLead(text).ok) {
        data.requestKind = "item";
        data.kindReason = null;
        data.matchNotes = cleanNotes || null;
      }
    }

    // Clearing embedding (above) forces a re-embed from the new description+notes.
    const updated = await prisma.request.update({ where: { id: req.id }, data });
    await runMatchesForRequest(null, updated).catch((err) => {
      console.error("[pos/save] re-match failed:", err?.message || err);
    });
    const shaped = await shapeRequest(shop, req.id);
    return cors(Response.json({ ok: true, request: shaped }));
  }

  // ---- Mark the customer as called (website submissions) ----
  // Scoped by shop so a request belonging to another store can't be touched.
  // `source` is deliberately left alone: "came from the website" is permanent
  // history, "has been called" is current state.
  if (body._action === "mark-called") {
    const undo = body.undo === 1 || body.undo === "1" || body.undo === true;
    // Attribute the call to whoever tapped it, when POS tells us who that is.
    // Best-effort: a missing staff id must not block recording the call.
    let calledBy = null;
    if (!undo) {
      // POS passes the staff id the same way the list endpoint receives it.
      // Best-effort: a missing id must not block recording the call.
      const staffId = String(body.staffMemberId || "").trim();
      if (staffId) {
        const sp = await prisma.salesperson
          .findFirst({ where: { shop, posStaffId: staffId }, select: { name: true } })
          .catch(() => null);
        calledBy = sp?.name || null;
      }
    }
    const result = await prisma.request.updateMany({
      where: { id: params.id, shop },
      data: undo ? { calledAt: null, calledBy: null } : { calledAt: new Date(), calledBy },
    });
    if (result.count === 0) {
      return cors(Response.json({ error: "Request not found." }, { status: 404 }));
    }
    return cors(Response.json({ ok: true, calledAt: undo ? null : new Date().toISOString() }));
  }

  // ---- Record a call and what came of it ----
  // "I called them" could not tell a conversation from a voicemail, so a
  // customer who was never reached looked finished. Three outcomes:
  //   spoke   — reached them. Clears any follow-up.
  //   message — left a voicemail. NOT marked called; comes back tomorrow.
  //   later   — didn't get to it / asked to call back. Comes back tomorrow.
  //   reset   — undo, back to "needs a call".
  if (body._action === "log-call") {
    const outcome = String(body.outcome || "");
    if (!["spoke", "message", "later", "reset"].includes(outcome)) {
      return cors(Response.json({ error: "Unknown call outcome." }, { status: 400 }));
    }
    const now = new Date();
    let data;
    if (outcome === "spoke") {
      data = {
        calledAt: now,
        calledBy: await staffName(shop, body.staffMemberId),
        callOutcome: "spoke",
        followUpAt: null,
      };
    } else if (outcome === "reset") {
      data = { calledAt: null, calledBy: null, callOutcome: null, followUpAt: null };
    } else {
      data = { callOutcome: outcome, followUpAt: followUpFor(outcome, now) };
    }
    const result = await prisma.request.updateMany({ where: { id: params.id, shop }, data });
    if (result.count === 0) {
      return cors(Response.json({ error: "Request not found." }, { status: 404 }));
    }
    return cors(Response.json({ ok: true }));
  }

  // ---- The salesperson has opened the request and seen its matches ----
  // Nothing on POS ever cleared "new", so every match stayed new forever and
  // "New matches" meant "has matches".
  if (body._action === "mark-seen") {
    await prisma.match.updateMany({
      where: { requestId: params.id, shop, read: false, declined: false },
      data: { read: true },
    });
    return cors(Response.json({ ok: true }));
  }

  // ---- Yes / no on an estate piece the appraiser put forward ----
  // Only a yes makes it appraisal work. Scoped by shop AND request so one
  // request's screen cannot decide another's suggestion.
  if (body._action === "estate-decide") {
    const decision = String(body.decision || "");
    if (!["approved", "declined"].includes(decision)) {
      return cors(Response.json({ error: "Unknown decision." }, { status: 400 }));
    }
    const result = await prisma.estateSuggestion.updateMany({
      where: { id: String(body.suggestionId || ""), requestId: params.id, shop, status: "suggested" },
      data: {
        status: decision,
        decidedAt: new Date(),
        decidedBy: await staffName(shop, body.staffMemberId),
      },
    });
    return cors(Response.json({ ok: result.count > 0 }));
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

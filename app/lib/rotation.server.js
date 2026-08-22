import prisma from "../db.server.js";

/**
 * Round-robin assignment for CUSTOMER-SUBMITTED (storefront) requests.
 *
 * Staff-created requests still pick their salesperson explicitly (admin app
 * dropdown / POS pinned staff member). Only the storefront form comes in with
 * nobody attached, so it rotates evenly across the people who opted in.
 *
 * Fairness is held in RotationState.cursor — a per-shop counter bumped
 * atomically by the same INSERT … ON CONFLICT … RETURNING trick the daily cost
 * counters use (app/lib/aiBudget.server.js). Two storefront submissions landing
 * on two serverless instances at the same instant get two different cursor
 * values, so they can never be handed the same slot.
 *
 * The candidate list is ordered by id (stable, and independent of name edits or
 * reactivation order) so a given cursor value maps to the same person on every
 * instance.
 */

// Atomically claim the next cursor value for this shop.
async function nextCursor(shop) {
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "RotationState" (shop, cursor, "updatedAt")
     VALUES ($1, 1, NOW())
     ON CONFLICT (shop) DO UPDATE SET cursor = "RotationState".cursor + 1, "updatedAt" = NOW()
     RETURNING cursor`,
    shop,
  );
  return Number(rows?.[0]?.cursor ?? 1);
}

/**
 * Candidates, best tier first:
 *   1. active + inRotation  — the opted-in rotation (the normal case)
 *   2. active salespeople   — rotation emptied by mistake; still a real person
 *   3. active admins        — last resort so a lead is never dropped on the floor
 *
 * Returns { people, tier }. `tier` !== "rotation" means the shop's rotation is
 * misconfigured and the caller should say so in the logs.
 */
async function candidates(shop) {
  const opted = await prisma.salesperson.findMany({
    where: { shop, active: true, inRotation: true },
    orderBy: { id: "asc" },
  });
  if (opted.length) return { people: opted, tier: "rotation" };

  const sales = await prisma.salesperson.findMany({
    where: { shop, active: true, role: "salesperson" },
    orderBy: { id: "asc" },
  });
  if (sales.length) return { people: sales, tier: "fallback-salespeople" };

  const admins = await prisma.salesperson.findMany({
    where: { shop, active: true, role: "admin" },
    orderBy: { id: "asc" },
  });
  if (admins.length) return { people: admins, tier: "fallback-admins" };

  return { people: [], tier: "none" };
}

/**
 * Pick the next salesperson for a customer-submitted request.
 * Returns { name, email, tier } or null when the shop has NO active staff at
 * all (the caller must then refuse the submission rather than orphan it).
 */
export async function pickNextSalesperson(shop) {
  const { people, tier } = await candidates(shop);
  if (people.length === 0) {
    console.error(`[rotation] ${shop} has no active staff — cannot assign a customer request`);
    return null;
  }
  if (tier !== "rotation") {
    console.warn(
      `[rotation] ${shop}: nobody is opted into the customer-request rotation; falling back to ${tier}`,
    );
  }

  const cursor = await nextCursor(shop);
  const picked = people[(cursor - 1) % people.length];

  // Display/diagnostics only — never read back for fairness.
  prisma.salesperson
    .update({ where: { id: picked.id }, data: { lastAssignedAt: new Date() } })
    .catch((err) => console.error("[rotation] lastAssignedAt update failed:", err?.message || err));

  return { name: picked.name, email: picked.email, tier };
}

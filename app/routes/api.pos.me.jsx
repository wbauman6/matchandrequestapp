import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Identity endpoint for the POS UI extension.
//
// The POS Session API exposes only a numeric `staffMemberId` (the pinned staff
// member), not an email. So the extension sends that id here; we map it to a
// Salesperson row via `posStaffId` (linked once in Settings) and return the
// person's identity + role. Unlinked staff come back as `linked: false`.
//
// Auth: `authenticate.pos(request)` validates the POS session token, handles the
// CORS preflight (OPTIONS), and gives us the shop (`sessionToken.dest`). We only
// read our own DB here, so no Admin API call is needed.

function shopFromDest(dest) {
  try {
    return new URL(dest).host;
  } catch {
    return String(dest || "").replace(/^https?:\/\//, "");
  }
}

async function resolveIdentity(request) {
  const { sessionToken, cors } = await authenticate.pos(request);
  const shop = shopFromDest(sessionToken.dest);

  const url = new URL(request.url);
  const staffMemberId = (url.searchParams.get("staffMemberId") || "").trim();

  let salesperson = null;
  if (staffMemberId) {
    salesperson = await prisma.salesperson.findFirst({
      where: { shop, posStaffId: staffMemberId },
    });
  }

  // TEMP debug — remove after identity mapping is confirmed on the iPad.
  const userId = (url.searchParams.get("userId") || "").trim();
  console.log(
    `[pos/me] dest=${sessionToken.dest} shop=${shop} staffMemberId="${staffMemberId}" userId="${userId}" matched=${salesperson ? salesperson.name + "/" + salesperson.role : "none"}`,
  );

  if (salesperson) {
    // Admins can create a request on behalf of another salesperson, so include
    // the active roster for the picker. (Cheap; only used by the create form.)
    const salespeople = await prisma.salesperson.findMany({
      where: { shop, active: true },
      orderBy: { name: "asc" },
      select: { name: true, email: true, role: true },
    });
    return cors(
      Response.json({
        linked: true,
        staffMemberId,
        salesperson: {
          id: salesperson.id,
          name: salesperson.name,
          email: salesperson.email,
          role: salesperson.role,
          active: salesperson.active,
        },
        salespeople,
      }),
    );
  }

  // Not in our list (or not linked yet). Treat as a salesperson with no
  // requests; the extension shows a "not linked — ask an admin" notice.
  return cors(
    Response.json({
      linked: false,
      staffMemberId,
      role: "salesperson",
    }),
  );
}

// GET /api/pos/me?staffMemberId=123
export const loader = async ({ request }) => resolveIdentity(request);

// Handles the CORS preflight (OPTIONS) — authenticate.pos short-circuits it.
export const action = async ({ request }) => resolveIdentity(request);

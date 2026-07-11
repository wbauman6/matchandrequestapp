import { authenticate, unauthenticated } from "../shopify.server";

// Customer search for the POS UI extension. Mirrors the admin app's
// /api/customers/search (same Shopify Admin `customers` query, name/email/phone),
// but authenticated for POS: authenticate.pos validates the session token, and
// unauthenticated.admin(shop) gives an Admin GraphQL client via the stored
// offline token (POS session tokens can't call the Admin API directly).

function shopFromDest(dest) {
  try {
    return new URL(dest).host;
  } catch {
    return String(dest || "").replace(/^https?:\/\//, "");
  }
}

export const loader = async ({ request }) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  const shop = shopFromDest(sessionToken.dest);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return cors(Response.json({ customers: [] }));

  // Phone-like input searches the phone field with a prefix wildcard; otherwise
  // free-text searches name + email (same behavior as the admin app).
  const isPhone = /^[\d\s\+\-()]+$/.test(q);
  const shopifyQuery = isPhone ? `phone:${q}*` : q;

  let json;
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query SearchCustomers($query: String!) {
        customers(first: 10, query: $query) {
          nodes {
            id
            displayName
            firstName
            lastName
            email
            phone
            defaultAddress { city provinceCode }
          }
        }
      }`,
      { variables: { query: shopifyQuery } },
    );
    json = await response.json();
  } catch (err) {
    console.error("[pos/customers search] error:", err);
    return cors(
      Response.json({
        customers: [],
        error: "Customer search is unavailable.",
      }),
    );
  }

  if (json.errors?.length) {
    const msg = json.errors[0]?.message || "Unknown error";
    console.error("[pos/customers search] GraphQL error:", msg);
    return cors(Response.json({ customers: [], error: msg }));
  }

  const customers = (json.data?.customers?.nodes || []).map((c) => ({
    id: c.id,
    name: c.displayName,
    email: c.email || "",
    phone: c.phone || "",
    city: c.defaultAddress?.city || "",
    province: c.defaultAddress?.provinceCode || "",
  }));

  return cors(Response.json({ customers }));
};

// authenticate.pos handles the CORS preflight (OPTIONS).
export const action = async ({ request }) => {
  const { cors } = await authenticate.pos(request);
  return cors(Response.json({ ok: true }));
};

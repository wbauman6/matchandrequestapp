import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (q.length < 2) return { customers: [] };

  // Build a query that matches name, email, OR phone — same as Shopify POS search.
  // The Shopify customer search query supports: email:, phone:, name:, or free-text.
  // Free-text searches across name and email. For phone we need a separate term.
  const isPhone = /^[\d\s\+\-\(\)]+$/.test(q);
  const shopifyQuery = isPhone ? `phone:${q}*` : q;

  let json;
  try {
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
            defaultAddress {
              city
              provinceCode
            }
          }
        }
      }`,
      { variables: { query: shopifyQuery } },
    );
    json = await response.json();
  } catch (err) {
    console.error("[customers search] GraphQL error:", err);
    return { customers: [], error: "Customer search is unavailable. Check app permissions in Partners Dashboard." };
  }

  // Surface GraphQL-level errors (e.g. Protected Customer Data not approved)
  if (json.errors?.length) {
    const msg = json.errors[0]?.message || "Unknown error";
    console.error("[customers search] GraphQL error:", msg);
    return { customers: [], error: msg };
  }

  const customers = (json.data?.customers?.nodes || []).map((c) => ({
    id: c.id,
    name: c.displayName,
    firstName: c.firstName || "",
    lastName: c.lastName || "",
    email: c.email || "",
    phone: c.phone || "",
    city: c.defaultAddress?.city || "",
    province: c.defaultAddress?.provinceCode || "",
  }));

  return { customers };
};

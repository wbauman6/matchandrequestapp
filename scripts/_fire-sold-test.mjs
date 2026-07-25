import { config } from "dotenv";
config();
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.POSTGRES_URL_NON_POOLING);
const SHOP = "walter-bauman-jewelers.myshopify.com";

const [prod] = await sql.query(
  `SELECT "productId", title, "inStock" FROM "ProductEmbedding" WHERE shop = $1 AND title ILIKE '%grand seiko snowflake%' LIMIT 1`,
  [SHOP],
);
console.log("target:", prod.title, "| inStock =", prod.inStock);

const sessions = await sql.query(`SELECT "accessToken" FROM "Session" WHERE shop = $1 AND "isOnline" = false`, [SHOP]);
let token = null;
for (const s of sessions) {
  const probe = await fetch(`https://${SHOP}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": s.accessToken },
    body: JSON.stringify({ query: "{ shop { name } }" }),
  });
  if ((await probe.json()).data) { token = s.accessToken; break; }
}

const action = process.argv[2] || "add";
const mutation =
  action === "add"
    ? `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`
    : `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`;
const res = await fetch(`https://${SHOP}/admin/api/2025-10/graphql.json`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query: mutation, variables: { id: prod.productId, tags: ["sold-test"] } }),
});
const out = await res.json();
const errs = out.data?.tagsAdd?.userErrors || out.data?.tagsRemove?.userErrors;
console.log(`tag ${action}: ${errs?.length ? JSON.stringify(errs) : "ok"} — products/update webhook will fire`);

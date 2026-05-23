import { useLoaderData, Form, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const req = await prisma.request.findFirst({
    where: { id: params.id, shop: session.shop },
    include: {
      matches: {
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      },
    },
  });
  if (!req) {
    throw new Response("Request not found", { status: 404 });
  }
  return { req };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  const act = data.get("_action");

  if (act === "mark-read") {
    await prisma.match.update({
      where: { id: String(data.get("matchId")) },
      data: { read: true },
    });
  }

  if (act === "mark-all-read") {
    await prisma.match.updateMany({
      where: { requestId: params.id, shop: session.shop, read: false },
      data: { read: true },
    });
  }

  if (act === "status") {
    await prisma.request.update({
      where: { id: params.id },
      data: { status: String(data.get("status")) },
    });
  }

  return null;
};

const PRIORITY_COLOR = {
  urgent: "#d72c0d",
  high: "#e18b00",
  medium: "#005bd3",
  low: "#616161",
};

function scoreColor(score) {
  if (score >= 70) return { bg: "#e3f1df", color: "#1a7a4a" };
  if (score >= 40) return { bg: "#fff5e6", color: "#a85100" };
  return { bg: "#f6f6f7", color: "#616161" };
}

// Convert a Shopify product GID (gid://shopify/Product/123) into an
// App Bridge link that opens the product page in the admin top frame.
function adminProductUrl(productGid) {
  const id = String(productGid || "").split("/").pop();
  return id ? `shopify:admin/products/${id}` : "#";
}

function DetailField({ label, value }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "#6d7175",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#212326" }}>{value}</div>
    </div>
  );
}

function MatchTile({ m }) {
  const { bg, color } = scoreColor(m.score);
  const productHref = adminProductUrl(m.productId);
  return (
    <div
      style={{
        border: `1px solid ${m.read ? "#e1e3e5" : "#005bd3"}`,
        borderRadius: 8,
        padding: 12,
        background: m.read ? "#fff" : "#f3f7fe",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <a
        href={productHref}
        target="_top"
        style={{
          textDecoration: "none",
          color: "inherit",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {m.productImage ? (
          <img
            src={m.productImage}
            alt={m.productTitle}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              objectFit: "cover",
              borderRadius: 4,
              border: "1px solid #e1e3e5",
              cursor: "pointer",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              background: "#f6f6f7",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#c9cccf",
              fontSize: 12,
            }}
          >
            No image
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              lineHeight: 1.3,
              flex: 1,
              color: "#005bd3",
            }}
          >
            {m.productTitle}
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 12,
              background: bg,
              color,
              flexShrink: 0,
            }}
          >
            {m.score}%
          </span>
        </div>

        {m.productPrice != null && (
          <div style={{ fontSize: 15, fontWeight: 700, color: "#212326" }}>
            ${m.productPrice.toLocaleString()}
          </div>
        )}
      </a>

      {m.matchedKeywords.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {m.matchedKeywords.map((kw) => (
            <span
              key={kw}
              style={{
                fontSize: 10,
                padding: "1px 8px",
                borderRadius: 10,
                background: "#e3f1df",
                color: "#1a7a4a",
                fontWeight: 500,
              }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {!m.read && (
        <Form method="post">
          <input type="hidden" name="_action" value="mark-read" />
          <input type="hidden" name="matchId" value={m.id} />
          <button
            type="submit"
            style={{
              width: "100%",
              background: "none",
              border: "1px solid #c9cccf",
              borderRadius: 4,
              padding: "4px 8px",
              fontSize: 12,
              cursor: "pointer",
              color: "#616161",
            }}
          >
            Mark read
          </button>
        </Form>
      )}
    </div>
  );
}

export default function RequestDetailPage() {
  const { req } = useLoaderData();
  const unreadCount = req.matches.filter((m) => !m.read).length;
  const totalBudget = req.budget;

  return (
    <s-page heading={req.customerName} backAction={{ content: "Requests", url: "/app" }}>
      <s-section heading="Request details">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 20,
            marginBottom: req.description || req.keywords.length > 0 ? 20 : 0,
          }}
        >
          <DetailField label="Customer" value={req.customerName} />
          <DetailField label="Customer Email" value={req.customerEmail || "—"} />
          <DetailField label="Salesperson" value={req.salespersonName} />
          <DetailField label="Salesperson Email" value={req.salespersonEmail} />
          <DetailField
            label="Budget"
            value={totalBudget != null ? `$${totalBudget.toLocaleString()}` : "—"}
          />
          <DetailField
            label="Priority"
            value={
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: PRIORITY_COLOR[req.priority] || "#616161",
                }}
              >
                {req.priority}
              </span>
            }
          />
          <DetailField
            label="Status"
            value={
              <span style={{ textTransform: "capitalize" }}>{req.status}</span>
            }
          />
          <DetailField
            label="Created"
            value={new Date(req.createdAt).toLocaleDateString()}
          />
        </div>

        {req.description && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "#6d7175",
                marginBottom: 6,
              }}
            >
              Description
            </div>
            <div style={{ fontSize: 14, color: "#212326" }}>{req.description}</div>
          </div>
        )}

        {req.keywords.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "#6d7175",
                marginBottom: 6,
              }}
            >
              Keywords
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {req.keywords.map((kw) => (
                <span
                  key={kw}
                  style={{
                    fontSize: 12,
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: "#f6f6f7",
                    color: "#414547",
                    fontWeight: 500,
                  }}
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {req.status !== "fulfilled" && (
            <Form method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="status" value="fulfilled" />
              <button
                type="submit"
                style={{
                  background: "#008060",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Mark fulfilled
              </button>
            </Form>
          )}
          {req.status !== "archived" && (
            <Form method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="status" value="archived" />
              <button
                type="submit"
                style={{
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#414547",
                }}
              >
                Archive
              </button>
            </Form>
          )}
          {req.status !== "active" && (
            <Form method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="status" value="active" />
              <button
                type="submit"
                style={{
                  background: "#fff",
                  border: "1px solid #c9cccf",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#005bd3",
                }}
              >
                Reopen
              </button>
            </Form>
          )}
        </div>
      </s-section>

      <s-section
        heading={`Matched products (${req.matches.length}${
          unreadCount > 0 ? `, ${unreadCount} new` : ""
        })`}
      >
        {unreadCount > 0 && (
          <Form method="post" style={{ marginBottom: 16 }}>
            <input type="hidden" name="_action" value="mark-all-read" />
            <button
              type="submit"
              style={{
                background: "none",
                border: "1px solid #c9cccf",
                borderRadius: 4,
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
                color: "#616161",
              }}
            >
              Mark all read ({unreadCount})
            </button>
          </Form>
        )}

        {req.matches.length === 0 ? (
          <p
            style={{
              color: "#6d7175",
              textAlign: "center",
              padding: "40px 0",
              margin: 0,
            }}
          >
            No products matched yet. Try editing the request keywords or check that
            you have in-stock products with matching tags.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {req.matches.map((m) => (
              <MatchTile key={m.id} m={m} />
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return (
    <s-page heading="Request not found">
      <s-section>
        <p style={{ margin: 0 }}>
          That request doesn&apos;t exist or doesn&apos;t belong to your shop.{" "}
          <Link to="/app" style={{ color: "#005bd3" }}>
            Back to Requests
          </Link>
        </p>
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

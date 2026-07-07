import { useLoaderData, Form, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const matches = await prisma.match.findMany({
    where: { shop: session.shop, declined: false, needsReview: false },
    include: {
      request: {
        select: {
          customerName: true,
          salespersonName: true,
          description: true,
          budget: true,
        },
      },
    },
    orderBy: [{ read: "asc" }, { overBudget: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const unreadCount = matches.filter((m) => !m.read).length;
  return { matches, unreadCount };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  const act = data.get("_action");

  if (act === "mark-read") {
    await prisma.match.update({
      where: { id: String(data.get("id")) },
      data: { read: true },
    });
  }

  if (act === "mark-all-read") {
    await prisma.match.updateMany({
      where: { shop: session.shop, read: false, declined: false },
      data: { read: true },
    });
  }

  return null;
};

function scoreColor(score) {
  if (score >= 70) return { bg: "#e3f1df", color: "#1a7a4a" };
  if (score >= 40) return { bg: "#fff5e6", color: "#a85100" };
  return { bg: "#f6f6f7", color: "#616161" };
}

function MatchCard({ m }) {
  const { bg, color } = scoreColor(m.score);
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/app/requests/${m.requestId}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/app/requests/${m.requestId}`);
        }
      }}
      style={{
        border: `1px solid ${m.read ? "#e1e3e5" : "#005bd3"}`,
        borderLeft: m.read ? "1px solid #e1e3e5" : "3px solid #005bd3",
        borderRadius: 8,
        padding: "16px 20px",
        background: m.read ? "#fff" : "#f3f7fe",
        cursor: "pointer",
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      {m.productImage && (
        <img
          src={m.productImage}
          alt={m.productTitle}
          style={{
            width: 64,
            height: 64,
            objectFit: "cover",
            borderRadius: 4,
            flexShrink: 0,
            border: "1px solid #e1e3e5",
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          {!m.read && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#005bd3",
                flexShrink: 0,
                display: "inline-block",
              }}
            />
          )}
          <span style={{ fontWeight: 700, fontSize: 15 }}>{m.productTitle}</span>
          {m.productPrice != null && (
            <span style={{ fontSize: 13, color: "#212326", fontWeight: 600 }}>
              ${m.productPrice.toLocaleString()}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 10px",
              borderRadius: 12,
              background: bg,
              color,
            }}
          >
            {m.score}% match
          </span>
          {m.overBudget && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 10px",
                borderRadius: 12,
                background: "#fff5e6",
                color: "#a85100",
              }}
            >
              Over budget
              {m.request.budget != null && m.productPrice != null
                ? ` · $${(m.productPrice - m.request.budget).toLocaleString()} over`
                : ""}
            </span>
          )}
        </div>

        <div style={{ fontSize: 13, color: "#616161", marginBottom: 8 }}>
          <strong>{m.request.customerName}</strong>
          {m.request.budget != null && ` · budget $${m.request.budget.toLocaleString()}`}
          {m.request.description && ` — ${m.request.description}`}
        </div>

        <div style={{ fontSize: 12, color: "#616161", marginBottom: 8 }}>
          Salesperson: <strong>{m.request.salespersonName}</strong>
        </div>

        {m.matchedKeywords.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {m.matchedKeywords.map((kw) => (
              <span
                key={kw}
                style={{
                  fontSize: 11,
                  padding: "2px 10px",
                  borderRadius: 12,
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
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "#8c9196" }}>
          {new Date(m.createdAt).toLocaleDateString()}
        </span>
        {!m.read && (
          <Form method="post" onClick={(e) => e.stopPropagation()}>
            <input type="hidden" name="_action" value="mark-read" />
            <input type="hidden" name="id" value={m.id} />
            <button
              type="submit"
              onClick={(e) => e.stopPropagation()}
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
              Mark read
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}

export default function MatchesPage() {
  const { matches, unreadCount } = useLoaderData();

  return (
    <s-page heading="Match Alerts">
      {unreadCount > 0 && (
        <Form method="post" style={{ display: "inline" }}>
          <input type="hidden" name="_action" value="mark-all-read" />
          <s-button slot="primary-action" submit>
            Mark all read ({unreadCount})
          </s-button>
        </Form>
      )}

      <s-section heading={`${matches.length} matches · ${unreadCount} unread`}>
        {matches.length === 0 ? (
          <p style={{ color: "#6d7175", textAlign: "center", padding: "40px 0", margin: 0 }}>
            No matches yet. Add requests and inventory will be checked automatically.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {matches.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

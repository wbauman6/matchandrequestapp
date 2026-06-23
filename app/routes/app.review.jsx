import { useLoaderData, Form, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const matches = await prisma.match.findMany({
    where: { shop: session.shop, needsReview: true, declined: false },
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
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return { matches };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const data = await request.formData();
  const act = data.get("_action");
  const id = String(data.get("id"));

  if (act === "confirm") {
    // Promote to a real alert: clear the review flag, mark unread so it shows in
    // the salesperson's Matches inbox.
    await prisma.match.update({
      where: { id },
      data: { needsReview: false, confirmedAt: new Date(), read: false },
    });
  }

  if (act === "dismiss") {
    await prisma.match.update({
      where: { id },
      data: { declined: true, needsReview: false },
    });
  }

  return null;
};

function ReviewCard({ m }) {
  const navigate = useNavigate();
  return (
    <div
      style={{
        border: "1px solid #e1e3e5",
        borderLeft: "3px solid #a85100",
        borderRadius: 8,
        padding: "16px 20px",
        background: "#fffaf3",
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => navigate(`/app/requests/${m.requestId}`)}
            style={{
              fontWeight: 700,
              fontSize: 15,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "#1a1a1a",
              textDecoration: "underline",
            }}
          >
            {m.productTitle}
          </button>
          {m.productPrice != null && (
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              ${m.productPrice.toLocaleString()}
            </span>
          )}
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
            {m.score}% · needs review
          </span>
        </div>

        <div style={{ fontSize: 13, color: "#616161", marginBottom: 6 }}>
          For <strong>{m.request.customerName}</strong>
          {m.request.budget != null &&
            ` · budget $${m.request.budget.toLocaleString()}`}
          {m.request.description && ` — ${m.request.description}`}
        </div>
        <div style={{ fontSize: 12, color: "#616161", marginBottom: 8 }}>
          Salesperson: <strong>{m.request.salespersonName}</strong>
        </div>

        {m.reasoning && (
          <div
            style={{
              fontSize: 12,
              color: "#414547",
              background: "#fff",
              border: "1px solid #f0e2cf",
              borderRadius: 6,
              padding: "8px 10px",
              marginBottom: 8,
            }}
          >
            <strong>Why this is borderline:</strong> {m.reasoning}
          </div>
        )}

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

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Form method="post">
          <input type="hidden" name="_action" value="confirm" />
          <input type="hidden" name="id" value={m.id} />
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
              whiteSpace: "nowrap",
            }}
          >
            Confirm
          </button>
        </Form>
        <Form method="post">
          <input type="hidden" name="_action" value="dismiss" />
          <input type="hidden" name="id" value={m.id} />
          <button
            type="submit"
            style={{
              background: "none",
              color: "#616161",
              border: "1px solid #c9cccf",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Dismiss
          </button>
        </Form>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { matches } = useLoaderData();
  return (
    <s-page heading="Review Queue">
      <s-section heading={`${matches.length} matches to review`}>
        {matches.length === 0 ? (
          <p
            style={{
              color: "#6d7175",
              textAlign: "center",
              padding: "40px 0",
              margin: 0,
            }}
          >
            Nothing to review. Borderline matches will appear here for you to
            confirm or dismiss before the salesperson is alerted.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {matches.map((m) => (
              <ReviewCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

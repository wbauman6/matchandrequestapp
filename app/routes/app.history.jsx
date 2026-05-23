import { useLoaderData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const requests = await prisma.request.findMany({
    where: { shop: session.shop, status: { in: ["fulfilled", "archived"] } },
    include: { _count: { select: { matches: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return { requests };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();

  if (data.get("_action") === "reopen") {
    await prisma.request.update({
      where: { id: String(data.get("id")) },
      data: { status: "active" },
    });
  }

  if (data.get("_action") === "delete") {
    await prisma.request.delete({ where: { id: String(data.get("id")) } });
  }

  return null;
};

const STATUS_STYLE = {
  fulfilled: { bg: "#e3f1df", color: "#1a7a4a" },
  archived: { bg: "#f6f6f7", color: "#616161" },
};

export default function HistoryPage() {
  const { requests } = useLoaderData();

  return (
    <s-page heading="History">
      <s-section heading={`${requests.length} closed requests`}>
        {requests.length === 0 ? (
          <p style={{ color: "#6d7175", textAlign: "center", padding: "40px 0", margin: 0 }}>
            No fulfilled or archived requests yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f6f6f7", textAlign: "left" }}>
                  {["Customer", "Salesperson", "Status", "Keywords", "Matches", "Closed", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 16px",
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          color: "#6d7175",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const { bg, color } = STATUS_STYLE[r.status] || STATUS_STYLE.archived;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #e1e3e5", opacity: 0.85 }}>
                      <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                        {r.customerName}
                        {r.customerEmail && (
                          <div style={{ fontSize: 12, color: "#6d7175", fontWeight: 400 }}>
                            {r.customerEmail}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", color: "#6d7175", fontSize: 13 }}>
                        {r.salespersonName}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            padding: "2px 10px",
                            borderRadius: 12,
                            background: bg,
                            color,
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "#6d7175" }}>
                        {r.keywords.slice(0, 3).join(", ")}
                        {r.keywords.length > 3 && " …"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", color: "#6d7175" }}>
                        {r._count.matches || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "#8c9196" }}>
                        {new Date(r.updatedAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Form method="post">
                            <input type="hidden" name="_action" value="reopen" />
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                fontSize: 12,
                                color: "#005bd3",
                              }}
                            >
                              Reopen
                            </button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="_action" value="delete" />
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                fontSize: 12,
                                color: "#d72c0d",
                              }}
                              onClick={(e) => {
                                if (!confirm("Permanently delete this request?")) e.preventDefault();
                              }}
                            >
                              Delete
                            </button>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

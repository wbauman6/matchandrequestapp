import { useState } from "react";
import { useLoaderData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const salespeople = await prisma.salesperson.findMany({
    where: { shop: session.shop },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  return { salespeople, hasAnthropicKey };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  const act = data.get("_action");

  if (act === "add") {
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    if (!name || !email) {
      return { error: "Name and email are required" };
    }
    try {
      await prisma.salesperson.create({
        data: { shop: session.shop, name, email },
      });
    } catch (err) {
      if (err.code === "P2002") {
        return { error: "A salesperson with that email already exists" };
      }
      throw err;
    }
  }

  if (act === "toggle") {
    const id = String(data.get("id"));
    const sp = await prisma.salesperson.findUnique({ where: { id } });
    if (sp) {
      await prisma.salesperson.update({
        where: { id },
        data: { active: !sp.active },
      });
    }
  }

  if (act === "delete") {
    await prisma.salesperson.delete({
      where: { id: String(data.get("id")) },
    });
  }

  return null;
};

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle = {
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
  display: "block",
};

const btnSecondary = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  color: "#616161",
  padding: "2px 6px",
};

export default function SettingsPage() {
  const { salespeople, hasAnthropicKey } = useLoaderData();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <s-page heading="Settings">
      <s-section heading="AI keyword suggestions">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 14,
            color: "#414547",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: hasAnthropicKey ? "#1a7a4a" : "#d72c0d",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span>
            {hasAnthropicKey
              ? "Anthropic API key detected. The “Suggest from description” button on new requests will use AI to extract keywords."
              : "ANTHROPIC_API_KEY is not set in .env. AI keyword suggestions will be disabled until you add one."}
          </span>
        </div>
      </s-section>

      <s-section heading="Add salesperson">
        <Form
          method="post"
          onSubmit={() => {
            setName("");
            setEmail("");
          }}
        >
          <input type="hidden" name="_action" value="add" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <label style={labelStyle}>Name</label>
              <input
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                placeholder="jane@store.com"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                background: "#008060",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {submitting ? "Saving…" : "Add"}
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading={`Salespeople (${salespeople.length})`}>
        {salespeople.length === 0 ? (
          <p
            style={{
              color: "#6d7175",
              textAlign: "center",
              padding: "30px 0",
              margin: 0,
            }}
          >
            No salespeople yet. Add one above so they show up in the salesperson
            dropdown on new requests.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f6f6f7", textAlign: "left" }}>
                {["Name", "Email", "Status", "Actions"].map((h) => (
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
                ))}
              </tr>
            </thead>
            <tbody>
              {salespeople.map((sp) => (
                <tr key={sp.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 600 }}>{sp.name}</td>
                  <td style={{ padding: "12px 16px", color: "#414547" }}>{sp.email}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        padding: "2px 10px",
                        borderRadius: 12,
                        background: sp.active ? "#e3f1df" : "#f6f6f7",
                        color: sp.active ? "#1a7a4a" : "#616161",
                      }}
                    >
                      {sp.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="_action" value="toggle" />
                        <input type="hidden" name="id" value={sp.id} />
                        <button type="submit" style={btnSecondary}>
                          {sp.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </Form>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="id" value={sp.id} />
                        <button
                          type="submit"
                          style={{ ...btnSecondary, color: "#d72c0d" }}
                          onClick={(e) => {
                            if (!confirm(`Remove ${sp.name} from the salesperson list?`))
                              e.preventDefault();
                          }}
                        >
                          Delete
                        </button>
                      </Form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

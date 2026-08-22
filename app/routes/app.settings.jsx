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
  return { salespeople };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  const act = data.get("_action");

  if (act === "add") {
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const role = String(data.get("role") || "salesperson") === "admin" ? "admin" : "salesperson";
    if (!name || !email) {
      return { error: "Name and email are required" };
    }
    try {
      await prisma.salesperson.create({
        // Storefront requests rotate across salespeople by default; admins are
        // opted out on create and can opt themselves back in below.
        data: { shop: session.shop, name, email, role, inRotation: role !== "admin" },
      });
    } catch (err) {
      if (err.code === "P2002") {
        return { error: "A salesperson with that email already exists" };
      }
      throw err;
    }
  }

  if (act === "set-role") {
    const role = String(data.get("role") || "salesperson") === "admin" ? "admin" : "salesperson";
    await prisma.salesperson.update({
      where: { id: String(data.get("id")) },
      data: { role },
    });
  }

  if (act === "set-pos-id") {
    // The numeric POS staff-member ID that links a salesperson to their POS
    // account. Empty clears the link. Digits only.
    const raw = String(data.get("posStaffId") || "").trim();
    const posStaffId = raw ? raw.replace(/\D/g, "") || null : null;
    await prisma.salesperson.update({
      where: { id: String(data.get("id")) },
      data: { posStaffId },
    });
  }

  if (act === "toggle-rotation") {
    const id = String(data.get("id"));
    const sp = await prisma.salesperson.findUnique({ where: { id } });
    if (sp) {
      await prisma.salesperson.update({
        where: { id },
        data: { inRotation: !sp.inRotation },
      });
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

// Card layout (replaces the wide 7-column table that overflowed the embedded
// admin frame). A CSS auto-fill grid is responsive with NO media queries: one
// card per row in a narrow frame, more as it widens — nothing is ever clipped.
const fieldRow = { display: "flex", flexDirection: "column", gap: 4 };
const fieldLabel = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "#6d7175",
};
const saveBtn = {
  background: "#f1f2f3",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#005bd3",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function SettingsPage() {
  const { salespeople } = useLoaderData();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("salesperson");

  return (
    <s-page heading="Settings">
      <s-section heading="Add salesperson">
        <Form
          method="post"
          onSubmit={() => {
            setName("");
            setEmail("");
            setRole("salesperson");
          }}
        >
          <input type="hidden" name="_action" value="add" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
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
            <div>
              <label style={labelStyle}>Role</label>
              <select
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={inputStyle}
              >
                <option value="salesperson">Salesperson</option>
                <option value="admin">Admin</option>
              </select>
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
        <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 16px" }}>
          <strong>POS Staff ID</strong> links a salesperson to their POS account so
          the Requests tile on the iPad knows who they are. To find someone&apos;s ID,
          have them open the <strong>Requests</strong> tile in POS — it shows their POS
          Staff ID on screen. Paste that number here. Admins see all requests on POS;
          salespeople see only their own.
        </p>
        <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 16px" }}>
          <strong>Online requests</strong> controls the round-robin for requests customers
          submit themselves on the website. Everyone ticked here takes turns, evenly, and
          is expected to <strong>phone</strong> the customer — those requests show a
          &ldquo;Call customer&rdquo; flag in POS and here. New salespeople are included by
          default; admins are not.
        </p>
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {salespeople.map((sp) => (
              <div
                key={sp.id}
                style={{
                  border: "1px solid #e1e3e5",
                  borderRadius: 8,
                  padding: 16,
                  background: sp.active ? "#fff" : "#fafbfb",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  minWidth: 0,
                }}
              >
                {/* Name + status */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#202223", wordBreak: "break-word" }}>
                      {sp.name}
                    </div>
                    <div style={{ fontSize: 13, color: "#6d7175", wordBreak: "break-all" }}>{sp.email}</div>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
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
                </div>

                {/* Role */}
                <div style={fieldRow}>
                  <label style={fieldLabel}>Role</label>
                  <Form method="post">
                    <input type="hidden" name="_action" value="set-role" />
                    <input type="hidden" name="id" value={sp.id} />
                    <select
                      name="role"
                      defaultValue={sp.role}
                      onChange={(e) => e.currentTarget.form.requestSubmit()}
                      style={{ ...inputStyle, padding: "6px 8px" }}
                    >
                      <option value="salesperson">Salesperson</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Form>
                </div>

                {/* POS Staff ID — one clear save action inline with the field */}
                <div style={fieldRow}>
                  <label style={fieldLabel}>POS Staff ID</label>
                  <Form method="post" style={{ display: "flex", gap: 8 }}>
                    <input type="hidden" name="_action" value="set-pos-id" />
                    <input type="hidden" name="id" value={sp.id} />
                    <input
                      name="posStaffId"
                      defaultValue={sp.posStaffId || ""}
                      inputMode="numeric"
                      placeholder="e.g. 1234567"
                      style={{ ...inputStyle, padding: "6px 8px", flex: 1, minWidth: 0 }}
                    />
                    <button type="submit" style={saveBtn}>Save</button>
                  </Form>
                </div>

                {/* Online requests (rotation) */}
                <div style={fieldRow}>
                  <label style={fieldLabel}>Online requests</label>
                  <Form method="post" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="hidden" name="_action" value="toggle-rotation" />
                    <input type="hidden" name="id" value={sp.id} />
                    <input
                      type="checkbox"
                      checked={sp.inRotation}
                      onChange={(e) => e.currentTarget.form.requestSubmit()}
                      aria-label={`Include ${sp.name} in the storefront request rotation`}
                    />
                    <span style={{ fontSize: 12, color: sp.inRotation ? "#1a7a4a" : "#6d7175" }}>
                      {sp.inRotation ? "In rotation" : "Excluded"}
                    </span>
                    {sp.inRotation && sp.lastAssignedAt && (
                      <span style={{ fontSize: 11, color: "#8c9196" }}>
                        · last {new Date(sp.lastAssignedAt).toLocaleDateString()}
                      </span>
                    )}
                  </Form>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 12, borderTop: "1px solid #f1f2f3", paddingTop: 12 }}>
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
                        if (!confirm(`Remove ${sp.name} from the salesperson list?`)) e.preventDefault();
                      }}
                    >
                      Delete
                    </button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

import { waitUntil } from "@vercel/functions";
import { useLoaderData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { runWeeklyDrop } from "../lib/dropRun.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const runs = await prisma.dropRun.findMany({
    where: { shop: session.shop },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  return { runs };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const data = await request.formData();
  if (data.get("_action") === "run-now") {
    // Force a run now (ignores the Tuesday window). Runs in the background so the
    // request returns immediately; the audit row appears as "running" and fills
    // in when it finishes — refresh to see it.
    const work = runWeeklyDrop(session.shop, { force: true, trigger: "manual" }).catch((e) =>
      console.error("[drops] manual run failed:", e?.message || e),
    );
    try { waitUntil(work); } catch { void work; }
  }
  return { started: true };
};

const STATUS = {
  ok: { bg: "#e3f1df", color: "#1a7a4a", label: "OK" },
  partial: { bg: "#fff5e6", color: "#a85100", label: "PARTIAL" },
  failed: { bg: "#fdf3f1", color: "#d72c0d", label: "FAILED" },
  running: { bg: "#eef3ff", color: "#005bd3", label: "RUNNING" },
};

function Stat({ label, value, warn }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: "#6d7175" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: warn ? "#d72c0d" : "#202223" }}>{value}</div>
    </div>
  );
}

function RunCard({ r }) {
  const s = STATUS[r.status] || STATUS.running;
  const when = new Date(r.startedAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const failures = Array.isArray(r.failures) ? r.failures : [];
  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: s.bg, color: s.color, fontWeight: 700, fontSize: 12, padding: "2px 10px", borderRadius: 12 }}>{s.label}</span>
          <span style={{ fontSize: 13, color: "#414547" }}>{when} · {r.trigger}</span>
        </div>
        {r.note ? <span style={{ fontSize: 12, color: "#d72c0d" }}>{r.note}</span> : null}
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Stat label="Detected" value={r.productsDetected} />
        <Stat label="Embedded" value={r.productsEmbedded} />
        <Stat label="Embed fails" value={r.embedFailures} warn={r.embedFailures > 0} />
        <Stat label="Requests" value={r.activeRequests} />
        <Stat label="Evals done" value={`${r.evalsCompleted}/${r.evalsAttempted}`} />
        <Stat label="Eval errors" value={r.evalErrors} warn={r.evalErrors > 0} />
        <Stat label="New matches" value={r.matchesCreated} />
        <Stat label="Queue left" value={r.queueRemaining} warn={r.queueRemaining > 0} />
      </div>
      {failures.length > 0 && (
        <div style={{ marginTop: 12, background: "#fdf3f1", borderRadius: 6, padding: "8px 12px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#d72c0d", marginBottom: 4 }}>Failures / skips ({failures.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#414547" }}>
            {failures.slice(0, 8).map((f, i) => (
              <li key={i}>{[f.stage, f.note || f.error, f.productId].filter(Boolean).join(" — ")}</li>
            ))}
            {failures.length > 8 && <li>…and {failures.length - 8} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DropsPage() {
  const { runs } = useLoaderData();
  const nav = useNavigation();
  const running = nav.state === "submitting";
  return (
    <s-page heading="Weekly drop reports" backAction={{ content: "Requests", url: "/app" }}>
      <s-section heading="Tuesday 4 PM ET inventory-drop matching">
        <p style={{ fontSize: 13, color: "#6d7175", margin: "0 0 16px" }}>
          Each run detects every product changed since the last successful run, embeds and
          evaluates it against <strong>all</strong> active requests, and records exactly what
          happened. A run is <strong>OK</strong> only if nothing failed — otherwise it&apos;s
          flagged and you&apos;re emailed. A request with zero matches here was provably
          evaluated, not silently skipped.
        </p>
        <Form method="post">
          <input type="hidden" name="_action" value="run-now" />
          <button
            type="submit"
            disabled={running}
            style={{ background: "#008060", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.7 : 1 }}
          >
            {running ? "Starting…" : "Run drop now"}
          </button>
        </Form>
        {running && (
          <p style={{ fontSize: 13, color: "#005bd3", marginTop: 10 }}>
            ⏳ Started in the background — refresh in a minute to see the report.
          </p>
        )}
      </s-section>

      <s-section heading={`Recent runs (${runs.length})`}>
        {runs.length === 0 ? (
          <p style={{ color: "#6d7175", textAlign: "center", padding: "30px 0", margin: 0 }}>
            No drop runs yet. The first runs next Tuesday 4 PM ET, or click &ldquo;Run drop now&rdquo;.
          </p>
        ) : (
          runs.map((r) => <RunCard key={r.id} r={r} />)
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (h) => boundary.headers(h);

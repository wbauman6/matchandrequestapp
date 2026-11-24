#!/usr/bin/env node
/**
 * Read-only health report for the live store.
 *
 * Changes nothing, costs nothing (no Anthropic or Voyage calls). Run it before
 * and after any change, and whenever something "looks broken" — most of the
 * failures this app can have are silent, so the only way to notice them is to
 * go and look.
 *
 * Usage: node scripts/diagnose.mjs
 */
import "dotenv/config";
import prisma from "../app/db.server.js";

const PASS = "  ok  ";
const WARN = " warn ";
const FAIL = " FAIL ";
let problems = 0;

function line(tag, msg) {
  if (tag === FAIL) problems++;
  console.log(`[${tag}] ${msg}`);
}
function head(t) {
  console.log(`\n${"=".repeat(64)}\n${t}\n${"=".repeat(64)}`);
}

// Prisma on Windows ARM64 dumps the entire minified wasm bundle before the real
// message. Without this, one bad query makes the whole report unreadable.
function briefError(err) {
  const m = String(err?.message || err);
  const useful = m.split("\n").filter((l) => /error|Unknown|does not exist|column|relation/i.test(l));
  return (useful[0] || m).slice(0, 160);
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    line(FAIL, `${label}: ${briefError(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------- environment
head("ENVIRONMENT");
for (const key of [
  "ANTHROPIC_API_KEY",
  "VOYAGE_API_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "POSTGRES_PRISMA_URL",
]) {
  // Names only — never print a value.
  line(process.env[key] ? PASS : FAIL, `${key} ${process.env[key] ? "present" : "MISSING"}`);
}
const cap = Number(process.env.ANTHROPIC_DAILY_CALL_LIMIT || 500);
line(PASS, `AI daily call cap: ${cap}${process.env.ANTHROPIC_DAILY_CALL_LIMIT ? "" : " (default — not set in .env)"}`);

// -------------------------------------------------------------------- AI spend
head("AI BUDGET");
await safe("daily counters", async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT day, key, count FROM "DailyCounter" ORDER BY day DESC, key LIMIT 12`,
  );
  if (rows.length === 0) {
    line(WARN, "no counters yet — nothing has called the AI");
    return;
  }
  for (const r of rows) {
    // Only the AI-call counter is governed by the cap; email counters are separate.
    const governed = /ai|anthropic|call/i.test(r.key);
    const over = governed && r.count >= cap;
    const d = new Date(r.day).toISOString().slice(0, 10);
    line(over ? FAIL : PASS, `${d}  ${String(r.key).padEnd(14)} ${r.count}${governed ? `/${cap}` : ""}${over ? "  <-- CAP HIT, matching paused" : ""}`);
  }
});

// ------------------------------------------------------------------- requests
head("REQUESTS");
await safe("request states", async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT status, "matchState", count(*)::int n FROM "Request" GROUP BY status, "matchState" ORDER BY n DESC`,
  );
  for (const r of rows) line(PASS, `${String(r.status).padEnd(10)} ${String(r.matchState ?? "null").padEnd(8)} ${r.n}`);

  const errs = await prisma.$queryRawUnsafe(
    `SELECT id, left(description, 55) d, "matchError" FROM "Request" WHERE "matchState" = 'error'`,
  );
  for (const e of errs) {
    line(FAIL, `stuck in error: ${e.id}  "${e.d}"`);
    line(FAIL, `   -> ${String(e.matchError).slice(0, 110)}`);
  }
  if (errs.length === 0) line(PASS, "no requests stuck in error");
});

await safe("stalled matching", async () => {
  const stalled = await prisma.$queryRawUnsafe(
    `SELECT id, left(description,55) d, "updatedAt" FROM "Request"
     WHERE "matchState" = 'pending' AND "updatedAt" < now() - interval '10 minutes'`,
  );
  if (stalled.length === 0) line(PASS, "nothing stalled in pending");
  for (const s of stalled) line(FAIL, `stalled pending: ${s.id} "${s.d}" since ${new Date(s.updatedAt).toISOString()}`);
});

await safe("requests with no matches", async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int n FROM "Request" r
     WHERE r.status = 'active' AND r."matchState" = 'ok'
       AND NOT EXISTS (SELECT 1 FROM "Match" m WHERE m."requestId" = r.id)`,
  );
  const n = rows[0].n;
  line(n > 0 ? WARN : PASS, `${n} active requests with zero matches (watching, or a retrieval gap)`);
});

// -------------------------------------------------------------------- catalog
head("CATALOG");
await safe("catalog coverage", async () => {
  const [tot] = await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM "ProductEmbedding"`);
  line(PASS, `${tot.n} products embedded`);

  const [stock] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int n FROM "ProductEmbedding" WHERE "inStock" = true`,
  );
  line(PASS, `${stock.n} in stock and matchable`);

  const [novec] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int n FROM "ProductEmbedding" WHERE vec IS NULL`,
  );
  line(novec.n > 0 ? FAIL : PASS, `${novec.n} rows missing their pgvector value (unsearchable)`);

  const [med] = await prisma.$queryRawUnsafe(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY length(description))::int m
     FROM "ProductEmbedding" WHERE description IS NOT NULL`,
  );
  // Matching quality depends on description richness. Thin catalogs match badly.
  line(med.m < 200 ? WARN : PASS, `median description length: ${med.m} chars`);
});

// ---------------------------------------------------------------------- email
head("EMAIL");
await safe("digest sending", async () => {
  // NOTE: Match.notifiedAt is dead schema — nothing in the codebase ever writes
  // it, despite the comments describing it as the duplicate-email guard. The
  // REAL evidence that mail went out is the per-salesperson DailyCounter the
  // digest route increments ("digest:<email>"). Checking notifiedAt here would
  // report "email is broken" every single time, which is a false alarm.
  const sends = await prisma.$queryRawUnsafe(
    `SELECT day, key, count FROM "DailyCounter"
     WHERE key LIKE 'digest:%' ORDER BY day DESC LIMIT 8`,
  );
  if (sends.length === 0) {
    line(FAIL, "no digest has ever been sent — check RESEND_API_KEY and the cron");
  } else {
    const last = new Date(sends[0].day);
    const days = Math.floor((Date.now() - last.getTime()) / 86400000);
    line(days > 10 ? FAIL : PASS, `last digest sent ${days} day(s) ago (${last.toISOString().slice(0, 10)})`);
    const recipients = new Set(sends.filter((s) => s.day.getTime() === last.getTime()).map((s) => s.key.slice(7)));
    line(PASS, `that run emailed ${recipients.size} salesperson(s): ${[...recipients].join(", ")}`);
  }

  const [m] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE declined = false AND confidence IN ('high','medium'))::int digestable
     FROM "Match"`,
  );
  line(PASS, `${m.digestable}/${m.total} matches are digest-eligible (high/medium, not declined)`);

  // The digest lists every open request that HAS matches, every run — there is
  // no "new since last time" concept. Worth knowing, not necessarily wrong.
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int n FROM "Request" r
     WHERE r.status IN ('active','pending','in_review')
       AND EXISTS (SELECT 1 FROM "Match" m WHERE m."requestId" = r.id
                   AND m.declined = false AND m.confidence IN ('high','medium'))`,
  );
  line(PASS, `${r.n} requests would appear in the next digest`);
});

// ----------------------------------------------------------------- drop runs
head("DROP RUNS");
await safe("recent drops", async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT status, trigger, "startedAt", "finishedAt", "matchesCreated", "productsEmbedded",
            "evalsAttempted", "queueRemaining"
     FROM "DropRun" ORDER BY "startedAt" DESC LIMIT 5`,
  );
  if (rows.length === 0) line(WARN, "no drop runs recorded");
  for (const r of rows) {
    const when = new Date(r.startedAt).toISOString().slice(0, 16).replace("T", " ");
    const unfinished = !r.finishedAt;
    // "partial" means the run hit its 100s deadline with work left over. One is
    // fine; every run being partial means the queue never drains.
    const bad = r.status === "error" || r.status === "failed" || unfinished;
    line(
      bad ? FAIL : r.status === "partial" ? WARN : PASS,
      `${when}  ${String(r.status).padEnd(7)} (${r.trigger})  embedded=${r.productsEmbedded} evals=${r.evalsAttempted} matches=${r.matchesCreated} left=${r.queueRemaining}${unfinished ? "  <-- never finished" : ""}`,
    );
  }
  const partials = rows.filter((r) => r.status === "partial" || r.status === "failed").length;
  if (partials === rows.length && rows.length > 0) {
    line(FAIL, `every recent drop ended partial/failed — the queue is not draining within the 100s deadline`);
  }
});

await safe("product queue backlog", async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT status, count(*)::int n FROM "ProductQueue" GROUP BY status`,
  );
  const total = rows.reduce((a, b) => a + b.n, 0);
  for (const r of rows) line(PASS, `queue ${r.status}: ${r.n}`);
  // The weekly drop embeds ~600/run. A backlog far above that can never clear.
  line(total > 1500 ? FAIL : total > 500 ? WARN : PASS,
    `${total} products queued — the weekly drop clears roughly 600 per run`);
});

// ---------------------------------------------------------------------- staff
head("SALESPEOPLE");
await safe("roster", async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT name, email, active, "posStaffId" FROM "Salesperson" ORDER BY name`,
  );
  const act = rows.filter((r) => r.active).length;
  line(act === 0 ? FAIL : PASS, `${act} active of ${rows.length} (rotation needs at least one)`);
  const noPos = rows.filter((r) => r.active && !r.posStaffId).length;
  if (noPos > 0) line(WARN, `${noPos} active salespeople have no POS staff id linked`);
});

// --------------------------------------------------------------------- result
head(problems === 0 ? "RESULT: no failures" : `RESULT: ${problems} problem(s) found`);
await prisma.$disconnect();
process.exit(problems > 0 ? 1 : 0);

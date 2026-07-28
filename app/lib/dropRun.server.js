import prisma from "../db.server.js";
import { enqueueProduct, drainProductQueue } from "./productQueue.server.js";
import { sendDropAlertEmail } from "./email.server.js";

const API_VERSION = "2025-10";

// A working offline Admin token for the shop (tokens can go stale; probe them).
async function getWorkingToken(shop) {
  const sessions = await prisma.session.findMany({ where: { shop, isOnline: false } });
  for (const s of sessions) {
    try {
      const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": s.accessToken },
        body: JSON.stringify({ query: "{ shop { name } }" }),
      });
      if ((await res.json()).data) return s.accessToken;
    } catch { /* try next */ }
  }
  return null;
}

// Who gets the failure alert: active admin salespeople + optional ALERT_EMAIL.
async function alertRecipients(shop) {
  const admins = await prisma.salesperson.findMany({
    where: { shop, role: "admin", active: true },
    select: { email: true },
  });
  const list = admins.map((a) => a.email);
  if (process.env.ALERT_EMAIL) list.push(process.env.ALERT_EMAIL);
  return [...new Set(list.filter(Boolean))];
}

function shapeNode(node) {
  const amount = node.priceRangeV2?.minVariantPrice?.amount;
  return {
    id: node.id,
    title: node.title || "",
    description: node.description || "",
    tags: (node.tags || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
    price: amount != null ? parseFloat(amount) : null,
    image: node.featuredImage?.url || null,
    active: true,
    inStock: !node.tracksInventory || (node.totalInventory ?? 0) > 0,
  };
}

async function gqlProducts(shop, token, filter) {
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const QUERY = `query($cursor:String){ products(first:250, after:$cursor, query:${JSON.stringify(filter)}){ pageInfo{hasNextPage endCursor} edges{ node{ id title description tags totalInventory tracksInventory priceRangeV2{minVariantPrice{amount}} featuredImage{url} } } } }`;
  const out = [];
  let cursor = null, hasNext = true;
  while (hasNext) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    });
    const json = await res.json();
    if (!json.data?.products) throw new Error("Shopify products query failed: " + JSON.stringify(json.errors || json).slice(0, 200));
    const page = json.data.products;
    for (const { node } of page.edges) out.push(node);
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

/**
 * Reliable weekly-drop run. Produces a DropRun audit record and guarantees:
 *  - COMPLETE detection: every product changed since the last OK run's watermark
 *    (updated_at ≥ watermark), no cap, all pages — plus active products missing
 *    an embedding (self-heal). The watermark only advances on a fully-OK run, so
 *    a late/skipped/failed run never loses coverage.
 *  - GUARANTEED embedding: the drain retries embeds; any product still without
 *    one is reported (embedFailures) and stays queued.
 *  - ALL active requests evaluated (drain loops every active/pending/in_review
 *    request; the cosine gate only prunes irrelevant pairs, never samples).
 *  - FAILURE ≠ no-match: MatchEval records status ok/error per pair; errored
 *    pairs retry next run; a zero-match request with all-ok pairs is provably
 *    "evaluated, nothing qualified".
 *  - AUDIT + ALERT: persists counts + failure list; emails on partial/failed.
 */
export async function runWeeklyDrop(shop, { force = false, trigger = "cron" } = {}) {
  const startedAt = new Date();
  const lastOk = await prisma.dropRun.findFirst({
    where: { shop, status: "ok" },
    orderBy: { startedAt: "desc" },
  });
  // First run (or none OK yet): cover the last 30 days.
  const since = lastOk?.coverageThrough || new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const run = await prisma.dropRun.create({
    data: { shop, status: "running", trigger, since, startedAt },
  });

  const failures = [];
  const audit = {
    productsDetected: 0, productsEmbedded: 0, embedFailures: 0,
    activeRequests: 0, evalsAttempted: 0, evalsCompleted: 0, evalErrors: 0,
    matchesCreated: 0, queueRemaining: 0,
  };

  try {
    const token = await getWorkingToken(shop);
    if (!token) throw new Error("no working Shopify Admin token (reopen the app to refresh)");

    // 1) DETECTION — changed since watermark (no cap), shaped + enqueued.
    const sinceIso = since.toISOString();
    const changed = await gqlProducts(shop, token, `updated_at:>='${sinceIso}' status:active`);
    audit.productsDetected = changed.length;
    for (const node of changed) {
      await enqueueProduct(shop, shapeNode(node)).catch((e) =>
        failures.push({ stage: "enqueue", productId: node.id, error: String(e?.message || e).slice(0, 200) }),
      );
    }

    // 1b) SELF-HEAL — active products with NO stored embedding (missed webhooks,
    // earlier embed failures). Enqueue them so the drain embeds + evaluates.
    const embeddedIds = new Set(
      (await prisma.productEmbedding.findMany({ where: { shop }, select: { productId: true } })).map((e) => e.productId),
    );
    const changedIds = new Set(changed.map((n) => n.id));
    const allActive = await gqlProducts(shop, token, "status:active");
    let healed = 0;
    for (const node of allActive) {
      if (embeddedIds.has(node.id) || changedIds.has(node.id)) continue;
      await enqueueProduct(shop, shapeNode(node)).catch(() => {});
      healed++;
    }

    // 2+3+4) DRAIN — embed (retry) + evaluate every queued product against every
    // active request, recording eval status per pair.
    const drained = await drainProductQueue(shop, { force });
    audit.embedFailures = drained.embedFailures;
    audit.evalsAttempted = drained.evalsAttempted;
    audit.evalsCompleted = drained.evalsCompleted;
    audit.evalErrors = drained.evalErrors;

    // 5) AUDIT — measure the end state.
    audit.activeRequests = await prisma.request.count({
      where: { shop, status: { in: ["active", "pending", "in_review"] } },
    });
    audit.matchesCreated = await prisma.match.count({ where: { shop, createdAt: { gte: startedAt } } });
    audit.queueRemaining = await prisma.productQueue.count({ where: { shop, status: { in: ["queued", "failed"] } } });
    audit.productsEmbedded = await prisma.productEmbedding.count({ where: { shop, updatedAt: { gte: startedAt } } });

    const parkedFailed = await prisma.productQueue.count({ where: { shop, status: "failed" } });
    if (parkedFailed > 0) failures.push({ stage: "queue", note: `${parkedFailed} product(s) parked as failed after max retries` });
    if (healed > 0) failures.push({ stage: "self-heal", note: `${healed} active product(s) had no embedding and were re-queued` });

    // Status: failed if the drain aborted (budget/dead key); partial if anything
    // was left incomplete; else ok.
    let status = "ok";
    if (drained.aborted) status = "failed";
    else if (drained.embedFailures > 0 || drained.evalErrors > 0 || audit.queueRemaining > 0) status = "partial";

    // Advance the watermark ONLY on a clean run, so a partial/failed run's
    // coverage window is re-scanned next time (nothing falls through).
    const coverageThrough = status === "ok" ? startedAt : since;

    await prisma.dropRun.update({
      where: { id: run.id },
      data: { status, coverageThrough, ...audit, failures: failures.length ? failures : undefined, finishedAt: new Date() },
    });

    if (status !== "ok" && process.env.RESEND_API_KEY) {
      await sendDropAlertEmail({ shop, status, audit, failures, to: await alertRecipients(shop) })
        .catch((e) => console.error("[drop] alert failed:", e?.message || e));
    }
    return { ok: true, runId: run.id, status, ...audit };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 500);
    await prisma.dropRun
      .update({ where: { id: run.id }, data: { status: "failed", note: msg, ...audit, failures, finishedAt: new Date() } })
      .catch(() => {});
    if (process.env.RESEND_API_KEY) {
      await sendDropAlertEmail({ shop, status: "failed", audit, failures, note: msg, to: await alertRecipients(shop) }).catch(() => {});
    }
    return { ok: false, runId: run.id, status: "failed", error: msg };
  }
}

import prisma from "../db.server.js";
import { cosineSimilarity } from "./matching.js";
import {
  embedText,
  buildProductText,
  textHash,
  hasEmbeddingKey,
} from "./embeddings.server.js";
import { reasonMatches, verifyBatch, blendedScore } from "./reasoningMatch.server.js";
import { getRequestEmbedding } from "./matchRunner.server.js";
import { normalizeRequestTerms } from "./jewelryTerms.js";
import { withinBudget, isOverBudget } from "./budget.js";
import { isDropWindow } from "./dropSchedule.js";

// --- Tunables ---------------------------------------------------------------
const RETRIEVAL_GATE = 0.35; // min cosine for a queued product to be judged for a request
const CHUNK = 40; // candidates per batched reasoning call
const CLAIM_BATCH = 100; // queue rows claimed per drain iteration
const MAX_ATTEMPTS = 5; // give up on a queue row after this many failed drains
const CLAIM_TTL_MIN = 3; // minutes before an abandoned claim is reclaimable
const LEASE_MIN = 2; // drain-lock lease length in minutes
const TIME_BUDGET_MS = 90_000; // leave headroom under the 120s function cap

/**
 * Instant-ack side of the webhook: upsert the product event and return. An
 * inactive/archived/deleted product cleans up instead of queueing; a SOLD
 * product (0 available inventory) removes its matches but keeps its embedding
 * flagged out-of-stock so a restock can bring it straight back. A newer event
 * for the same product replaces the queued payload (last-write-wins).
 */
export async function enqueueProduct(shop, product) {
  if (!product?.id) return;
  if (product.active === false) {
    await removeFromMatching(shop, product.id, { gone: true });
    await prisma.productQueue.deleteMany({ where: { shop, productId: product.id } }).catch(() => {});
    return;
  }
  if (product.inStock === false) {
    // SOLD (payload carried tracked inventory showing 0 available): drop its
    // matches everywhere (app, POS, digest all read the Match table), flag the
    // embedding so retrieval skips it, clear MatchEval so a restock
    // re-matches, and skip AI work entirely. Payloads WITHOUT inventory data
    // (inStock undefined) enqueue normally — the drain worker verifies
    // availability against the Admin API before matching.
    await removeFromMatching(shop, product.id, { gone: false });
    await prisma.productQueue.deleteMany({ where: { shop, productId: product.id } }).catch(() => {});
    return;
  }
  await prisma.productQueue.upsert({
    where: { shop_productId: { shop, productId: product.id } },
    update: { payload: product, status: "queued", attempts: 0, claimedAt: null },
    create: { shop, productId: product.id, payload: product, status: "queued" },
  });
}

// Lease-based per-shop mutex: at most one drain worker per shop, so AI
// concurrency is bounded no matter how many webhooks land at once. Returns
// true if acquired. An expired lease (crashed worker) is taken over.
async function acquireDrainLock(shop) {
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "DrainLock" (shop, until) VALUES ($1, now() + interval '${LEASE_MIN} minutes')
     ON CONFLICT (shop) DO UPDATE SET until = now() + interval '${LEASE_MIN} minutes'
     WHERE "DrainLock".until < now()
     RETURNING shop`,
    shop,
  );
  return rows.length > 0;
}

async function renewDrainLock(shop) {
  await prisma.$executeRawUnsafe(
    `UPDATE "DrainLock" SET until = now() + interval '${LEASE_MIN} minutes' WHERE shop = $1`,
    shop,
  );
}

async function releaseDrainLock(shop) {
  await prisma
    .$executeRawUnsafe(`UPDATE "DrainLock" SET until = now() WHERE shop = $1`, shop)
    .catch(() => {});
}

// Claim up to CLAIM_BATCH queued rows (skipping fresh claims by other workers).
async function claimBatch(shop) {
  return prisma.$queryRawUnsafe(
    `UPDATE "ProductQueue" SET "claimedAt" = now(), "updatedAt" = now()
     WHERE id IN (
       SELECT id FROM "ProductQueue"
        WHERE shop = $1 AND status = 'queued'
          AND ("claimedAt" IS NULL OR "claimedAt" < now() - interval '${CLAIM_TTL_MIN} minutes')
        ORDER BY "createdAt"
        LIMIT ${CLAIM_BATCH}
        FOR UPDATE SKIP LOCKED)
     RETURNING id, "productId", payload, attempts`,
    shop,
  );
}

// AUTHORITATIVE availability for a batch of products, in ONE Admin API call.
// Webhook payloads can omit variant inventory fields (scope-dependent), so the
// drain never trusts them: it asks Shopify directly. Returns Map(productId →
// { active, inStock }) — deleted products come back { active: false }. Returns
// null when no working offline token is available (caller falls back to
// treating queued items as in stock; the daily backfill/cron self-corrects).
async function fetchAvailability(shop, productIds) {
  try {
    const sessions = await prisma.session.findMany({ where: { shop, isOnline: false } });
    let data = null;
    for (const sess of sessions) {
      const res = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": sess.accessToken },
        body: JSON.stringify({
          query: `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id status totalInventory tracksInventory } } }`,
          variables: { ids: productIds },
        }),
      });
      const json = await res.json();
      if (json.data?.nodes) { data = json.data.nodes; break; }
    }
    if (!data) return null;
    const map = new Map();
    for (const n of data) {
      if (!n?.id) continue;
      map.set(n.id, {
        active: n.status === "ACTIVE",
        inStock: !n.tracksInventory || (n.totalInventory ?? 0) > 0,
      });
    }
    // Ids Shopify returned nothing for = deleted products.
    for (const id of productIds) if (!map.has(id)) map.set(id, { active: false, inStock: false });
    return map;
  } catch (err) {
    console.error("[drain] availability fetch failed:", err?.message || err);
    return null;
  }
}

/**
 * Mid-week sell-through screening (NO AI): verify the given queued products'
 * availability against the Admin API and clean up any that are sold or gone —
 * so a sale removes its matches within seconds even though matching itself
 * only runs in the weekly drop window. In-stock items stay queued for Tuesday.
 */
export async function screenQueueAvailability(shop, productIds) {
  if (!productIds?.length) return 0;
  const avail = await fetchAvailability(shop, productIds);
  if (!avail) return 0;
  let removed = 0;
  for (const [productId, a] of avail) {
    if (a.active && a.inStock) continue;
    await removeFromMatching(shop, productId, { gone: !a.active });
    await prisma.productQueue.deleteMany({ where: { shop, productId } }).catch(() => {});
    removed++;
  }
  return removed;
}

// Cleanup for a product that is archived/deleted (gone=true) or sold: drop its
// non-declined matches and reasoned-pair records; gone also drops the
// embedding, sold just flags it out-of-stock (kept for restocks).
async function removeFromMatching(shop, productId, { gone }) {
  await prisma.match.deleteMany({ where: { shop, productId, declined: false } });
  await prisma.matchEval.deleteMany({ where: { shop, productId } }).catch(() => {});
  if (gone) {
    await prisma.productEmbedding.deleteMany({ where: { productId } }).catch(() => {});
  } else {
    await prisma.productEmbedding
      .updateMany({ where: { shop, productId }, data: { inStock: false } })
      .catch(() => {});
  }
}

// Ensure a queued product has a stored embedding (re-embed only when its text
// hash changed). Only in-stock products reach this point (enqueueProduct plus
// the drain's authoritative availability check filter sold ones), so this also
// flips inStock back on — covering restocks whose text didn't change. Returns
// the vector or null on failure.
async function ensureProductEmbedding(shop, product) {
  const text = buildProductText(product);
  const hash = textHash(text);
  const existing = await prisma.productEmbedding.findUnique({
    where: { productId: product.id },
    select: { hash: true, embedding: true, inStock: true },
  });
  if (existing && existing.hash === hash) {
    if (!existing.inStock) {
      await prisma.productEmbedding
        .updateMany({ where: { productId: product.id }, data: { inStock: true } })
        .catch(() => {});
    }
    return { vec: existing.embedding, hash };
  }
  const vec = await embedText(text, "document").catch(() => null);
  if (!vec) return null;
  await prisma.productEmbedding.upsert({
    where: { productId: product.id },
    update: { hash, embedding: vec, title: product.title, description: product.description, price: product.price, image: product.image, inStock: true },
    create: { shop, productId: product.id, hash, embedding: vec, title: product.title, description: product.description, price: product.price, image: product.image, inStock: true },
  });
  return { vec, hash };
}

/**
 * Drain the product queue for a shop: claim → batch per request → ONE reasoning
 * call per ~40 candidates (+ one batched verify) → upsert matches + MatchEval.
 * Sends NO email — new matches surface in-app/POS immediately and are announced
 * by the scheduled digest (/api/digest) only. Runs under a per-shop lease so a
 * webhook flood never fans out concurrent AI work; a 3,700-product bulk sync
 * costs ~tens of AI calls per request instead of tens of thousands.
 *
 * Returns { processed, matched, aborted } — aborted is set when the AI budget
 * kill switch (or a dead key) stops work with items still queued.
 *
 * WEEKLY SCHEDULE: inventory only changes at the Tuesday 4 PM ET drop, so the
 * drain refuses to run outside that window (see app/lib/dropSchedule.js) —
 * mid-week product-record churn just accumulates in the queue at zero AI cost
 * and is judged once during the next drop window. Pass { force: true }
 * (manual /api/drain-queue only) to override.
 */
export async function drainProductQueue(shop, { force = false } = {}) {
  const stats = { processed: 0, matched: 0, aborted: false };
  if (!force && !isDropWindow()) return { ...stats, skipped: "outside weekly drop window" };
  if (!hasEmbeddingKey() || !process.env.ANTHROPIC_API_KEY) return stats; // leave queued
  if (!(await acquireDrainLock(shop))) return stats; // another worker is on it

  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    while (Date.now() < deadline) {
      const claimed = await claimBatch(shop);
      if (claimed.length === 0) break;
      await renewDrainLock(shop);
      // Set when the time budget interrupts this claim batch mid-way. The batch
      // is then left claimed (reclaimable after CLAIM_TTL) instead of deleted —
      // pairs already judged are skipped next time via MatchEval, so the redo
      // is cheap and nothing is silently lost.
      let interrupted = false;

      // AUTHORITATIVE availability gate: verify every claimed product against
      // the Admin API (one bulk call). Archived/deleted/sold products are
      // cleaned up and never reach embedding or AI. (If the token is stale and
      // the fetch fails, proceed best-effort — the daily backfill corrects.)
      const avail = await fetchAvailability(shop, claimed.map((r) => r.productId));
      const excludedIds = new Set();
      if (avail) {
        for (const row of claimed) {
          const a = avail.get(row.productId);
          if (a && (!a.active || !a.inStock)) {
            await removeFromMatching(shop, row.productId, { gone: !a.active });
            excludedIds.add(row.id);
          }
        }
        if (excludedIds.size) {
          await prisma.productQueue.deleteMany({ where: { id: { in: [...excludedIds] } } });
          stats.processed += excludedIds.size;
        }
      }

      const items = claimed.filter((r) => !excludedIds.has(r.id)).map((row) => ({ row, product: row.payload }));
      const failedIds = new Set(); // queue row ids to retry later

      // 1) Embeddings (only re-embeds when the product text actually changed).
      const prodInfo = new Map(); // productId -> { vec, hash }
      for (const { row, product } of items) {
        const info = await ensureProductEmbedding(shop, product);
        if (info) prodInfo.set(product.id, info);
        else failedIds.add(row.id);
      }

      // 2) Cheap gates in bulk: existing matches + already-reasoned pairs.
      const productIds = items.map((i) => i.product.id);
      const requests = await prisma.request.findMany({
        where: { shop, status: { in: ["active", "pending", "in_review"] } },
      });
      const existing = await prisma.match.findMany({
        where: { shop, productId: { in: productIds } },
        select: { requestId: true, productId: true },
      });
      const known = new Set(existing.map((m) => `${m.requestId}|${m.productId}`));
      const evals = await prisma.matchEval.findMany({
        where: { shop, productId: { in: productIds } },
        select: { requestId: true, productId: true, productHash: true },
      });
      const evalHash = new Map(evals.map((e) => [`${e.requestId}|${e.productId}`, e.productHash]));

      // 3) Per request: gate → chunked batched reasoning → batched verify.
      for (const request of requests) {
        const reqVec = await getRequestEmbedding(request);
        if (!reqVec) continue;

        const candidates = [];
        for (const { row, product } of items) {
          const info = prodInfo.get(product.id);
          if (!info || failedIds.has(row.id)) continue;
          const key = `${request.id}|${product.id}`;
          if (known.has(key)) continue; // already matched
          if (evalHash.get(key) === info.hash) continue; // already reasoned, unchanged
          if (!withinBudget(request.budget, product.price)) continue;
          const sim = cosineSimilarity(reqVec, info.vec);
          if (sim < RETRIEVAL_GATE) continue;
          candidates.push({ productId: product.id, title: product.title, description: product.description, price: product.price, _rowId: row.id, _hash: info.hash, _image: product.image, _sim: sim });
        }

        const reasoningText = normalizeRequestTerms(request.description || "");
        const notesText = normalizeRequestTerms(request.matchNotes || "");
        for (let i = 0; i < candidates.length; i += CHUNK) {
          const chunk = candidates.slice(i, i + CHUNK);
          let matches;
          try {
            matches = await reasonMatches({
              description: reasoningText,
              notes: notesText,
              budget: null, // budget is a soft ranking factor, never an AI gate
              candidates: chunk,
            });
            if (matches.length > 0) {
              const cById = new Map(chunk.map((c) => [c.productId, c]));
              const pass = await verifyBatch({
                description: reasoningText,
                notes: notesText,
                candidates: matches.map((m) => cById.get(m.productId)).filter(Boolean),
              });
              matches = matches.filter((m) => pass.has(m.productId));
            }
          } catch (err) {
            if (err?.budgetExceeded) {
              // Kill switch: stop ALL work now; items stay queued for tomorrow.
              console.error("[drain] AI budget exhausted — aborting drain:", err.message);
              stats.aborted = true;
              return stats;
            }
            if (err?.status === 401 || err?.status === 403 || err?.status === 400) {
              // Dead key / no credits — nothing will succeed; leave everything queued.
              console.error("[drain] Anthropic unavailable — aborting drain:", err?.message || err);
              stats.aborted = true;
              return stats;
            }
            // Transient chunk failure (already retried): retry these rows next drain.
            console.error("[drain] chunk failed for request", request.id, err?.message || err);
            for (const c of chunk) failedIds.add(c._rowId);
            continue;
          }

          const accepted = new Map(matches.map((m) => [m.productId, m]));
          const dbOps = [];
          for (const c of chunk) {
            const m = accepted.get(c.productId);
            // Record every judged pair (accept AND reject) so this product
            // version is never re-reasoned for this request.
            dbOps.push(
              prisma.matchEval.upsert({
                where: { requestId_productId: { requestId: request.id, productId: c.productId } },
                update: { productHash: c._hash, matched: !!m },
                create: { shop, requestId: request.id, productId: c.productId, productHash: c._hash, matched: !!m },
              }),
            );
            if (m) {
              const overBudget = isOverBudget(request.budget, c.price);
              const needsReview = m.confidence !== "high";
              const score = blendedScore(m.confidence, c._sim);
              stats.matched++;
              dbOps.push(
                prisma.match.upsert({
                  where: { requestId_productId: { requestId: request.id, productId: c.productId } },
                  update: { score, confidence: m.confidence, reasoning: m.reason, needsReview, overBudget, productTitle: c.title, productPrice: c.price, productImage: c._image },
                  create: { shop, requestId: request.id, productId: c.productId, productTitle: c.title, productPrice: c.price, productImage: c._image, score, confidence: m.confidence, reasoning: m.reason, needsReview, overBudget, matchedKeywords: [], declined: false },
                }),
              );
            }
          }
          await Promise.all(dbOps);
          if (Date.now() > deadline) { interrupted = true; break; }
        }
        if (interrupted) break;
      }

      if (interrupted) break; // leave the whole claim batch for the next drain

      // 4) Queue bookkeeping: done rows leave; failed rows retry (capped).
      // (excludedIds were already deleted by the availability gate above.)
      const doneIds = claimed
        .map((r) => r.id)
        .filter((id) => !failedIds.has(id) && !excludedIds.has(id));
      if (doneIds.length) {
        await prisma.productQueue.deleteMany({ where: { id: { in: doneIds } } });
        stats.processed += doneIds.length;
      }
      for (const row of claimed) {
        if (!failedIds.has(row.id)) continue;
        const attempts = row.attempts + 1;
        await prisma.productQueue
          .update({
            where: { id: row.id },
            // Keep claimedAt set so the retry waits out CLAIM_TTL instead of
            // being reclaimed instantly (a transient outage must not burn all
            // attempts in one drain). MAX_ATTEMPTS exhausted → parked as
            // "failed" (no infinite retry fuel).
            data: { attempts, status: attempts >= MAX_ATTEMPTS ? "failed" : "queued" },
          })
          .catch(() => {});
      }
    }
  } finally {
    await releaseDrainLock(shop);
  }
  return stats;
}

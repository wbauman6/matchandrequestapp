// One-time migration for the webhook-queue + cost-kill-switch fixes.
// Raw SQL (not `prisma db push`) so the pgvector column/index/trigger that
// Prisma doesn't know about are never touched.
import { config } from "dotenv";
config();
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.POSTGRES_URL_NON_POOLING);

const steps = [
  ["ProductQueue table", `CREATE TABLE IF NOT EXISTS "ProductQueue" (
    id text PRIMARY KEY,
    shop text NOT NULL,
    "productId" text NOT NULL,
    payload jsonb NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'queued',
    "claimedAt" timestamp(3),
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`],
  ["ProductQueue unique", `CREATE UNIQUE INDEX IF NOT EXISTS "ProductQueue_shop_productId_key" ON "ProductQueue" (shop, "productId")`],
  ["ProductQueue status idx", `CREATE INDEX IF NOT EXISTS "ProductQueue_shop_status_idx" ON "ProductQueue" (shop, status)`],
  ["DrainLock table", `CREATE TABLE IF NOT EXISTS "DrainLock" (
    shop text PRIMARY KEY,
    until timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`],
  ["DailyCounter table", `CREATE TABLE IF NOT EXISTS "DailyCounter" (
    id text PRIMARY KEY,
    day date NOT NULL,
    key text NOT NULL,
    count integer NOT NULL DEFAULT 0
  )`],
  ["DailyCounter unique", `CREATE UNIQUE INDEX IF NOT EXISTS "DailyCounter_day_key_key" ON "DailyCounter" (day, key)`],
  ["Match.notifiedAt", `ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "notifiedAt" timestamp(3)`],
  ["Request.lastMatchEmailAt", `ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "lastMatchEmailAt" timestamp(3)`],
];

for (const [name, ddl] of steps) {
  const t0 = Date.now();
  await sql.query(ddl);
  console.log(`✓ ${name} (${Date.now() - t0}ms)`);
}

// Backfill send-records for matches that already triggered emails (pre-digest
// era emailed every eligible match at creation) so the first digest doesn't
// re-email hundreds of old matches.
const r = await sql.query(
  `UPDATE "Match" SET "notifiedAt"="createdAt" WHERE "notifiedAt" IS NULL AND "needsReview"=false AND "overBudget"=false`,
);
console.log(`✓ backfilled notifiedAt on previously-emailed matches`);
console.log("done");

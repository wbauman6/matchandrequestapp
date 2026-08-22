-- Storefront (customer-submitted) requests.
--
-- The migrations in prisma/migrations are drifted from schema.prisma (later
-- changes were applied with `prisma db push`), so this ships as an idempotent
-- script rather than a Prisma migration that would fight that drift.
--
-- Apply with either:
--   npx prisma db push          (preferred — also regenerates the client)
--   psql "$POSTGRES_URL_NON_POOLING" -f scripts/sql/2026-08-customer-requests.sql
--
-- Safe to run more than once.

BEGIN;

-- Request: callback number + provenance flag.
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'staff';

CREATE INDEX IF NOT EXISTS "Request_shop_source_createdAt_idx"
  ON "Request" ("shop", "source", "createdAt");

-- Salesperson: per-person opt-in to the customer-request rotation.
ALTER TABLE "Salesperson" ADD COLUMN IF NOT EXISTS "inRotation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Salesperson" ADD COLUMN IF NOT EXISTS "lastAssignedAt" TIMESTAMP(3);

-- Backfill: the default is "on for salespeople, off for admins".
UPDATE "Salesperson" SET "inRotation" = false WHERE "role" = 'admin';

CREATE INDEX IF NOT EXISTS "Salesperson_shop_inRotation_active_idx"
  ON "Salesperson" ("shop", "inRotation", "active");

-- Round-robin cursor, one row per shop.
CREATE TABLE IF NOT EXISTS "RotationState" (
  "shop"      TEXT NOT NULL,
  "cursor"    INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RotationState_pkey" PRIMARY KEY ("shop")
);

COMMIT;

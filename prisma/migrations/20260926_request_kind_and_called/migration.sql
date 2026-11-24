-- Request kind (item / service / buying / question / price / spam) and
-- callback tracking for website requests.
--
-- Additive and idempotent. Applied with scripts/apply-sql.mjs, NOT
-- `prisma migrate dev` — this database's migration history is drifted and
-- Prisma would demand a destructive reset.
--
-- Every existing row defaults to 'item', so nothing already in the system
-- changes behaviour. Only new submissions are classified.

ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "requestKind" TEXT NOT NULL DEFAULT 'item';
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "kindReason" TEXT;
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "calledAt" TIMESTAMP(3);
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "calledBy" TEXT;

-- The admin filters read "this shop's non-item requests, newest first".
CREATE INDEX IF NOT EXISTS "Request_shop_requestKind_createdAt_idx"
  ON "Request"("shop", "requestKind", "createdAt");

-- The "needs a call" filter reads website requests that have not been called.
CREATE INDEX IF NOT EXISTS "Request_shop_source_calledAt_idx"
  ON "Request"("shop", "source", "calledAt");

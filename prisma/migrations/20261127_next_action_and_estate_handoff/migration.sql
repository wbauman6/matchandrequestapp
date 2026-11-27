-- Next-action worklist + appraiser handoff.
--
-- Additive and idempotent: every column is nullable (or defaulted) so code
-- already running in production never notices. Apply with:
--   node scripts/apply-sql.mjs prisma/migrations/20261127_next_action_and_estate_handoff/migration.sql

-- What happened on the last call, and when to try again. `calledAt` only ever
-- said "someone tapped the button"; it could not tell a conversation from a
-- voicemail, so a customer who was never actually reached looked finished.
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "callOutcome" TEXT;
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "followUpAt" TIMESTAMP(3);

-- A salesperson's decision on a suggested piece. Until now the only decision
-- that could be recorded was "no" (declined). keptAt is the missing "yes, I
-- want to show this"; declineReason tells the appraiser WHY the suggestions
-- did not work, which is the useful half of the handoff.
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "keptAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "declineReason" TEXT;

-- An estate piece the appraiser has spotted for a specific request, BEFORE it
-- is appraised. The salesperson says yes or no; only a yes makes it appraisal
-- work. status: suggested | approved | declined | appraised
CREATE TABLE IF NOT EXISTS "EstateSuggestion" (
  "id"          TEXT NOT NULL,
  "shop"        TEXT NOT NULL,
  "requestId"   TEXT NOT NULL,
  "location"    TEXT NOT NULL,
  "note"        TEXT,
  "status"      TEXT NOT NULL DEFAULT 'suggested',
  "decidedBy"   TEXT,
  "decidedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstateSuggestion_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EstateSuggestion_requestId_fkey'
  ) THEN
    ALTER TABLE "EstateSuggestion"
      ADD CONSTRAINT "EstateSuggestion_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "Request"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "EstateSuggestion_shop_status_idx" ON "EstateSuggestion"("shop", "status");
CREATE INDEX IF NOT EXISTS "EstateSuggestion_requestId_idx" ON "EstateSuggestion"("requestId");

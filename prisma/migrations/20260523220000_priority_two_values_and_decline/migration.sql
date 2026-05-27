-- Migrate Priority enum from (low, medium, high, urgent) → (normal, urgent)

-- Step 1: Drop the existing default so ALTER TYPE can proceed
ALTER TABLE "Request" ALTER COLUMN "priority" DROP DEFAULT;

-- Step 2: Create the new two-value type
CREATE TYPE "Priority_new" AS ENUM ('normal', 'urgent');

-- Step 3: Swap the column — low/medium/high all become normal, urgent stays urgent
ALTER TABLE "Request"
  ALTER COLUMN "priority" TYPE "Priority_new"
  USING (
    CASE
      WHEN "priority"::text = 'urgent' THEN 'urgent'::"Priority_new"
      ELSE 'normal'::"Priority_new"
    END
  );

-- Step 4: Set the new default
ALTER TABLE "Request"
  ALTER COLUMN "priority" SET DEFAULT 'normal'::"Priority_new";

-- Step 5: Replace old enum
DROP TYPE "Priority";
ALTER TYPE "Priority_new" RENAME TO "Priority";

-- Add declined flag to Match
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "declined" BOOLEAN NOT NULL DEFAULT false;

-- Add lastReminderAt to Request
ALTER TABLE "Request" ADD COLUMN IF NOT EXISTS "lastReminderAt" TIMESTAMP(3);

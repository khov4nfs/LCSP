-- Repair schema drift where the LCSP-311 migration is recorded as applied
-- but its runtime policy snapshot table or dependent objects are missing.
-- This is additive and a no-op for databases with the complete schema.
CREATE TABLE IF NOT EXISTS "RuntimeModelPolicySnapshot" (
  "id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeModelPolicySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RuntimeModelPolicySnapshot_role_policyVersion_key"
  ON "RuntimeModelPolicySnapshot"("role", "policyVersion");
CREATE INDEX IF NOT EXISTS "RuntimeModelPolicySnapshot_role_effectiveAt_idx"
  ON "RuntimeModelPolicySnapshot"("role", "effectiveAt");

ALTER TABLE "LlmUsageEvent"
  ADD COLUMN IF NOT EXISTS "runtimePolicySnapshotId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LlmUsageEvent_runtimePolicySnapshotId_fkey'
      AND conrelid = '"LlmUsageEvent"'::regclass
  ) THEN
    ALTER TABLE "LlmUsageEvent"
      ADD CONSTRAINT "LlmUsageEvent_runtimePolicySnapshotId_fkey"
      FOREIGN KEY ("runtimePolicySnapshotId")
      REFERENCES "RuntimeModelPolicySnapshot"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "prevent_runtime_model_policy_snapshot_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RuntimeModelPolicySnapshot rows are append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'RuntimeModelPolicySnapshot_immutable'
      AND tgrelid = '"RuntimeModelPolicySnapshot"'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER "RuntimeModelPolicySnapshot_immutable"
    BEFORE UPDATE OR DELETE ON "RuntimeModelPolicySnapshot"
    FOR EACH ROW EXECUTE FUNCTION "prevent_runtime_model_policy_snapshot_mutation"();
  END IF;
END $$;

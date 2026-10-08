-- W6: coordination ledger for the SEPARATE, explicit re-evaluation phase (expand-only).
-- It records which migrated assessment an operator deliberately started; it never stores execution,
-- completion or failure, which stay canonical.

-- CreateEnum
CREATE TYPE "LegacyReevaluationMode" AS ENUM ('CANARY', 'BATCH');

-- CreateTable
CREATE TABLE "LegacyReevaluation" (
    "assessmentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" UUID NOT NULL,
    "mode" "LegacyReevaluationMode" NOT NULL,
    "startedBy" TEXT NOT NULL,
    "rootCommandId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyReevaluation_pkey" PRIMARY KEY ("assessmentId")
);

-- CreateIndex
CREATE INDEX "LegacyReevaluation_runId_startedAt_idx" ON "LegacyReevaluation"("runId", "startedAt");

-- CreateIndex
CREATE INDEX "LegacyReevaluation_ownerId_startedAt_idx" ON "LegacyReevaluation"("ownerId", "startedAt");

-- AddForeignKey
ALTER TABLE "LegacyReevaluation" ADD CONSTRAINT "LegacyReevaluation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LegacyAssessmentArchive"("assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegacyReevaluation" ADD CONSTRAINT "LegacyReevaluation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LegacyMigrationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Integrity layer (hand-written).
-- ---------------------------------------------------------------------------------------------

-- A start is always attributable.
ALTER TABLE "LegacyReevaluation"
  ADD CONSTRAINT "LegacyReevaluation_started_by_check" CHECK (length(btrim("startedBy")) > 0);

-- Only an assessment that the migration backfilled (never an archived terminal one, never a V2-native
-- one) can be re-evaluated through this ledger.
CREATE FUNCTION "lcsp_legacy_reevaluation_requires_backfilled"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LegacyAssessmentArchive" s
     WHERE s."assessmentId" = NEW."assessmentId" AND s.disposition = 'BACKFILLED_NON_TERMINAL'
  ) THEN
    RAISE EXCEPTION 'assessment % was not backfilled by the migration and cannot be re-evaluated through the ledger', NEW."assessmentId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LegacyReevaluation_requires_backfilled"
  BEFORE INSERT ON "LegacyReevaluation"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legacy_reevaluation_requires_backfilled"();

-- The ledger is an audit trail of deliberate starts: it is never rewritten.
CREATE TRIGGER "LegacyReevaluation_immutable"
  BEFORE UPDATE ON "LegacyReevaluation"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legacy_archive_immutable"();

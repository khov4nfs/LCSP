-- Multi-repository Assessment, phase 1: additive repository-set model plus backfill.
-- Every existing single-repository case becomes a set of one (ordinal 0). Old scalar pin columns stay
-- and keep being written until the cleanup phase; new set columns are nullable so older writers keep working.

-- AlterTable
ALTER TABLE "AssessmentCase"
  ADD COLUMN "repositorySetDigest" TEXT,
  ADD COLUMN "repositoryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AssessmentEvidence" ADD COLUMN "repositoryKey" TEXT;

-- AlterTable
ALTER TABLE "AssessmentRuleDecision" ADD COLUMN "repositorySetDigest" TEXT;

-- AlterTable
ALTER TABLE "AssessmentRuleAuditRequest" ADD COLUMN "repositorySetDigest" TEXT;

-- AlterTable
ALTER TABLE "AssessmentArtifact" ADD COLUMN "repositorySetDigest" TEXT;

-- AlterTable
ALTER TABLE "AssessmentDiscoveryRun"
  ADD COLUMN "repositoryKey" TEXT,
  ADD COLUMN "discoveryBatchId" UUID;

-- CreateTable
CREATE TABLE "AssessmentCaseRepository" (
    "assessmentId" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "connectionId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "repositorySnapshotId" TEXT NOT NULL,
    "repositoryScanJobId" TEXT NOT NULL,
    "repositoryCommit" TEXT NOT NULL,
    "sourcePathPrefix" TEXT,
    "pinnedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentCaseRepository_pkey" PRIMARY KEY ("assessmentId","repositoryKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCaseRepository_assessmentId_ordinal_key" ON "AssessmentCaseRepository"("assessmentId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCaseRepository_assessmentId_repositorySnapshotId_key" ON "AssessmentCaseRepository"("assessmentId", "repositorySnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCaseRepository_assessmentId_repositoryKey_reposit_key" ON "AssessmentCaseRepository"("assessmentId", "repositoryKey", "repositoryCommit");

-- CreateIndex
CREATE INDEX "AssessmentCaseRepository_repositorySnapshotId_idx" ON "AssessmentCaseRepository"("repositorySnapshotId");

-- CreateIndex
CREATE INDEX "AssessmentEvidence_assessmentId_repositoryKey_state_idx" ON "AssessmentEvidence"("assessmentId", "repositoryKey", "state");

-- AddForeignKey
ALTER TABLE "AssessmentCaseRepository" ADD CONSTRAINT "AssessmentCaseRepository_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
-- CASCADE (not NO ACTION/RESTRICT): an Assessment delete removes its snapshots and, one level deeper, its pins;
-- PostgreSQL checks a NO ACTION reference on the snapshot before the deeper cascade has removed the pin, which
-- blocks deleting the Assessment. A snapshot only disappears through that cascade; if one were ever removed
-- alone, the set fails closed (repositoryCount/digest no longer match) rather than silently shrinking.
ALTER TABLE "AssessmentCaseRepository" ADD CONSTRAINT "AssessmentCaseRepository_repositorySnapshotId_fkey" FOREIGN KEY ("repositorySnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- The execution writer fence rejects writes from any role other than the fenced Assessment's writer. This
-- migration runs as the deployer, so the fence is suspended on exactly the tables backfilled below and
-- restored right after, inside the same transaction.
ALTER TABLE "AssessmentCase" DISABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentEvidence" DISABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentRuleDecision" DISABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentRuleAuditRequest" DISABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentArtifact" DISABLE TRIGGER lcsp_execution_writer_fence;

-- Backfill: one pin (ordinal 0) per case that already carries a complete scalar pin.
-- The key is the lower-case slug of the repository name (same rule as deriveRepositoryKey in @lcsp/contracts).
INSERT INTO "AssessmentCaseRepository" (
  "assessmentId", "repositoryKey", "ordinal", "connectionId", "repositoryId", "repositoryFullName",
  "repositorySnapshotId", "repositoryScanJobId", "repositoryCommit", "sourcePathPrefix"
)
SELECT
  c."assessmentId",
  COALESCE(
    NULLIF(btrim(left(btrim(regexp_replace(lower(regexp_replace(s."repositoryFullName", '^.*/', '')), '[^a-z0-9]+', '-', 'g'), '-'), 40), '-'), ''),
    'repo'
  ),
  0,
  s."connectionId",
  s."repositoryId",
  s."repositoryFullName",
  s."id",
  c."repositoryScanJobId",
  c."repositoryCommit",
  s."sourcePathPrefix"
FROM "AssessmentCase" c
JOIN "RepositorySnapshot" s
  ON s."id" = c."repositorySnapshotId" AND s."assessmentId" = c."assessmentId"
WHERE c."repositorySnapshotId" IS NOT NULL
  AND c."repositoryScanJobId" IS NOT NULL
  AND c."repositoryCommit" IS NOT NULL;

-- Backfill: set digest (canonical compact JSON, identical to computeRepositorySetDigest) and count.
UPDATE "AssessmentCase" c
SET
  "repositoryCount" = 1,
  "repositorySetDigest" = 'sha256:' || encode(
    sha256(convert_to(
      '[[' || to_json(r."repositoryKey"::text)::text
      || ',' || to_json(r."repositorySnapshotId"::text)::text
      || ',' || to_json(lower(r."repositoryCommit")::text)::text
      || ',' || COALESCE(to_json(r."sourcePathPrefix"::text)::text, 'null')
      || ']]',
      'UTF8'
    )),
    'hex'
  )
FROM "AssessmentCaseRepository" r
WHERE r."assessmentId" = c."assessmentId" AND r."ordinal" = 0;

-- Backfill children from the ordinal-0 pin. Rows that do not match the pin stay NULL on purpose.
-- Discovery records and expansions are immutable by trigger, so they are not touched: their repository is
-- derived from repositorySnapshotId (unique per assessment in AssessmentCaseRepository).
UPDATE "AssessmentEvidence" e
SET "repositoryKey" = r."repositoryKey"
FROM "AssessmentCaseRepository" r
WHERE r."assessmentId" = e."assessmentId" AND r."ordinal" = 0 AND r."repositoryCommit" = e."repositoryCommit";

UPDATE "AssessmentDiscoveryRun" x
SET "repositoryKey" = r."repositoryKey"
FROM "AssessmentCaseRepository" r
WHERE r."assessmentId" = x."assessmentId" AND r."ordinal" = 0 AND r."repositorySnapshotId" = x."repositorySnapshotId";

UPDATE "AssessmentRuleDecision" x
SET "repositorySetDigest" = c."repositorySetDigest"
FROM "AssessmentCase" c
JOIN "AssessmentCaseRepository" r ON r."assessmentId" = c."assessmentId" AND r."ordinal" = 0
WHERE c."assessmentId" = x."assessmentId" AND c."repositorySetDigest" IS NOT NULL AND r."repositoryCommit" = x."repositoryCommit";

UPDATE "AssessmentRuleAuditRequest" x
SET "repositorySetDigest" = c."repositorySetDigest"
FROM "AssessmentCase" c
JOIN "AssessmentCaseRepository" r ON r."assessmentId" = c."assessmentId" AND r."ordinal" = 0
WHERE c."assessmentId" = x."assessmentId" AND c."repositorySetDigest" IS NOT NULL
  AND r."repositorySnapshotId" = x."repositorySnapshotId" AND r."repositoryCommit" = x."repositoryCommit";

UPDATE "AssessmentArtifact" x
SET "repositorySetDigest" = c."repositorySetDigest"
FROM "AssessmentCase" c
JOIN "AssessmentCaseRepository" r ON r."assessmentId" = c."assessmentId" AND r."ordinal" = 0
WHERE c."assessmentId" = x."assessmentId" AND c."repositorySetDigest" IS NOT NULL
  AND r."repositorySnapshotId" = x."repositorySnapshotId" AND r."repositoryCommit" = x."repositoryCommit";

ALTER TABLE "AssessmentCase" ENABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentEvidence" ENABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentRuleDecision" ENABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentRuleAuditRequest" ENABLE TRIGGER lcsp_execution_writer_fence;
ALTER TABLE "AssessmentArtifact" ENABLE TRIGGER lcsp_execution_writer_fence;

-- AddForeignKey (after backfill so evidence is validated against pins that now exist)
ALTER TABLE "AssessmentEvidence" ADD CONSTRAINT "AssessmentEvidence_assessmentId_repositoryKey_repositoryCo_fkey" FOREIGN KEY ("assessmentId", "repositoryKey", "repositoryCommit") REFERENCES "AssessmentCaseRepository"("assessmentId", "repositoryKey", "repositoryCommit") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- Fail the migration rather than ship a half-backfilled set.
DO $$
DECLARE missing INTEGER;
BEGIN
  SELECT count(*) INTO missing
  FROM "AssessmentCase" c
  WHERE c."repositorySnapshotId" IS NOT NULL
    AND c."repositoryScanJobId" IS NOT NULL
    AND c."repositoryCommit" IS NOT NULL
    AND (c."repositorySetDigest" IS NULL OR c."repositoryCount" <> 1
         OR NOT EXISTS (SELECT 1 FROM "AssessmentCaseRepository" r WHERE r."assessmentId" = c."assessmentId"));
  IF missing > 0 THEN
    RAISE EXCEPTION 'assessment_case_repository_set backfill incomplete for % case(s)', missing;
  END IF;
END $$;

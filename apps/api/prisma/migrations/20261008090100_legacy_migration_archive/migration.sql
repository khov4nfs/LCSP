-- CreateEnum
CREATE TYPE "LegacyMigrationRunKind" AS ENUM ('REHEARSAL', 'CUTOVER');

-- CreateEnum
CREATE TYPE "LegacyMigrationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LegacyAssessmentDisposition" AS ENUM ('ARCHIVED_TERMINAL', 'BACKFILLED_NON_TERMINAL');

-- CreateEnum
CREATE TYPE "LegacyArchiveSource" AS ENUM ('ASSESSMENT', 'ASSESSMENT_INTERVIEW_THREAD', 'ENGINEERING_RULE_ASSESSMENT', 'ASSESSMENT_RUNTIME_TURN', 'ASSESSMENT_RUNTIME_EVENT', 'PIPELINE_RECONCILIATION', 'REPOSITORY_SCAN_JOB', 'TECHNICAL_EVIDENCE_REPORT', 'TECHNICAL_PROFILE', 'AI_USAGE_FLOW', 'CONFLICT_RECORD', 'TARGETED_REANALYSIS_REQUEST', 'TARGETED_REANALYSIS_CHECKPOINT', 'VERIFIED_AGENT_EPISODE', 'VERIFIED_PROFILE', 'CLASSIFICATION_RESULT', 'CLASSIFICATION_REVIEW_REQUEST', 'LEGAL_RULE_MATCH', 'DOCUMENT_REQUEST', 'READINESS_EXPORT', 'DECISION_MODEL_DECISION', 'DECISION_MODEL_EVENT', 'LEGAL_RULE_CATALOG_VERSION', 'LEGAL_RULE', 'RULE_APPROVAL_RECORD', 'CORPUS_APPROVAL_RECORD', 'CORPUS_DISCARD_RECEIPT', 'CORPUS_PREPARATION', 'OUTBOX_MESSAGE_CANCELLED', 'FILESYSTEM_ARTIFACT');

-- CreateEnum
CREATE TYPE "LegacyArtifactReconciliationClass" AS ENUM ('ARTIFACT_PRESENT_AND_COPIED', 'ARTIFACT_PRESENT_BUT_COPY_FAILED', 'NO_LEGACY_ARTIFACT_PRESENT', 'METADATA_ONLY_LEGACY_RECORD', 'INVALID_OR_ORPHANED_LEGACY_REFERENCE');

-- CreateEnum
CREATE TYPE "LegacyArtifactReconciliationReason" AS ENUM ('COPIED_AND_VERIFIED', 'INLINE_CONTENT_ARCHIVED', 'PLACEHOLDER_UPLOADER_NEVER_PERSISTED', 'OPERATOR_ATTESTED_NON_PERSISTING', 'NO_ARTIFACT_REFERENCE', 'READY_WITHOUT_REFERENCE', 'NO_INLINE_CONTENT', 'MALFORMED_REFERENCE', 'UNSUPPORTED_REFERENCE_SCHEME', 'REFERENCE_OUTSIDE_ALLOWED_ROOT', 'REFERENCE_TARGET_MISSING', 'LOCATION_NOT_CONFIGURED', 'COPY_IO_ERROR', 'COPY_SIZE_LIMIT_EXCEEDED', 'COPY_VERIFICATION_MISMATCH');

-- CreateTable
CREATE TABLE "LegacyMigrationRun" (
    "id" UUID NOT NULL,
    "kind" "LegacyMigrationRunKind" NOT NULL,
    "status" "LegacyMigrationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "toolVersion" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "phaseResults" JSONB NOT NULL DEFAULT '{}',
    "restorePointRef" TEXT,
    "restorePointDigest" TEXT,
    "restorePointRecordedAt" TIMESTAMPTZ(3),
    "restorePointVerifiedAt" TIMESTAMPTZ(3),
    "restoreBoundaryClosedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LegacyMigrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyAssessmentArchive" (
    "assessmentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "disposition" "LegacyAssessmentDisposition" NOT NULL,
    "legacyStatus" "AssessmentStatus" NOT NULL,
    "legacyCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "legacyUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "v2ThreadId" UUID,
    "v2LifecycleState" "AssessmentLifecycleState",
    "archiveRunId" UUID NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "archivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyAssessmentArchive_pkey" PRIMARY KEY ("assessmentId")
);

-- CreateTable
CREATE TABLE "LegacyArchiveRecord" (
    "id" UUID NOT NULL,
    "archiveRunId" UUID NOT NULL,
    "assessmentId" TEXT,
    "sourceTable" "LegacyArchiveSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "reconciliationClass" "LegacyArtifactReconciliationClass",
    "reconciliationReason" "LegacyArtifactReconciliationReason",
    "archivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyArchiveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyArchiveBlob" (
    "recordId" UUID NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageRef" TEXT NOT NULL,
    "mediaType" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyArchiveBlob_pkey" PRIMARY KEY ("recordId")
);

-- CreateIndex
CREATE INDEX "LegacyMigrationRun_kind_startedAt_idx" ON "LegacyMigrationRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "LegacyAssessmentArchive_ownerId_archivedAt_idx" ON "LegacyAssessmentArchive"("ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "LegacyAssessmentArchive_archiveRunId_idx" ON "LegacyAssessmentArchive"("archiveRunId");

-- CreateIndex
CREATE INDEX "LegacyArchiveRecord_assessmentId_sourceTable_idx" ON "LegacyArchiveRecord"("assessmentId", "sourceTable");

-- CreateIndex
CREATE INDEX "LegacyArchiveRecord_archiveRunId_sourceTable_idx" ON "LegacyArchiveRecord"("archiveRunId", "sourceTable");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyArchiveRecord_sourceTable_sourceId_key" ON "LegacyArchiveRecord"("sourceTable", "sourceId");

-- AddForeignKey
ALTER TABLE "LegacyAssessmentArchive" ADD CONSTRAINT "LegacyAssessmentArchive_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegacyAssessmentArchive" ADD CONSTRAINT "LegacyAssessmentArchive_archiveRunId_fkey" FOREIGN KEY ("archiveRunId") REFERENCES "LegacyMigrationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegacyArchiveRecord" ADD CONSTRAINT "LegacyArchiveRecord_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegacyArchiveRecord" ADD CONSTRAINT "LegacyArchiveRecord_archiveRunId_fkey" FOREIGN KEY ("archiveRunId") REFERENCES "LegacyMigrationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LegacyArchiveBlob" ADD CONSTRAINT "LegacyArchiveBlob_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "LegacyArchiveRecord"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- W6 integrity layer (hand-written). Expand-only: no existing V1 table or column is changed.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "LegacyArchiveRecord"
  ADD CONSTRAINT "LegacyArchiveRecord_payload_sha256_check"
    CHECK ("payloadSha256" ~ '^[0-9a-f]{64}$'),
  -- Report-related sources carry a reconciliation outcome; every other source carries none.
  ADD CONSTRAINT "LegacyArchiveRecord_reconciliation_presence_check" CHECK (
    ("sourceTable" IN ('DOCUMENT_REQUEST', 'READINESS_EXPORT')
       AND "reconciliationClass" IS NOT NULL AND "reconciliationReason" IS NOT NULL)
    OR ("sourceTable" NOT IN ('DOCUMENT_REQUEST', 'READINESS_EXPORT')
       AND "reconciliationClass" IS NULL AND "reconciliationReason" IS NULL)
  ),
  -- A class can only carry the reasons that truthfully explain it (no "copied" with a placeholder reason).
  ADD CONSTRAINT "LegacyArchiveRecord_reconciliation_pairing_check" CHECK (
    "reconciliationClass" IS NULL
    OR ("reconciliationClass" = 'ARTIFACT_PRESENT_AND_COPIED'
        AND "reconciliationReason" IN ('COPIED_AND_VERIFIED', 'INLINE_CONTENT_ARCHIVED'))
    OR ("reconciliationClass" = 'ARTIFACT_PRESENT_BUT_COPY_FAILED'
        AND "reconciliationReason" IN ('COPY_IO_ERROR', 'COPY_SIZE_LIMIT_EXCEEDED', 'COPY_VERIFICATION_MISMATCH'))
    OR ("reconciliationClass" = 'NO_LEGACY_ARTIFACT_PRESENT'
        AND "reconciliationReason" IN ('PLACEHOLDER_UPLOADER_NEVER_PERSISTED', 'OPERATOR_ATTESTED_NON_PERSISTING'))
    OR ("reconciliationClass" = 'METADATA_ONLY_LEGACY_RECORD'
        AND "reconciliationReason" IN ('NO_ARTIFACT_REFERENCE', 'READY_WITHOUT_REFERENCE', 'NO_INLINE_CONTENT'))
    OR ("reconciliationClass" = 'INVALID_OR_ORPHANED_LEGACY_REFERENCE'
        AND "reconciliationReason" IN ('MALFORMED_REFERENCE', 'UNSUPPORTED_REFERENCE_SCHEME',
          'REFERENCE_OUTSIDE_ALLOWED_ROOT', 'REFERENCE_TARGET_MISSING', 'LOCATION_NOT_CONFIGURED'))
  );

ALTER TABLE "LegacyArchiveBlob"
  ADD CONSTRAINT "LegacyArchiveBlob_content_sha256_check"
    CHECK ("contentSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "LegacyArchiveBlob_size_check" CHECK ("sizeBytes" >= 0);

ALTER TABLE "LegacyAssessmentArchive"
  ADD CONSTRAINT "LegacyAssessmentArchive_payload_digest_check"
    CHECK ("payloadDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "LegacyAssessmentArchive_record_count_check" CHECK ("recordCount" >= 0),
  -- Terminal V1 assessments never receive a V2 lifecycle or thread; non-terminal ones always do.
  ADD CONSTRAINT "LegacyAssessmentArchive_disposition_check" CHECK (
    ("disposition" = 'ARCHIVED_TERMINAL' AND "v2ThreadId" IS NULL AND "v2LifecycleState" IS NULL)
    OR ("disposition" = 'BACKFILLED_NON_TERMINAL' AND "v2ThreadId" IS NOT NULL AND "v2LifecycleState" IS NOT NULL)
  );

-- Archived history is immutable. Inserts are the only write; deletes remain possible so a
-- tenant-authorized assessment deletion (cascade) can erase archived customer content.
CREATE FUNCTION "lcsp_legacy_archive_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy archive rows are immutable: % on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER "LegacyArchiveRecord_immutable" BEFORE UPDATE ON "LegacyArchiveRecord"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legacy_archive_immutable"();
CREATE TRIGGER "LegacyArchiveBlob_immutable" BEFORE UPDATE ON "LegacyArchiveBlob"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legacy_archive_immutable"();
CREATE TRIGGER "LegacyAssessmentArchive_immutable" BEFORE UPDATE ON "LegacyAssessmentArchive"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legacy_archive_immutable"();

-- A blob may only exist for a record whose bytes were actually read, copied and re-verified.
-- Nothing else may carry storage references, so a hash/reference can never be fabricated.
CREATE FUNCTION "lcsp_legacy_archive_blob_requires_verified_copy"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  record_class "LegacyArtifactReconciliationClass";
  record_reason "LegacyArtifactReconciliationReason";
BEGIN
  SELECT "reconciliationClass", "reconciliationReason" INTO record_class, record_reason
    FROM "LegacyArchiveRecord" WHERE id = NEW."recordId";
  IF record_class IS DISTINCT FROM 'ARTIFACT_PRESENT_AND_COPIED'
     OR record_reason IS DISTINCT FROM 'COPIED_AND_VERIFIED' THEN
    RAISE EXCEPTION 'legacy archive blob requires a verified copied artifact record: %', NEW."recordId"
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "LegacyArchiveBlob_requires_verified_copy" BEFORE INSERT ON "LegacyArchiveBlob"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_legacy_archive_blob_requires_verified_copy"();

-- A cancelled legacy command is terminal: it can never be re-queued, retried or replayed.
CREATE FUNCTION "lcsp_outbox_cancelled_is_terminal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CANCELLED' AND NEW."status" IS DISTINCT FROM 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled outbox message % is terminal', OLD."id" USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OutboxMessage_cancelled_is_terminal" BEFORE UPDATE ON "OutboxMessage"
  FOR EACH ROW EXECUTE FUNCTION "lcsp_outbox_cancelled_is_terminal"();

COMMENT ON TABLE "LegacyArchiveRecord" IS
  'W6 read-only archive of V1 history. Non-authoritative: the V2 runtime never reads it to decide anything.';
COMMENT ON TABLE "LegacyArchiveBlob" IS
  'Only bytes that really existed in V1 storage and were re-verified by sha256 after copy.';

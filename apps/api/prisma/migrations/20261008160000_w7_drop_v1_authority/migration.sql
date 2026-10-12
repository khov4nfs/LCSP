-- W7 / LCSP-357. Immediate V1-only deletion: retention=0, legal hold=NONE,
-- explicitly authorized by the user. Applied migration history stays intact.
-- This is forward-only. Execute external checkpoint/workspace/blob cleanup first;
-- keep its sanitized receipt outside the runtime image before dropping archive identity.
BEGIN;

-- The replaced corpus-acquisition command has no remaining consumer. Writers and
-- broker delivery are quiesced by the release runbook before this ordered drop.
UPDATE "OutboxMessage" SET status='CANCELLED'
WHERE "eventType"='command.legal-corpus.recovery.requested.v1';

DO $w7$
BEGIN
  IF (EXISTS (SELECT 1 FROM "Assessment" WHERE "lifecycleState" IS NULL)
      OR EXISTS (SELECT 1 FROM "LegacyAssessmentArchive")
      OR EXISTS (SELECT 1 FROM "LegacyArchiveRecord"))
     AND NOT EXISTS (SELECT 1 FROM "LegacyMigrationRun"
       WHERE kind = 'CUTOVER' AND status = 'COMPLETED'
         AND "restorePointVerifiedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'W7 requires completed W6 cutover and verified restore point';
  END IF;
  IF EXISTS (SELECT 1 FROM "LegacyArchiveRecord") AND NOT EXISTS (
    SELECT 1 FROM "LegacyMigrationRun" r
    WHERE r.kind='CUTOVER' AND r.status='COMPLETED' AND r."restorePointVerifiedAt" IS NOT NULL
      AND r."phaseResults"->'VALIDATE'->'summary'->>'blockingFailures'='0'
      AND r."phaseResults"->'W7_V1_PURGE'->>'status'='PASS'
      AND (r."phaseResults"->'W7_V1_PURGE'->>'disposableFixtureRunId' IS NULL
        OR (r."toolVersion"='SYNTHETIC_POST_W6_FIXTURE'
          AND r."phaseResults"->>'fixtureOnly'='true'
          AND r."phaseResults"->'W7_V1_PURGE'->>'disposableFixtureRunId'=r.id::text))
      AND r."phaseResults"->'W7_V1_PURGE'->'remaining'=
        '{"checkpoints":0,"sandboxes":0,"files":0,"workspaces":0}'::jsonb
      AND r."phaseResults"->'W7_V1_PURGE'->'archive'->>'count'=
        (SELECT count(*)::text FROM "LegacyArchiveRecord")
      AND r."phaseResults"->'W7_V1_PURGE'->'archive'->>'sha256'=
        (SELECT encode(sha256(convert_to(coalesce(string_agg(
          "sourceTable"::text || ':' || "sourceId" || ':' || "payloadSha256", E'\n'
          ORDER BY "sourceTable"::text COLLATE "C", "sourceId" COLLATE "C"), ''), 'UTF8')), 'hex')
         FROM "LegacyArchiveRecord")
  ) THEN
    RAISE EXCEPTION 'W7 requires identity-bound external V1 purge proof before dropping archive identities';
  END IF;
  IF EXISTS (SELECT 1 FROM "Assessment" a
    WHERE a."lifecycleState" IS NULL AND NOT EXISTS
      (SELECT 1 FROM "LegacyAssessmentArchive" x WHERE x."assessmentId" = a.id
       AND x."ownerId" = a."ownerId" AND x.disposition = 'ARCHIVED_TERMINAL')) THEN
    RAISE EXCEPTION 'W7 refuses an unarchived or unexplained V1 assessment';
  END IF;
  IF EXISTS (SELECT 1 FROM "LegacyAssessmentArchive" x
    JOIN "Assessment" a ON a.id = x."assessmentId"
    LEFT JOIN "AssessmentRuntime" r ON r."assessmentId" = a.id
    LEFT JOIN "AssessmentCase" c ON c."assessmentId" = a.id
    WHERE x.disposition = 'BACKFILLED_NON_TERMINAL'
      AND (x."ownerId" <> a."ownerId" OR r."threadId" IS DISTINCT FROM x."v2ThreadId"
        OR c."assessmentId" IS NULL OR a."lifecycleState" IS NULL)) THEN
    RAISE EXCEPTION 'W7 refuses to destroy archive identity before valid V2 ownership';
  END IF;
  IF EXISTS (SELECT 1 FROM "AssessmentRuntimeTurn"
      WHERE boundary <> 'ASSESSMENT_ROOT' AND state IN ('RUNNING', 'STOP_REQUESTED', 'RESUME_REQUESTED')) THEN
    RAISE EXCEPTION 'W7 refuses active old execution';
  END IF;
  IF EXISTS (SELECT 1 FROM "BillingReservation" b JOIN "Assessment" a ON a.id=b."assessmentId"
      WHERE a."lifecycleState" IS NULL AND b.status='RESERVED') THEN
    RAISE EXCEPTION 'W7 requires V1 billing reservations settled before deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM "OutboxMessage" WHERE "eventType" IN ('command.scan.requested.v1', 'command.scan.targeted-reanalysis.v1', 'command.assessment-interview.pause-agent.v1', 'command.assessment-interview.resume-agent.v1', 'command.legal-matching.requested.v1', 'command.legal-corpus.recovery.requested.v1', 'event.technical-evidence.accepted.v1', 'event.technical-profile.ready.v1', 'event.ai-usage-flow.ready.v1', 'event.classification-result.ready.v1', 'event.reconciliation.all-conflicts-resolved.v1', 'document.final-report-requested', 'document.gap-analysis-requested')
      AND status <> 'CANCELLED') THEN
    RAISE EXCEPTION 'W7 refuses obsolete outbox that was not settled by W6';
  END IF;
  IF EXISTS (SELECT 1 FROM "AssessmentPipelineReconciliation" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'PIPELINE_RECONCILIATION'
        AND x."sourceId" = v."assessmentId"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for AssessmentPipelineReconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM "ReadinessExport" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'READINESS_EXPORT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for ReadinessExport';
  END IF;
  IF EXISTS (SELECT 1 FROM "TargetedReanalysisRequest" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'TARGETED_REANALYSIS_REQUEST'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for TargetedReanalysisRequest';
  END IF;
  IF EXISTS (SELECT 1 FROM "TargetedReanalysisCheckpoint" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'TARGETED_REANALYSIS_CHECKPOINT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for TargetedReanalysisCheckpoint';
  END IF;
  IF EXISTS (SELECT 1 FROM "TechnicalEvidenceReport" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'TECHNICAL_EVIDENCE_REPORT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for TechnicalEvidenceReport';
  END IF;
  IF EXISTS (SELECT 1 FROM "TechnicalProfile" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'TECHNICAL_PROFILE'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for TechnicalProfile';
  END IF;
  IF EXISTS (SELECT 1 FROM "AIUsageFlow" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'AI_USAGE_FLOW'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for AIUsageFlow';
  END IF;
  IF EXISTS (SELECT 1 FROM "ConflictRecord" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'CONFLICT_RECORD'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for ConflictRecord';
  END IF;
  IF EXISTS (SELECT 1 FROM "AssessmentInterviewThread" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'ASSESSMENT_INTERVIEW_THREAD'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for AssessmentInterviewThread';
  END IF;
  IF EXISTS (SELECT 1 FROM "EngineeringRuleAssessment" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'ENGINEERING_RULE_ASSESSMENT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for EngineeringRuleAssessment';
  END IF;
  IF EXISTS (SELECT 1 FROM "DecisionModelDecision" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'DECISION_MODEL_DECISION'
        AND x."sourceId" = v."decisionId"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for DecisionModelDecision';
  END IF;
  IF EXISTS (SELECT 1 FROM "DecisionModelEvent" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'DECISION_MODEL_EVENT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for DecisionModelEvent';
  END IF;
  IF EXISTS (SELECT 1 FROM "VerifiedAgentEpisode" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'VERIFIED_AGENT_EPISODE'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for VerifiedAgentEpisode';
  END IF;
  IF EXISTS (SELECT 1 FROM "VerifiedProfile" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'VERIFIED_PROFILE'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for VerifiedProfile';
  END IF;
  IF EXISTS (SELECT 1 FROM "ClassificationResult" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'CLASSIFICATION_RESULT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for ClassificationResult';
  END IF;
  IF EXISTS (SELECT 1 FROM "ClassificationReviewRequest" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'CLASSIFICATION_REVIEW_REQUEST'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for ClassificationReviewRequest';
  END IF;
  IF EXISTS (SELECT 1 FROM "DocumentRequest" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'DOCUMENT_REQUEST'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for DocumentRequest';
  END IF;
  IF EXISTS (SELECT 1 FROM "LegalRuleCatalogVersion" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'LEGAL_RULE_CATALOG_VERSION'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for LegalRuleCatalogVersion';
  END IF;
  IF EXISTS (SELECT 1 FROM "CorpusDiscardReceipt" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'CORPUS_DISCARD_RECEIPT'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for CorpusDiscardReceipt';
  END IF;
  IF EXISTS (SELECT 1 FROM "LegalRule" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'LEGAL_RULE'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for LegalRule';
  END IF;
  IF EXISTS (SELECT 1 FROM "RuleApprovalRecord" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'RULE_APPROVAL_RECORD'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for RuleApprovalRecord';
  END IF;
  IF EXISTS (SELECT 1 FROM "LegalRuleMatch" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'LEGAL_RULE_MATCH'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for LegalRuleMatch';
  END IF;
  IF EXISTS (SELECT 1 FROM "CorpusPreparation" v WHERE NOT EXISTS (
      SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceTable" = 'CORPUS_PREPARATION'
        AND x."sourceId" = v."id"::text)) THEN
    RAISE EXCEPTION 'W7 requires archive coverage for CorpusPreparation';
  END IF;
END;
$w7$;

-- Root turns and journals are mixed V1/V2 storage. Preserve every canonical Root.
DELETE FROM "AssessmentRuntimeEvent" e USING "LegacyArchiveRecord" x
  WHERE x."sourceTable"='ASSESSMENT_RUNTIME_EVENT' AND e.id=x."sourceId"
    AND NOT EXISTS (SELECT 1 FROM "AssessmentRuntimeTurn" t
      WHERE t.boundary='ASSESSMENT_ROOT' AND t."assessmentId"=e."assessmentId"
        AND (t.id=e."runId" OR t."logicalRunId"=e."runId"
          OR t.id=e."outputSummaryJson"->'agentStreamEvent'->'data'->>'runtimeRunId'));
DELETE FROM "AssessmentRuntimeTurn" WHERE boundary <> 'ASSESSMENT_ROOT';

-- A pinned case's ticket is canonical even if W6 reused a V1-shaped physical row.
DELETE FROM "RepositoryScanJob" j USING "LegacyArchiveRecord" x
  WHERE x."sourceTable"='REPOSITORY_SCAN_JOB' AND j.id=x."sourceId"
    AND j."idempotencyKey" NOT LIKE 'runtime-hydration:%'
    AND NOT EXISTS (SELECT 1 FROM "AssessmentCase" c WHERE c."repositoryScanJobId"=j.id);

-- W6 also classified orphaned obsolete commands from their authoritative lineage.
DELETE FROM "OutboxMessage" o USING "LegacyArchiveRecord" x
  WHERE x."sourceTable"='OUTBOX_MESSAGE_CANCELLED' AND o.id=x."sourceId" AND o.status='CANCELLED';

-- Numeric financial history is canonical retention data; detach, never delete it.
UPDATE "BillingReservation" b SET "assessmentId"=NULL FROM "Assessment" a
  WHERE b."assessmentId"=a.id AND a."lifecycleState" IS NULL;
UPDATE "LlmUsageEvent" u SET "assessmentId"=NULL FROM "Assessment" a
  WHERE u."assessmentId"=a.id AND a."lifecycleState" IS NULL;
DELETE FROM "Assessment" WHERE "lifecycleState" IS NULL;
DELETE FROM "OutboxMessage" WHERE "eventType" IN ('command.scan.requested.v1', 'command.scan.targeted-reanalysis.v1', 'command.assessment-interview.pause-agent.v1', 'command.assessment-interview.resume-agent.v1', 'command.legal-matching.requested.v1', 'command.legal-corpus.recovery.requested.v1', 'event.technical-evidence.accepted.v1', 'event.technical-profile.ready.v1', 'event.ai-usage-flow.ready.v1', 'event.classification-result.ready.v1', 'event.reconciliation.all-conflicts-resolved.v1', 'document.final-report-requested', 'document.gap-analysis-requested');

DELETE FROM "CorpusApprovalRecord" a USING "LegacyArchiveRecord" x
  WHERE x."sourceTable"='CORPUS_APPROVAL_RECORD' AND a.id=x."sourceId"
    AND a."approvedBy" <> 'legal-corpus-activation-service';

-- Retired aggregate kinds have no V2 producer, consumer, or canonical event FK.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "OutboxMessage" WHERE "aggregateType"::text IN ('AI_USAGE_FLOW', 'CLASSIFICATION_REVIEW_REQUEST', 'CLASSIFICATION_RESULT', 'DOCUMENT_REQUEST', 'LEGAL_RULE_MATCH', 'TECHNICAL_EVIDENCE_REPORT', 'TECHNICAL_PROFILE', 'TARGETED_REANALYSIS_REQUEST', 'VERIFIED_PROFILE')
    AND status IN ('PENDING','FAILED')) THEN
    RAISE EXCEPTION 'W7 refuses unsettled obsolete aggregate deliveries';
  END IF;
END $$;
DELETE FROM "OutboxMessage" WHERE "aggregateType"::text IN ('AI_USAGE_FLOW', 'CLASSIFICATION_REVIEW_REQUEST', 'CLASSIFICATION_RESULT', 'DOCUMENT_REQUEST', 'LEGAL_RULE_MATCH', 'TECHNICAL_EVIDENCE_REPORT', 'TECHNICAL_PROFILE', 'TARGETED_REANALYSIS_REQUEST', 'VERIFIED_PROFILE');

-- Preserve only content-free security/accounting metadata from mixed audit history.
UPDATE "AuditEvent" a SET payload='{}'::jsonb
WHERE a."createdAt" < (SELECT min("startedAt") FROM "LegacyMigrationRun" WHERE kind='CUTOVER' AND status='COMPLETED')
  AND EXISTS (SELECT 1 FROM "LegacyArchiveRecord" x WHERE x."sourceId"=a."resourceId"
    OR (x."sourceTable"='ASSESSMENT' AND x."sourceId" IN (a.payload->>'assessmentId', a.payload->>'assessment_id')));
DELETE FROM "AuditEvent" WHERE "resourceType"::text IN ('AI_USAGE_FLOW', 'CLASSIFICATION_REVIEW_REQUEST', 'CLASSIFICATION_RESULT', 'DOCUMENT_REQUEST', 'LEGAL_RULE_MATCH', 'TECHNICAL_EVIDENCE_REPORT', 'TECHNICAL_PROFILE', 'TARGETED_REANALYSIS_REQUEST', 'VERIFIED_PROFILE', 'CONFLICT_RECORD', 'READINESS_EXPORT');
DELETE FROM "AuditEvent" a WHERE a."resourceType"::text='LEGAL_RULE_CATALOG_VERSION'
  AND NOT EXISTS (SELECT 1 FROM "LegalCorpusVersion" c WHERE c.id=a."resourceId");
DELETE FROM "AuditEvent" a WHERE a."resourceType"::text='LEGAL_RULE'
  AND EXISTS (SELECT 1 FROM "LegalRule" v WHERE v.id=a."resourceId")
  AND NOT EXISTS (SELECT 1 FROM "LegalPortfolioRule" v WHERE v.id=a."resourceId");
ALTER TYPE "AuditResourceType" RENAME VALUE 'LEGAL_RULE_CATALOG_VERSION' TO 'LEGAL_CORPUS_VERSION';

-- Drop only functions whose entire owning table/trigger is retired.
-- DropForeignKey
ALTER TABLE "AssessmentPipelineReconciliation" DROP CONSTRAINT "AssessmentPipelineReconciliation_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "ReadinessExport" DROP CONSTRAINT "ReadinessExport_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "ReadinessExport" DROP CONSTRAINT "ReadinessExport_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "TargetedReanalysisRequest" DROP CONSTRAINT "TargetedReanalysisRequest_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "TargetedReanalysisRequest" DROP CONSTRAINT "TargetedReanalysisRequest_inputEvidenceReportId_fkey";

-- DropForeignKey
ALTER TABLE "TargetedReanalysisRequest" DROP CONSTRAINT "TargetedReanalysisRequest_outputEvidenceReportId_fkey";

-- DropForeignKey
ALTER TABLE "TargetedReanalysisRequest" DROP CONSTRAINT "TargetedReanalysisRequest_scanJobId_fkey";

-- DropForeignKey
ALTER TABLE "TargetedReanalysisRequest" DROP CONSTRAINT "TargetedReanalysisRequest_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "TargetedReanalysisCheckpoint" DROP CONSTRAINT "TargetedReanalysisCheckpoint_requestId_fkey";

-- DropForeignKey
ALTER TABLE "TechnicalEvidenceReport" DROP CONSTRAINT "TechnicalEvidenceReport_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "TechnicalEvidenceReport" DROP CONSTRAINT "TechnicalEvidenceReport_scanJobId_fkey";

-- DropForeignKey
ALTER TABLE "TechnicalEvidenceReport" DROP CONSTRAINT "TechnicalEvidenceReport_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "TechnicalProfile" DROP CONSTRAINT "TechnicalProfile_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "TechnicalProfile" DROP CONSTRAINT "TechnicalProfile_evidenceReportId_fkey";

-- DropForeignKey
ALTER TABLE "AIUsageFlow" DROP CONSTRAINT "AIUsageFlow_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "AIUsageFlow" DROP CONSTRAINT "AIUsageFlow_technicalProfileId_fkey";

-- DropForeignKey
ALTER TABLE "ConflictRecord" DROP CONSTRAINT "ConflictRecord_aiUsageFlowId_fkey";

-- DropForeignKey
ALTER TABLE "ConflictRecord" DROP CONSTRAINT "ConflictRecord_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "ConflictRecord" DROP CONSTRAINT "ConflictRecord_resolvedById_fkey";

-- DropForeignKey
ALTER TABLE "AssessmentInterviewThread" DROP CONSTRAINT "AssessmentInterviewThread_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "EngineeringRuleAssessment" DROP CONSTRAINT "EngineeringRuleAssessment_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "VerifiedAgentEpisode" DROP CONSTRAINT "VerifiedAgentEpisode_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "VerifiedProfile" DROP CONSTRAINT "VerifiedProfile_aiUsageFlowId_fkey";

-- DropForeignKey
ALTER TABLE "VerifiedProfile" DROP CONSTRAINT "VerifiedProfile_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "VerifiedProfile" DROP CONSTRAINT "VerifiedProfile_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "VerifiedProfile" DROP CONSTRAINT "VerifiedProfile_technicalEvidenceReportId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationResult" DROP CONSTRAINT "ClassificationResult_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationResult" DROP CONSTRAINT "ClassificationResult_legalRuleMatchId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationResult" DROP CONSTRAINT "ClassificationResult_verifiedProfileId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationReviewRequest" DROP CONSTRAINT "ClassificationReviewRequest_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationReviewRequest" DROP CONSTRAINT "ClassificationReviewRequest_legalRuleMatchId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationReviewRequest" DROP CONSTRAINT "ClassificationReviewRequest_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "DocumentRequest" DROP CONSTRAINT "DocumentRequest_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentRequest" DROP CONSTRAINT "DocumentRequest_classificationResultId_fkey";

-- DropForeignKey
ALTER TABLE "DocumentRequest" DROP CONSTRAINT "DocumentRequest_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "CorpusDiscardReceipt" DROP CONSTRAINT "CorpusDiscardReceipt_corpusVersionId_fkey";

-- DropForeignKey
ALTER TABLE "LegalRule" DROP CONSTRAINT "LegalRule_legalRuleCatalogVersionId_fkey";

-- DropForeignKey
ALTER TABLE "RuleApprovalRecord" DROP CONSTRAINT "RuleApprovalRecord_legalRuleCatalogVersionId_fkey";

-- DropForeignKey
ALTER TABLE "LegalRuleMatch" DROP CONSTRAINT "LegalRuleMatch_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "LegalRuleMatch" DROP CONSTRAINT "LegalRuleMatch_legalRuleCatalogVersionId_fkey";

-- DropForeignKey
ALTER TABLE "LegalRuleMatch" DROP CONSTRAINT "LegalRuleMatch_corpusVersionId_fkey";

-- DropForeignKey
ALTER TABLE "LegalRuleMatch" DROP CONSTRAINT "LegalRuleMatch_verifiedProfileId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowBillingPause" DROP CONSTRAINT "WorkflowBillingPause_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyAssessmentArchive" DROP CONSTRAINT "LegacyAssessmentArchive_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyAssessmentArchive" DROP CONSTRAINT "LegacyAssessmentArchive_archiveRunId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyArchiveRecord" DROP CONSTRAINT "LegacyArchiveRecord_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyArchiveRecord" DROP CONSTRAINT "LegacyArchiveRecord_archiveRunId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyArchiveBlob" DROP CONSTRAINT "LegacyArchiveBlob_recordId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyReevaluation" DROP CONSTRAINT "LegacyReevaluation_assessmentId_fkey";

-- DropForeignKey
ALTER TABLE "LegacyReevaluation" DROP CONSTRAINT "LegacyReevaluation_runId_fkey";

-- AlterTable
ALTER TABLE "Assessment" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "AssessmentRuntimeEvent" DROP COLUMN "eventType",
DROP COLUMN "runStatus",
DROP COLUMN "stage";

-- DropTable
DROP TABLE "AssessmentPipelineReconciliation";

-- DropTable
DROP TABLE "ReadinessExport";

-- DropTable
DROP TABLE "TargetedReanalysisRequest";

-- DropTable
DROP TABLE "TargetedReanalysisCheckpoint";

-- DropTable
DROP TABLE "TechnicalEvidenceReport";

-- DropTable
DROP TABLE "TechnicalProfile";

-- DropTable
DROP TABLE "AIUsageFlow";

-- DropTable
DROP TABLE "ConflictRecord";

-- DropTable
DROP TABLE "AssessmentInterviewThread";

-- DropTable
DROP TABLE "EngineeringRuleAssessment";

-- DropTable
DROP TABLE "DecisionModelDecision";

-- DropTable
DROP TABLE "DecisionModelEvent";

-- DropTable
DROP TABLE "VerifiedAgentEpisode";

-- DropTable
DROP TABLE "VerifiedProfile";

-- DropTable
DROP TABLE "ClassificationResult";

-- DropTable
DROP TABLE "ClassificationReviewRequest";

-- DropTable
DROP TABLE "DocumentRequest";

-- DropTable
DROP TABLE "LegalRuleCatalogVersion";

-- DropTable
DROP TABLE "CorpusDiscardReceipt";

-- DropTable
DROP TABLE "LegalRule";

-- DropTable
DROP TABLE "RuleApprovalRecord";

-- DropTable
DROP TABLE "LegalRuleMatch";

-- DropTable
DROP TABLE "WorkflowBillingPause";

-- DropTable
DROP TABLE "LegacyMigrationRun";

-- DropTable
DROP TABLE "LegacyAssessmentArchive";

-- DropTable
DROP TABLE "LegacyArchiveRecord";

-- DropTable
DROP TABLE "LegacyArchiveBlob";

-- DropTable
DROP TABLE "LegacyReevaluation";

DROP FUNCTION "lcsp_legacy_reevaluation_requires_backfilled"();
DROP FUNCTION "lcsp_legacy_archive_blob_requires_verified_copy"();
DROP FUNCTION "lcsp_legacy_archive_immutable"();

-- DropEnum
DROP TYPE "EngineeringRuleEvaluationStatus";

-- DropEnum
DROP TYPE "RuleAnalysisStatus";

-- DropEnum
DROP TYPE "EngineeringEvidenceClaimType";

-- DropEnum
DROP TYPE "TargetedReanalysisRequestState";

-- DropEnum
DROP TYPE "TargetedReanalysisCheckpointState";

-- DropEnum
DROP TYPE "AssessmentStatus";

-- DropEnum
DROP TYPE "ReadinessExportStatus";

-- DropEnum
DROP TYPE "DecisionModelDecisionStatus";

-- DropEnum
DROP TYPE "AssessmentRuntimeEventType";

-- DropEnum
DROP TYPE "AssessmentRuntimeRunStatus";

-- DropEnum
DROP TYPE "AssessmentRuntimeStage";

-- DropEnum
DROP TYPE "EvidenceAcceptanceStatus";

-- DropEnum
DROP TYPE "ConflictRecordStatus";

-- DropEnum
DROP TYPE "VerifiedProfileStatus";

-- DropEnum
DROP TYPE "VerifiedAgentEpisodeValidationStatus";

-- DropEnum
DROP TYPE "ClassificationGuardrailStatus";

-- DropEnum
DROP TYPE "ClassificationReviewRequestStatus";

-- DropEnum
DROP TYPE "LegalRuleMatchGuardrailStatus";

-- DropEnum
DROP TYPE "OverallCoverageStatus";

-- DropEnum
DROP TYPE "DocumentRequestStatus";

-- DropEnum
DROP TYPE "DocumentType";

-- DropEnum
DROP TYPE "WorkflowBillingPauseSource";

-- DropEnum
DROP TYPE "LegacyMigrationRunKind";

-- DropEnum
DROP TYPE "LegacyReevaluationMode";

-- DropEnum
DROP TYPE "LegacyMigrationRunStatus";

-- DropEnum
DROP TYPE "LegacyAssessmentDisposition";

-- DropEnum
DROP TYPE "LegacyArchiveSource";

-- DropEnum
DROP TYPE "LegacyArtifactReconciliationClass";

-- DropEnum
DROP TYPE "LegacyArtifactReconciliationReason";

-- No V2 reader/writer or FK depends on the retired source-preparation command ledger.
DROP TABLE "CorpusPreparation";
DROP TYPE "CorpusPreparationStatus";

ALTER TYPE "OutboxAggregateType" RENAME TO "OutboxAggregateType_w7_old";
CREATE TYPE "OutboxAggregateType" AS ENUM ('BILLING_PAYMENT', 'ASSESSMENT', 'AUTH_USER', 'LEGAL_CORPUS_VERSION', 'LEGAL_PORTFOLIO_VERSION', 'REPOSITORY_SCAN_JOB', 'REPOSITORY_SNAPSHOT');
ALTER TABLE "OutboxMessage" ALTER COLUMN "aggregateType" TYPE "OutboxAggregateType" USING ("aggregateType"::text::"OutboxAggregateType");
DROP TYPE "OutboxAggregateType_w7_old";

ALTER TYPE "AuditResourceType" RENAME TO "AuditResourceType_w7_old";
CREATE TYPE "AuditResourceType" AS ENUM ('AUTH_ACCOUNT', 'ASSESSMENT', 'ASSESSMENT_RECORD', 'AUDIT_EXPORT_REQUEST', 'AUTH_INVITATION', 'AUTH_MFA_RECOVERY_CODE', 'AUTH_SESSION', 'GITHUB_APP_INSTALL_STATE', 'HTTP_ROUTE', 'LEGAL_RULE', 'LEGAL_PORTFOLIO_VERSION', 'LEGAL_CORPUS_VERSION', 'OUTBOX', 'REPOSITORY_CONNECTION', 'REPOSITORY_SCAN_JOB', 'REPOSITORY_SNAPSHOT', 'WORKER_TASK', 'WORKSPACE');
ALTER TABLE "AuditEvent" ALTER COLUMN "resourceType" TYPE "AuditResourceType" USING ("resourceType"::text::"AuditResourceType");
DROP TYPE "AuditResourceType_w7_old";

COMMIT;

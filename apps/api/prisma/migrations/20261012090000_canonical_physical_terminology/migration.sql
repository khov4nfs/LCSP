-- Canonical physical terminology; in-place renames preserve rows and object identity.
BEGIN;

ALTER TYPE "AuditResourceType" RENAME VALUE 'LEGAL_RULE' TO 'LEGAL_REQUIREMENT';

ALTER TABLE "LegalCorpusVersion" RENAME TO "LegalSourceVersion";
ALTER TABLE "CorpusApprovalRecord" RENAME TO "LegalSourceActivationRecord";
ALTER TABLE "LegalPreparationRun" RENAME TO "RuleSetPreparationRun";
ALTER TABLE "LegalPortfolioVersion" RENAME TO "ComplianceRuleSetVersion";
ALTER TABLE "LegalPortfolioRule" RENAME TO "LegalRequirement";
ALTER TABLE "EngineeringRuleLegalRule" RENAME TO "AssessmentRuleLegalRequirement";
ALTER TABLE "EngineeringRule" RENAME TO "AssessmentRule";
ALTER TABLE "LegalRuleProvenance" RENAME TO "LegalRequirementProvenance";
ALTER TABLE "LegalRuleContextRelation" RENAME TO "LegalRequirementContextRelation";
ALTER TABLE "LegalPortfolioActivationRecord" RENAME TO "ComplianceRuleSetActivationRecord";

ALTER TABLE "LegalSourceVersion" RENAME COLUMN "approvedAt" TO "activatedAt";
ALTER TABLE "LegalSourceDocument" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalDocumentChunk" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalSourceActivationRecord" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalSourceActivationRecord" RENAME COLUMN "approvedBy" TO "activatedBy";
ALTER TABLE "LegalSourceActivationRecord" RENAME COLUMN "approvalDate" TO "activatedAt";
ALTER TABLE "LegalRetrievalIndex" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "RuleSetPreparationRun" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "ComplianceRuleSetVersion" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "ComplianceRuleSetVersion" RENAME COLUMN "portfolioDigest" TO "ruleSetDigest";
ALTER TABLE "LegalRequirement" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirement" RENAME COLUMN "legalRuleId" TO "legalRequirementId";
ALTER TABLE "AssessmentRule" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentRule" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentRule" RENAME COLUMN "engineeringRuleVersion" TO "assessmentRuleVersion";
ALTER TABLE "AssessmentRuleLegalRequirement" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentRuleLegalRequirement" RENAME COLUMN "engineeringRuleRowId" TO "assessmentRuleRowId";
ALTER TABLE "AssessmentRuleLegalRequirement" RENAME COLUMN "portfolioRuleId" TO "legalRequirementRowId";
ALTER TABLE "LegalRequirementProvenance" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirementProvenance" RENAME COLUMN "portfolioRuleId" TO "legalRequirementRowId";
ALTER TABLE "LegalRequirementProvenance" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalRequirementContextRelation" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirementContextRelation" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME COLUMN "previousActivePortfolioVersionId" TO "previousActiveRuleSetVersionId";
ALTER TABLE "AssessmentCase" RENAME COLUMN "legalPortfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentRuleDecision" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentRuleDecision" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentRuleDecision" RENAME COLUMN "engineeringRuleVersion" TO "assessmentRuleVersion";
ALTER TABLE "AssessmentDecisionCoverage" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentDecisionCoverage" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentDecisionCoverage" RENAME COLUMN "engineeringRuleVersion" TO "assessmentRuleVersion";
ALTER TABLE "AssessmentHumanRequest" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentArtifact" RENAME COLUMN "legalPortfolioVersionId" TO "ruleSetVersionId";

ALTER TYPE "LegalRuleLifecycleStatus" RENAME TO "LegalSourceLifecycleStatus";
ALTER TYPE "LegalPortfolioCoverageState" RENAME TO "LegalRequirementCoverageState";
ALTER TYPE "LegalPreparationFailureReason" RENAME TO "RuleSetPreparationFailureReason";
ALTER TYPE "LegalPortfolioValidationOutcome" RENAME TO "ComplianceRuleSetValidationOutcome";
ALTER TYPE "LegalSourceLifecycleStatus" RENAME VALUE 'APPROVED' TO 'ACTIVE';
ALTER TYPE "LegalSourceLifecycleStatus" RENAME VALUE 'REJECTED' TO 'INVALID';

ALTER TABLE "LegalSourceVersion" RENAME CONSTRAINT "LegalCorpusVersion_pkey" TO "LegalSourceVersion_pkey";
ALTER TABLE "LegalSourceActivationRecord" RENAME CONSTRAINT "CorpusApprovalRecord_pkey" TO "LegalSourceActivationRecord_pkey";
ALTER TABLE "LegalSourceDocument" RENAME CONSTRAINT "LegalSourceDocument_legalCorpusVersionId_fkey" TO "LegalSourceDocument_legalSourceVersionId_fkey";
ALTER TABLE "LegalDocumentChunk" RENAME CONSTRAINT "LegalDocumentChunk_legalCorpusVersionId_fkey" TO "LegalDocumentChunk_legalSourceVersionId_fkey";
ALTER TABLE "LegalSourceActivationRecord" RENAME CONSTRAINT "CorpusApprovalRecord_legalCorpusVersionId_fkey" TO "LegalSourceActivationRecord_legalSourceVersionId_fkey";
ALTER TABLE "LegalRetrievalIndex" RENAME CONSTRAINT "LegalRetrievalIndex_legalCorpusVersionId_fkey" TO "LegalRetrievalIndex_legalSourceVersionId_fkey";
ALTER TABLE "RuleSetPreparationRun" RENAME CONSTRAINT "LegalPreparationRun_pkey" TO "RuleSetPreparationRun_pkey";
ALTER TABLE "ComplianceRuleSetVersion" RENAME CONSTRAINT "LegalPortfolioVersion_pkey" TO "ComplianceRuleSetVersion_pkey";
ALTER TABLE "LegalRequirement" RENAME CONSTRAINT "LegalPortfolioRule_pkey" TO "LegalRequirement_pkey";
ALTER TABLE "AssessmentRule" RENAME CONSTRAINT "EngineeringRule_pkey" TO "AssessmentRule_pkey";
ALTER TABLE "AssessmentRuleLegalRequirement" RENAME CONSTRAINT "EngineeringRuleLegalRule_pkey" TO "AssessmentRuleLegalRequirement_pkey";
ALTER TABLE "LegalRequirementProvenance" RENAME CONSTRAINT "LegalRuleProvenance_pkey" TO "LegalRequirementProvenance_pkey";
ALTER TABLE "LegalRequirementContextRelation" RENAME CONSTRAINT "LegalRuleContextRelation_pkey" TO "LegalRequirementContextRelation_pkey";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME CONSTRAINT "LegalPortfolioActivationRecord_pkey" TO "ComplianceRuleSetActivationRecord_pkey";
ALTER TABLE "RuleSetPreparationRun" RENAME CONSTRAINT "LegalPreparationRun_legalCorpusVersionId_fkey" TO "RuleSetPreparationRun_legalSourceVersionId_fkey";
ALTER TABLE "ComplianceRuleSetVersion" RENAME CONSTRAINT "LegalPortfolioVersion_legalCorpusVersionId_fkey" TO "ComplianceRuleSetVersion_legalSourceVersionId_fkey";
ALTER TABLE "ComplianceRuleSetVersion" RENAME CONSTRAINT "LegalPortfolioVersion_preparationRunId_fkey" TO "ComplianceRuleSetVersion_preparationRunId_fkey";
ALTER TABLE "LegalRequirement" RENAME CONSTRAINT "LegalPortfolioRule_portfolioVersionId_fkey" TO "LegalRequirement_ruleSetVersionId_fkey";
ALTER TABLE "AssessmentRule" RENAME CONSTRAINT "EngineeringRule_portfolioVersionId_fkey" TO "AssessmentRule_ruleSetVersionId_fkey";
ALTER TABLE "AssessmentRuleLegalRequirement" RENAME CONSTRAINT "EngineeringRuleLegalRule_engineeringRuleRowId_portfolioVer_fkey" TO "AssessmentRuleLegalRequirement_assessmentRuleRowId_ruleSet_fkey";
ALTER TABLE "AssessmentRuleLegalRequirement" RENAME CONSTRAINT "EngineeringRuleLegalRule_portfolioRuleId_portfolioVersionI_fkey" TO "AssessmentRuleLegalRequirement_legalRequirementRowId_ruleS_fkey";
ALTER TABLE "LegalRequirementProvenance" RENAME CONSTRAINT "LegalRuleProvenance_portfolioVersionId_legalCorpusVersionI_fkey" TO "LegalRequirementProvenance_ruleSetVersionId_legalSourceVer_fkey";
ALTER TABLE "LegalRequirementProvenance" RENAME CONSTRAINT "LegalRuleProvenance_portfolioRuleId_portfolioVersionId_fkey" TO "LegalRequirementProvenance_legalRequirementRowId_ruleSetVe_fkey";
ALTER TABLE "LegalRequirementProvenance" RENAME CONSTRAINT "LegalRuleProvenance_chunkId_legalCorpusVersionId_fkey" TO "LegalRequirementProvenance_chunkId_legalSourceVersionId_fkey";
ALTER TABLE "LegalRequirementContextRelation" RENAME CONSTRAINT "LegalRuleContextRelation_portfolioVersionId_legalCorpusVer_fkey" TO "LegalRequirementContextRelation_ruleSetVersionId_legalSour_fkey";
ALTER TABLE "LegalRequirementContextRelation" RENAME CONSTRAINT "LegalRuleContextRelation_fromRuleId_portfolioVersionId_fkey" TO "LegalRequirementContextRelation_fromRuleId_ruleSetVersionI_fkey";
ALTER TABLE "LegalRequirementContextRelation" RENAME CONSTRAINT "LegalRuleContextRelation_toChunkId_legalCorpusVersionId_fkey" TO "LegalRequirementContextRelation_toChunkId_legalSourceVersi_fkey";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME CONSTRAINT "LegalPortfolioActivationRecord_portfolioVersionId_fkey" TO "ComplianceRuleSetActivationRecord_ruleSetVersionId_fkey";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME CONSTRAINT "LegalPortfolioActivationRecord_previousActivePortfolioVers_fkey" TO "ComplianceRuleSetActivationRecord_previousActiveRuleSetVer_fkey";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME CONSTRAINT "LegalPortfolioActivationRecord_preparationRunId_fkey" TO "ComplianceRuleSetActivationRecord_preparationRunId_fkey";
ALTER TABLE "ComplianceRuleSetVersion" RENAME CONSTRAINT "LegalPortfolioVersion_state_consistency_check" TO "ComplianceRuleSetVersion_state_consistency_check";
ALTER TABLE "ComplianceRuleSetActivationRecord" RENAME CONSTRAINT "LegalPortfolioActivationRecord_failures_check" TO "ComplianceRuleSetActivationRecord_failures_check";
ALTER TABLE "LegalRequirement" RENAME CONSTRAINT "LegalPortfolioRule_coverage_reason_check" TO "LegalRequirement_coverage_reason_check";
ALTER TABLE "LegalRequirementContextRelation" RENAME CONSTRAINT "LegalRuleContextRelation_exactly_one_target_check" TO "LegalRequirementContextRelation_exactly_one_target_check";
ALTER TABLE "LegalRequirementContextRelation" RENAME CONSTRAINT "LegalRuleContextRelation_toRule_same_portfolio_fkey" TO "LegalRequirementContextRelation_toRuleId_ruleSetVersionId_fkey";
ALTER TABLE "RuleSetPreparationRun" RENAME CONSTRAINT "LegalPreparationRun_failure_reason_check" TO "RuleSetPreparationRun_failure_reason_check";
ALTER TABLE "AssessmentCase" RENAME CONSTRAINT "AssessmentCase_legalPortfolioVersionId_fkey" TO "AssessmentCase_ruleSetVersionId_fkey";
ALTER TABLE "AssessmentRuleDecision" RENAME CONSTRAINT "AssessmentRuleDecision_assessmentId_portfolioVersionId_fkey" TO "AssessmentRuleDecision_assessmentId_ruleSetVersionId_fkey";
ALTER TABLE "AssessmentRuleDecision" RENAME CONSTRAINT "AssessmentRuleDecision_portfolioVersionId_engineeringRuleI_fkey" TO "AssessmentRuleDecision_ruleSetVersionId_assessmentRuleId_fkey";
ALTER TABLE "AssessmentDecisionCoverage" RENAME CONSTRAINT "AssessmentDecisionCoverage_assessmentId_portfolioVersionId_fkey" TO "AssessmentDecisionCoverage_assessmentId_ruleSetVersionId_fkey";
ALTER TABLE "AssessmentDecisionCoverage" RENAME CONSTRAINT "AssessmentDecisionCoverage_portfolioVersionId_engineeringR_fkey" TO "AssessmentDecisionCoverage_ruleSetVersionId_assessmentRule_fkey";
ALTER TABLE "AssessmentArtifact" RENAME CONSTRAINT "AssessmentArtifact_assessmentId_legalPortfolioVersionId_fkey" TO "AssessmentArtifact_assessmentId_ruleSetVersionId_fkey";

ALTER INDEX "LegalCorpusVersion_version_key" RENAME TO "LegalSourceVersion_version_key";
ALTER INDEX "LegalSourceDocument_legalCorpusVersionId_documentId_key" RENAME TO "LegalSourceDocument_legalSourceVersionId_documentId_key";
ALTER INDEX "LegalDocumentChunk_legalCorpusVersionId_documentId_locator_key" RENAME TO "LegalDocumentChunk_legalSourceVersionId_documentId_locator_key";
ALTER INDEX "LegalDocumentChunk_legalCorpusVersionId_documentId_idx" RENAME TO "LegalDocumentChunk_legalSourceVersionId_documentId_idx";
ALTER INDEX "LegalDocumentChunk_legalCorpusVersionId_legalStatus_idx" RENAME TO "LegalDocumentChunk_legalSourceVersionId_legalStatus_idx";
ALTER INDEX "CorpusApprovalRecord_legalCorpusVersionId_idx" RENAME TO "LegalSourceActivationRecord_legalSourceVersionId_idx";
ALTER INDEX "LegalRetrievalIndex_legalCorpusVersionId_status_validatedAt_idx" RENAME TO "LegalRetrievalIndex_legalSourceVersionId_status_validatedAt_idx";
ALTER INDEX "CorpusApprovalRecord_idempotencyKey_key" RENAME TO "LegalSourceActivationRecord_idempotencyKey_key";
ALTER INDEX "LegalCorpusVersion_status_createdAt_idx" RENAME TO "LegalSourceVersion_status_createdAt_idx";
ALTER INDEX "LegalCorpusVersion_single_draft_key" RENAME TO "LegalSourceVersion_single_draft_key";
ALTER INDEX "LegalPreparationRun_idempotencyKey_key" RENAME TO "RuleSetPreparationRun_idempotencyKey_key";
ALTER INDEX "LegalPreparationRun_legalCorpusVersionId_idx" RENAME TO "RuleSetPreparationRun_legalSourceVersionId_idx";
ALTER INDEX "LegalPreparationRun_executionState_createdAt_idx" RENAME TO "RuleSetPreparationRun_executionState_createdAt_idx";
ALTER INDEX "LegalPortfolioVersion_version_key" RENAME TO "ComplianceRuleSetVersion_version_key";
ALTER INDEX "LegalPortfolioVersion_preparationRunId_key" RENAME TO "ComplianceRuleSetVersion_preparationRunId_key";
ALTER INDEX "LegalPortfolioVersion_lifecycleState_idx" RENAME TO "ComplianceRuleSetVersion_lifecycleState_idx";
ALTER INDEX "LegalPortfolioVersion_legalCorpusVersionId_idx" RENAME TO "ComplianceRuleSetVersion_legalSourceVersionId_idx";
ALTER INDEX "LegalPortfolioVersion_id_legalCorpusVersionId_key" RENAME TO "ComplianceRuleSetVersion_id_legalSourceVersionId_key";
ALTER INDEX "LegalPortfolioRule_portfolioVersionId_legalRuleId_key" RENAME TO "LegalRequirement_ruleSetVersionId_legalRequirementId_key";
ALTER INDEX "LegalPortfolioRule_id_portfolioVersionId_key" RENAME TO "LegalRequirement_id_ruleSetVersionId_key";
ALTER INDEX "EngineeringRule_portfolioVersionId_engineeringRuleId_key" RENAME TO "AssessmentRule_ruleSetVersionId_assessmentRuleId_key";
ALTER INDEX "EngineeringRule_id_portfolioVersionId_key" RENAME TO "AssessmentRule_id_ruleSetVersionId_key";
ALTER INDEX "EngineeringRuleLegalRule_portfolioRuleId_idx" RENAME TO "AssessmentRuleLegalRequirement_legalRequirementRowId_idx";
ALTER INDEX "LegalRuleProvenance_portfolioVersionId_idx" RENAME TO "LegalRequirementProvenance_ruleSetVersionId_idx";
ALTER INDEX "LegalRuleProvenance_portfolioRuleId_chunkId_key" RENAME TO "LegalRequirementProvenance_legalRequirementRowId_chunkId_key";
ALTER INDEX "LegalRuleContextRelation_fromRuleId_idx" RENAME TO "LegalRequirementContextRelation_fromRuleId_idx";
ALTER INDEX "LegalRuleContextRelation_portfolioVersionId_relationId_key" RENAME TO "LegalRequirementContextRelation_ruleSetVersionId_relationId_key";
ALTER INDEX "LegalPortfolioActivationRecord_portfolioVersionId_key" RENAME TO "ComplianceRuleSetActivationRecord_ruleSetVersionId_key";
ALTER INDEX "LegalPortfolioActivationRecord_preparationRunId_key" RENAME TO "ComplianceRuleSetActivationRecord_preparationRunId_key";
ALTER INDEX "LegalPortfolioActivationRecord_idempotencyKey_key" RENAME TO "ComplianceRuleSetActivationRecord_idempotencyKey_key";
ALTER INDEX "LegalPortfolioActivationRecord_previousActivePortfolioVersi_idx" RENAME TO "ComplianceRuleSetActivationRecord_previousActiveRuleSetVers_idx";
ALTER INDEX "LegalDocumentChunk_id_legalCorpusVersionId_key" RENAME TO "LegalDocumentChunk_id_legalSourceVersionId_key";
ALTER INDEX "LegalPortfolioVersion_single_active_idx" RENAME TO "ComplianceRuleSetVersion_single_active_idx";
ALTER INDEX "AssessmentCase_assessmentId_legalPortfolioVersionId_key" RENAME TO "AssessmentCase_assessmentId_ruleSetVersionId_key";
ALTER INDEX "AssessmentRuleDecision_assessmentId_engineeringRuleId_scope_key" RENAME TO "AssessmentRuleDecision_assessmentId_assessmentRuleId_scopeI_key";

ALTER TRIGGER "LegalPortfolioVersion_guard" ON "ComplianceRuleSetVersion" RENAME TO "ComplianceRuleSetVersion_guard";
ALTER TRIGGER "LegalPortfolioRule_immutable" ON "LegalRequirement" RENAME TO "LegalRequirement_immutable";
ALTER TRIGGER "EngineeringRule_immutable" ON "AssessmentRule" RENAME TO "AssessmentRule_immutable";
ALTER TRIGGER "EngineeringRuleLegalRule_immutable" ON "AssessmentRuleLegalRequirement" RENAME TO "AssessmentRuleLegalRequirement_immutable";
ALTER TRIGGER "LegalRuleProvenance_immutable" ON "LegalRequirementProvenance" RENAME TO "LegalRequirementProvenance_immutable";
ALTER TRIGGER "LegalRuleContextRelation_immutable" ON "LegalRequirementContextRelation" RENAME TO "LegalRequirementContextRelation_immutable";
ALTER TRIGGER "LegalPortfolioActivationRecord_immutable" ON "ComplianceRuleSetActivationRecord" RENAME TO "ComplianceRuleSetActivationRecord_immutable";

-- Trigger function bodies contain textual SQL references; replace only the names.
ALTER FUNCTION "lcsp_legal_portfolio_guard"() RENAME TO "lcsp_compliance_rule_set_guard";
CREATE OR REPLACE FUNCTION public.lcsp_compliance_rule_set_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compliance rule set versions are immutable history and cannot be deleted';
  END IF;
  IF NEW."version" <> OLD."version"
     OR NEW."legalSourceVersionId" <> OLD."legalSourceVersionId"
     OR NEW."preparationRunId" <> OLD."preparationRunId"
     OR NEW."ruleSetDigest" <> OLD."ruleSetDigest" THEN
    RAISE EXCEPTION 'compliance rule set identity is immutable';
  END IF;
  IF OLD."validationOutcome" IS NOT NULL AND (
       NEW."validationOutcome" IS DISTINCT FROM OLD."validationOutcome"
       OR NEW."validationFailures" IS DISTINCT FROM OLD."validationFailures") THEN
    RAISE EXCEPTION 'compliance rule set validation result is immutable once recorded';
  END IF;
  IF NEW."lifecycleState" <> OLD."lifecycleState" AND NOT (
       (OLD."lifecycleState" = 'BUILDING' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
    OR (OLD."lifecycleState" = 'ACTIVE' AND NEW."lifecycleState" IN ('SUPERSEDED', 'INVALID'))
    OR (OLD."lifecycleState" = 'SUPERSEDED' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
  ) THEN
    RAISE EXCEPTION 'illegal compliance rule set lifecycle transition % -> %', OLD."lifecycleState", NEW."lifecycleState";
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION "lcsp_legal_portfolio_immutable"() RENAME TO "lcsp_compliance_rule_set_immutable";
CREATE OR REPLACE FUNCTION public.lcsp_compliance_rule_set_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION '% rows are immutable once written', TG_TABLE_NAME;
END;
$function$;
CREATE OR REPLACE FUNCTION public.lcsp_assessment_case_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  rule_set_state "ArtifactLifecycleState";
  snapshot_commit text;
  snapshot_assessment text;
  job_snapshot text;
BEGIN
  IF NEW."ruleSetVersionId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD."ruleSetVersionId" IS DISTINCT FROM NEW."ruleSetVersionId") THEN
    IF TG_OP = 'UPDATE' AND OLD."ruleSetVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'assessment compliance rule set pin is immutable' USING ERRCODE = 'check_violation';
    END IF;
    SELECT "lifecycleState" INTO rule_set_state FROM "ComplianceRuleSetVersion" WHERE "id" = NEW."ruleSetVersionId";
    IF rule_set_state IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'an assessment can only pin an ACTIVE compliance rule set' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."ruleSetVersionId" IS NOT NULL AND NEW."ruleSetVersionId" IS NULL THEN
    RAISE EXCEPTION 'assessment compliance rule set pin is immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."repositorySnapshotId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD."repositorySnapshotId" IS DISTINCT FROM NEW."repositorySnapshotId"
          OR OLD."repositoryCommit" IS DISTINCT FROM NEW."repositoryCommit"
          OR OLD."repositoryScanJobId" IS DISTINCT FROM NEW."repositoryScanJobId") THEN
    IF TG_OP = 'UPDATE' AND OLD."repositorySnapshotId" IS NOT NULL THEN
      RAISE EXCEPTION 'assessment repository pin is immutable' USING ERRCODE = 'check_violation';
    END IF;
    SELECT "commitSha", "assessmentId" INTO snapshot_commit, snapshot_assessment
      FROM "RepositorySnapshot" WHERE "id" = NEW."repositorySnapshotId";
    IF snapshot_assessment IS DISTINCT FROM NEW."assessmentId" OR lower(snapshot_commit) IS DISTINCT FROM NEW."repositoryCommit" THEN
      RAISE EXCEPTION 'repository pin must match its own snapshot and commit' USING ERRCODE = 'check_violation';
    END IF;
    SELECT "snapshotId" INTO job_snapshot FROM "RepositoryScanJob"
      WHERE "id" = NEW."repositoryScanJobId" AND "assessmentId" = NEW."assessmentId";
    IF job_snapshot IS DISTINCT FROM NEW."repositorySnapshotId" THEN
      RAISE EXCEPTION 'repository scan job must belong to the pinned snapshot' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."repositorySnapshotId" IS NOT NULL AND NEW."repositorySnapshotId" IS NULL THEN
    RAISE EXCEPTION 'assessment repository pin is immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."caseRevision" < OLD."caseRevision" THEN
    RAISE EXCEPTION 'case revision cannot move backwards' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."ruleSetVersionId" IS NOT NULL AND NEW."pinnedAt" IS NULL THEN
    NEW."pinnedAt" := now();
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.lcsp_assessment_decision_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  case_commit text;
  case_revision integer;
  previous_revision integer;
  rule_version text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "repositoryCommit", "caseRevision" INTO case_commit, case_revision
      FROM "AssessmentCase" WHERE "assessmentId" = NEW."assessmentId";
    IF case_commit IS NULL OR case_commit <> NEW."repositoryCommit" THEN
      RAISE EXCEPTION 'decision must be pinned to the assessment repository commit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."caseRevision" <> case_revision THEN
      RAISE EXCEPTION 'decision case revision is stale' USING ERRCODE = 'check_violation';
    END IF;
    SELECT "assessmentRuleVersion" INTO rule_version FROM "AssessmentRule"
      WHERE "ruleSetVersionId" = NEW."ruleSetVersionId" AND "assessmentRuleId" = NEW."assessmentRuleId";
    IF rule_version IS DISTINCT FROM NEW."assessmentRuleVersion" THEN
      RAISE EXCEPTION 'decision rule version must match the pinned assessment rule' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(max("decisionRevision"), 0) INTO previous_revision FROM "AssessmentRuleDecision"
      WHERE "assessmentId" = NEW."assessmentId" AND "assessmentRuleId" = NEW."assessmentRuleId" AND "scopeId" = NEW."scopeId";
    IF NEW."decisionRevision" <> previous_revision + 1 THEN
      RAISE EXCEPTION 'decision revision must advance by exactly one' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."state" <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'decisions are created ACCEPTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."decisionId", OLD."assessmentId", OLD."ruleSetVersionId", OLD."assessmentRuleId", OLD."assessmentRuleVersion",
      OLD."scopeId", OLD."decisionRevision", OLD."applicability", OLD."compliance", OLD."repositoryCommit", OLD."caseRevision",
      OLD."idempotencyKey", OLD."requestDigest", OLD."decision"::text, OLD."createdAt")
     IS DISTINCT FROM
     (NEW."decisionId", NEW."assessmentId", NEW."ruleSetVersionId", NEW."assessmentRuleId", NEW."assessmentRuleVersion",
      NEW."scopeId", NEW."decisionRevision", NEW."applicability", NEW."compliance", NEW."repositoryCommit", NEW."caseRevision",
      NEW."idempotencyKey", NEW."requestDigest", NEW."decision"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'decision history is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (OLD."state" = 'ACCEPTED' AND NEW."state" IN ('SUPERSEDED', 'INVALIDATED')) THEN
    RAISE EXCEPTION 'decision state may only move ACCEPTED -> SUPERSEDED|INVALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.lcsp_assessment_coverage_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE decision_rule text; decision_state "AssessmentDecisionRecordState";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."resolutionState" <> 'PENDING' OR NEW."currentDecisionId" IS NOT NULL THEN
      RAISE EXCEPTION 'decision coverage starts PENDING without a decision' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."assessmentId", OLD."assessmentRuleId", OLD."ruleSetVersionId", OLD."assessmentRuleVersion")
     IS DISTINCT FROM (NEW."assessmentId", NEW."assessmentRuleId", NEW."ruleSetVersionId", NEW."assessmentRuleVersion") THEN
    RAISE EXCEPTION 'decision coverage identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resolutionState" <> NEW."resolutionState" AND NOT (
       (OLD."resolutionState" = 'PENDING' AND NEW."resolutionState" = 'INVESTIGATING')
    OR (OLD."resolutionState" = 'INVESTIGATING' AND NEW."resolutionState" IN ('WAITING_FOR_INPUT', 'RESOLVED', 'INVALIDATED'))
    OR (OLD."resolutionState" = 'WAITING_FOR_INPUT' AND NEW."resolutionState" IN ('INVESTIGATING', 'RESOLVED', 'INVALIDATED'))
    OR (OLD."resolutionState" = 'RESOLVED' AND NEW."resolutionState" = 'INVALIDATED')
    OR (OLD."resolutionState" = 'INVALIDATED' AND NEW."resolutionState" = 'INVESTIGATING')
  ) THEN
    RAISE EXCEPTION 'illegal decision-resolution transition % -> %', OLD."resolutionState", NEW."resolutionState" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."resolutionState" = 'RESOLVED' THEN
    SELECT "assessmentRuleId", "state" INTO decision_rule, decision_state FROM "AssessmentRuleDecision"
      WHERE "decisionId" = NEW."currentDecisionId" AND "assessmentId" = NEW."assessmentId";
    IF decision_rule IS DISTINCT FROM NEW."assessmentRuleId" OR decision_state IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'RESOLVED requires the rule''s ACCEPTED decision' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.lcsp_assessment_human_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'human requests are created OPEN' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."requestId", OLD."assessmentId", OLD."threadId", OLD."caseRevision", OLD."assessmentRuleId", OLD."criterionIds"::text,
      OLD."question", OLD."unresolvedFact", OLD."decisionImpact"::text, OLD."resolutionAttempts"::text, OLD."controlType", OLD."choices"::text, OLD."createdAt")
     IS DISTINCT FROM
     (NEW."requestId", NEW."assessmentId", NEW."threadId", NEW."caseRevision", NEW."assessmentRuleId", NEW."criterionIds"::text,
      NEW."question", NEW."unresolvedFact", NEW."decisionImpact"::text, NEW."resolutionAttempts"::text, NEW."controlType", NEW."choices"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'the human request content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'OPEN' AND (OLD."status" <> NEW."status" OR OLD."answers"::text <> NEW."answers"::text) THEN
    RAISE EXCEPTION 'a closed human request is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.lcsp_assessment_artifact_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."lifecycleState" <> 'BUILDING' THEN
      RAISE EXCEPTION 'artifacts start BUILDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."lifecycleState" <> NEW."lifecycleState" AND NOT (
       (OLD."lifecycleState" = 'BUILDING' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
    OR (OLD."lifecycleState" = 'ACTIVE' AND NEW."lifecycleState" IN ('SUPERSEDED', 'INVALID'))
    OR (OLD."lifecycleState" = 'SUPERSEDED' AND NEW."lifecycleState" IN ('ACTIVE', 'INVALID'))
  ) THEN
    RAISE EXCEPTION 'illegal artifact lifecycle transition % -> %', OLD."lifecycleState", NEW."lifecycleState" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."lifecycleState" <> 'BUILDING' AND
     (OLD."ruleSetVersionId", OLD."repositorySnapshotId", OLD."repositoryCommit", OLD."caseRevision", OLD."schemaVersion",
      OLD."contentSha256", OLD."sizeBytes", OLD."storageRef", OLD."kind", OLD."reportRequestDigest")
     IS DISTINCT FROM
     (NEW."ruleSetVersionId", NEW."repositorySnapshotId", NEW."repositoryCommit", NEW."caseRevision", NEW."schemaVersion",
      NEW."contentSha256", NEW."sizeBytes", NEW."storageRef", NEW."kind", NEW."reportRequestDigest") THEN
    RAISE EXCEPTION 'a published artifact is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.lcsp_assessment_active_requires_pins()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  pinned_rule_set text;
  pinned_snapshot text;
  rule_count integer;
  coverage_count integer;
BEGIN
  IF NEW."lifecycleState" = 'ACTIVE' AND OLD."lifecycleState" IS DISTINCT FROM 'ACTIVE' THEN
    SELECT "ruleSetVersionId", "repositorySnapshotId" INTO pinned_rule_set, pinned_snapshot
      FROM "AssessmentCase" WHERE "assessmentId" = NEW."id";
    IF NOT FOUND OR pinned_rule_set IS NULL OR pinned_snapshot IS NULL THEN
      RAISE EXCEPTION 'an assessment cannot be ACTIVE without a pinned compliance rule set and repository snapshot' USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO rule_count FROM "AssessmentRule" WHERE "ruleSetVersionId" = pinned_rule_set;
    SELECT count(*) INTO coverage_count FROM "AssessmentDecisionCoverage" WHERE "assessmentId" = NEW."id";
    IF rule_count = 0 OR coverage_count <> rule_count THEN
      RAISE EXCEPTION 'decision coverage must exist for every pinned AssessmentRule' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- Index tuple labels are independent of table-column labels; rename them without rebuilding indexes.
ALTER TABLE "AssessmentCase_assessmentId_ruleSetVersionId_key" RENAME COLUMN "legalPortfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentDecisionCoverage_pkey" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentRuleDecision_assessmentId_assessmentRuleId_scopeI_key" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentRuleDecision_one_accepted_per_scope" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "AssessmentRuleLegalRequirement_legalRequirementRowId_idx" RENAME COLUMN "portfolioRuleId" TO "legalRequirementRowId";
ALTER TABLE "AssessmentRuleLegalRequirement_pkey" RENAME COLUMN "engineeringRuleRowId" TO "assessmentRuleRowId";
ALTER TABLE "AssessmentRuleLegalRequirement_pkey" RENAME COLUMN "portfolioRuleId" TO "legalRequirementRowId";
ALTER TABLE "AssessmentRule_id_ruleSetVersionId_key" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentRule_ruleSetVersionId_assessmentRuleId_key" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "AssessmentRule_ruleSetVersionId_assessmentRuleId_key" RENAME COLUMN "engineeringRuleId" TO "assessmentRuleId";
ALTER TABLE "ComplianceRuleSetActivationRecord_previousActiveRuleSetVers_idx" RENAME COLUMN "previousActivePortfolioVersionId" TO "previousActiveRuleSetVersionId";
ALTER TABLE "ComplianceRuleSetActivationRecord_ruleSetVersionId_key" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "ComplianceRuleSetVersion_id_legalSourceVersionId_key" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "ComplianceRuleSetVersion_legalSourceVersionId_idx" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalDocumentChunk_id_legalSourceVersionId_key" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalDocumentChunk_legalSourceVersionId_documentId_idx" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalDocumentChunk_legalSourceVersionId_documentId_locator_key" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalDocumentChunk_legalSourceVersionId_legalStatus_idx" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalRequirementContextRelation_ruleSetVersionId_relationId_key" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirementProvenance_legalRequirementRowId_chunkId_key" RENAME COLUMN "portfolioRuleId" TO "legalRequirementRowId";
ALTER TABLE "LegalRequirementProvenance_ruleSetVersionId_idx" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirement_id_ruleSetVersionId_key" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirement_ruleSetVersionId_legalRequirementId_key" RENAME COLUMN "portfolioVersionId" TO "ruleSetVersionId";
ALTER TABLE "LegalRequirement_ruleSetVersionId_legalRequirementId_key" RENAME COLUMN "legalRuleId" TO "legalRequirementId";
ALTER TABLE "LegalRetrievalIndex_legalSourceVersionId_status_validatedAt_idx" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalSourceActivationRecord_legalSourceVersionId_idx" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "LegalSourceDocument_legalSourceVersionId_documentId_key" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";
ALTER TABLE "RuleSetPreparationRun_legalSourceVersionId_idx" RENAME COLUMN "legalCorpusVersionId" TO "legalSourceVersionId";

-- Published/cancelled event history and every payload are retained verbatim.
UPDATE "OutboxMessage" SET "eventType" = CASE "eventType"
  WHEN 'event.legal-corpus.activated.v1' THEN 'event.legal-source.activated.v1'
  WHEN 'legal_corpus.ingested' THEN 'legal_source.ingested'
  WHEN 'command.reviewed-corpus-input.build.v1' THEN 'command.reviewed-legal-source-input.build.v1'
  WHEN 'cron.legal-catalog.check-updates.v1' THEN 'cron.legal-source.check-updates.v1'
 END
 WHERE "status" IN ('PENDING','FAILED','DLQ')
 AND "eventType" IN ('event.legal-corpus.activated.v1','legal_corpus.ingested','command.reviewed-corpus-input.build.v1','cron.legal-catalog.check-updates.v1');
COMMIT;

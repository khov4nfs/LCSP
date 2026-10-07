-- W3 assessment domain: expand-only. Adds the authoritative case/evidence/request/decision
-- ledgers next to the W1 runtime tables; V1 tables are untouched (archive W6, removal W7).
-- CreateEnum
CREATE TYPE "AssessmentEvidenceType" AS ENUM ('REPOSITORY_SOURCE', 'SEARCH_COVERAGE');

-- CreateEnum
CREATE TYPE "AssessmentRecordState" AS ENUM ('ACCEPTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "AssessmentFactKind" AS ENUM ('FACT', 'USE_CASE');

-- CreateEnum
CREATE TYPE "AssessmentFactAuthority" AS ENUM ('EVIDENCE_CITED', 'HUMAN_PROVIDED');

-- CreateEnum
CREATE TYPE "AssessmentDecisionRecordState" AS ENUM ('ACCEPTED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DecisionResolutionState" AS ENUM ('PENDING', 'INVESTIGATING', 'WAITING_FOR_INPUT', 'RESOLVED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "HumanResolutionRequestStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RuleDecisionApplicability" AS ENUM ('APPLICABLE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "RuleDecisionComplianceOutcome" AS ENUM ('COMPLIANT', 'NON_COMPLIANT');

-- CreateEnum
CREATE TYPE "AssessmentArtifactKind" AS ENUM ('FINAL_REPORT');

-- CreateTable
CREATE TABLE "AssessmentCase" (
    "assessmentId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL DEFAULT 0,
    "legalPortfolioVersionId" TEXT,
    "repositorySnapshotId" TEXT,
    "repositoryScanJobId" TEXT,
    "repositoryCommit" TEXT,
    "pinnedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentCase_pkey" PRIMARY KEY ("assessmentId")
);

-- CreateTable
CREATE TABLE "AssessmentEvidence" (
    "evidenceId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "type" "AssessmentEvidenceType" NOT NULL,
    "state" "AssessmentRecordState" NOT NULL DEFAULT 'ACCEPTED',
    "repositoryCommit" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentEvidence_pkey" PRIMARY KEY ("evidenceId")
);

-- CreateTable
CREATE TABLE "AssessmentCaseFact" (
    "factId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "kind" "AssessmentFactKind" NOT NULL,
    "authority" "AssessmentFactAuthority" NOT NULL,
    "state" "AssessmentRecordState" NOT NULL DEFAULT 'ACCEPTED',
    "statement" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentCaseFact_pkey" PRIMARY KEY ("factId")
);

-- CreateTable
CREATE TABLE "AssessmentCaseFactEvidence" (
    "assessmentId" TEXT NOT NULL,
    "factId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "AssessmentCaseFactEvidence_pkey" PRIMARY KEY ("factId","evidenceId")
);

-- CreateTable
CREATE TABLE "AssessmentRuleDecision" (
    "decisionId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "engineeringRuleId" TEXT NOT NULL,
    "engineeringRuleVersion" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "decisionRevision" INTEGER NOT NULL,
    "state" "AssessmentDecisionRecordState" NOT NULL DEFAULT 'ACCEPTED',
    "applicability" "RuleDecisionApplicability" NOT NULL,
    "compliance" "RuleDecisionComplianceOutcome",
    "repositoryCommit" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "decision" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),
    "invalidatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentRuleDecision_pkey" PRIMARY KEY ("decisionId")
);

-- CreateTable
CREATE TABLE "AssessmentDecisionCoverage" (
    "assessmentId" TEXT NOT NULL,
    "engineeringRuleId" TEXT NOT NULL,
    "portfolioVersionId" TEXT NOT NULL,
    "engineeringRuleVersion" TEXT NOT NULL,
    "resolutionState" "DecisionResolutionState" NOT NULL DEFAULT 'PENDING',
    "currentDecisionId" UUID,
    "decisionRevision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentDecisionCoverage_pkey" PRIMARY KEY ("assessmentId","engineeringRuleId")
);

-- CreateTable
CREATE TABLE "AssessmentHumanRequest" (
    "requestId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "status" "HumanResolutionRequestStatus" NOT NULL DEFAULT 'OPEN',
    "caseRevision" INTEGER NOT NULL,
    "engineeringRuleId" TEXT NOT NULL,
    "criterionIds" JSONB NOT NULL,
    "question" TEXT NOT NULL,
    "unresolvedFact" TEXT NOT NULL,
    "decisionImpact" JSONB NOT NULL,
    "resolutionAttempts" JSONB NOT NULL,
    "controlType" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "resolvedFactId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentHumanRequest_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "AssessmentArtifact" (
    "artifactId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "kind" "AssessmentArtifactKind" NOT NULL,
    "lifecycleState" "ArtifactLifecycleState" NOT NULL DEFAULT 'BUILDING',
    "legalPortfolioVersionId" TEXT NOT NULL,
    "repositorySnapshotId" TEXT NOT NULL,
    "repositoryCommit" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentSha256" TEXT,
    "sizeBytes" INTEGER,
    "storageRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentArtifact_pkey" PRIMARY KEY ("artifactId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCase_assessmentId_legalPortfolioVersionId_key" ON "AssessmentCase"("assessmentId", "legalPortfolioVersionId");

-- CreateIndex
CREATE INDEX "AssessmentEvidence_assessmentId_state_idx" ON "AssessmentEvidence"("assessmentId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvidence_evidenceId_assessmentId_key" ON "AssessmentEvidence"("evidenceId", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCaseFact_assessmentId_caseRevision_key" ON "AssessmentCaseFact"("assessmentId", "caseRevision");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCaseFact_factId_assessmentId_key" ON "AssessmentCaseFact"("factId", "assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentCaseFactEvidence_evidenceId_idx" ON "AssessmentCaseFactEvidence"("evidenceId");

-- CreateIndex
CREATE INDEX "AssessmentRuleDecision_assessmentId_state_idx" ON "AssessmentRuleDecision"("assessmentId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRuleDecision_assessmentId_engineeringRuleId_scope_key" ON "AssessmentRuleDecision"("assessmentId", "engineeringRuleId", "scopeId", "decisionRevision");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRuleDecision_assessmentId_idempotencyKey_key" ON "AssessmentRuleDecision"("assessmentId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRuleDecision_decisionId_assessmentId_key" ON "AssessmentRuleDecision"("decisionId", "assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentDecisionCoverage_assessmentId_resolutionState_idx" ON "AssessmentDecisionCoverage"("assessmentId", "resolutionState");

-- CreateIndex
CREATE INDEX "AssessmentHumanRequest_assessmentId_status_idx" ON "AssessmentHumanRequest"("assessmentId", "status");

-- CreateIndex
CREATE INDEX "AssessmentArtifact_assessmentId_lifecycleState_idx" ON "AssessmentArtifact"("assessmentId", "lifecycleState");

-- AddForeignKey
ALTER TABLE "AssessmentCase" ADD CONSTRAINT "AssessmentCase_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentCase" ADD CONSTRAINT "AssessmentCase_legalPortfolioVersionId_fkey" FOREIGN KEY ("legalPortfolioVersionId") REFERENCES "LegalPortfolioVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentEvidence" ADD CONSTRAINT "AssessmentEvidence_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentCaseFact" ADD CONSTRAINT "AssessmentCaseFact_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentCaseFactEvidence" ADD CONSTRAINT "AssessmentCaseFactEvidence_factId_assessmentId_fkey" FOREIGN KEY ("factId", "assessmentId") REFERENCES "AssessmentCaseFact"("factId", "assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentCaseFactEvidence" ADD CONSTRAINT "AssessmentCaseFactEvidence_evidenceId_assessmentId_fkey" FOREIGN KEY ("evidenceId", "assessmentId") REFERENCES "AssessmentEvidence"("evidenceId", "assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentRuleDecision" ADD CONSTRAINT "AssessmentRuleDecision_assessmentId_portfolioVersionId_fkey" FOREIGN KEY ("assessmentId", "portfolioVersionId") REFERENCES "AssessmentCase"("assessmentId", "legalPortfolioVersionId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentRuleDecision" ADD CONSTRAINT "AssessmentRuleDecision_portfolioVersionId_engineeringRuleI_fkey" FOREIGN KEY ("portfolioVersionId", "engineeringRuleId") REFERENCES "EngineeringRule"("portfolioVersionId", "engineeringRuleId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentDecisionCoverage" ADD CONSTRAINT "AssessmentDecisionCoverage_assessmentId_portfolioVersionId_fkey" FOREIGN KEY ("assessmentId", "portfolioVersionId") REFERENCES "AssessmentCase"("assessmentId", "legalPortfolioVersionId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentDecisionCoverage" ADD CONSTRAINT "AssessmentDecisionCoverage_portfolioVersionId_engineeringR_fkey" FOREIGN KEY ("portfolioVersionId", "engineeringRuleId") REFERENCES "EngineeringRule"("portfolioVersionId", "engineeringRuleId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentDecisionCoverage" ADD CONSTRAINT "AssessmentDecisionCoverage_currentDecisionId_assessmentId_fkey" FOREIGN KEY ("currentDecisionId", "assessmentId") REFERENCES "AssessmentRuleDecision"("decisionId", "assessmentId") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentHumanRequest" ADD CONSTRAINT "AssessmentHumanRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentHumanRequest" ADD CONSTRAINT "AssessmentHumanRequest_assessmentId_threadId_fkey" FOREIGN KEY ("assessmentId", "threadId") REFERENCES "AssessmentRuntime"("assessmentId", "threadId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentArtifact" ADD CONSTRAINT "AssessmentArtifact_assessmentId_legalPortfolioVersionId_fkey" FOREIGN KEY ("assessmentId", "legalPortfolioVersionId") REFERENCES "AssessmentCase"("assessmentId", "legalPortfolioVersionId") ON DELETE CASCADE ON UPDATE RESTRICT;


-- ================================================================================================
-- W3 database guards (raw SQL; Prisma cannot express them). They enforce mechanical integrity only:
-- pins, immutability, ownership and the decision-resolution transition table. No guard judges legal
-- meaning or decides applicability/compliance.
-- ================================================================================================

ALTER TABLE "AssessmentCase"
  ADD CONSTRAINT "AssessmentCase_caseRevision_nonneg" CHECK ("caseRevision" >= 0),
  ADD CONSTRAINT "AssessmentCase_commit_format" CHECK ("repositoryCommit" IS NULL OR "repositoryCommit" ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  ADD CONSTRAINT "AssessmentCase_repository_pin_complete" CHECK (
    ("repositorySnapshotId" IS NULL) = ("repositoryCommit" IS NULL)
    AND ("repositorySnapshotId" IS NULL) = ("repositoryScanJobId" IS NULL)
  );

ALTER TABLE "AssessmentEvidence"
  ADD CONSTRAINT "AssessmentEvidence_hash_format" CHECK ("contentSha256" ~ '^sha256:[a-f0-9]{64}$'),
  ADD CONSTRAINT "AssessmentEvidence_commit_format" CHECK ("repositoryCommit" ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  ADD CONSTRAINT "AssessmentEvidence_state_consistent" CHECK (("state" = 'INVALIDATED') = ("invalidatedAt" IS NOT NULL));

ALTER TABLE "AssessmentCaseFact"
  ADD CONSTRAINT "AssessmentCaseFact_revision_positive" CHECK ("caseRevision" >= 1),
  ADD CONSTRAINT "AssessmentCaseFact_statement_nonblank" CHECK (length(btrim("statement")) > 0),
  ADD CONSTRAINT "AssessmentCaseFact_state_consistent" CHECK (("state" = 'INVALIDATED') = ("invalidatedAt" IS NOT NULL));

ALTER TABLE "AssessmentRuleDecision"
  ADD CONSTRAINT "AssessmentRuleDecision_revision_positive" CHECK ("decisionRevision" >= 1),
  ADD CONSTRAINT "AssessmentRuleDecision_scope_nonblank" CHECK (length(btrim("scopeId")) > 0),
  ADD CONSTRAINT "AssessmentRuleDecision_commit_format" CHECK ("repositoryCommit" ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  -- A non-applicable rule has no compliance result; an applicable rule must carry one.
  ADD CONSTRAINT "AssessmentRuleDecision_compliance_shape" CHECK (("applicability" = 'NOT_APPLICABLE') = ("compliance" IS NULL)),
  ADD CONSTRAINT "AssessmentRuleDecision_state_consistent" CHECK (
    (("state" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL))
    AND (("state" = 'INVALIDATED') = ("invalidatedAt" IS NOT NULL))
  );
CREATE UNIQUE INDEX "AssessmentRuleDecision_one_accepted_per_scope"
  ON "AssessmentRuleDecision" ("assessmentId", "engineeringRuleId", "scopeId") WHERE "state" = 'ACCEPTED';

ALTER TABLE "AssessmentDecisionCoverage"
  ADD CONSTRAINT "AssessmentDecisionCoverage_revision_nonneg" CHECK ("decisionRevision" >= 0),
  -- RESOLVED is only reachable through an accepted decision.
  ADD CONSTRAINT "AssessmentDecisionCoverage_resolved_has_decision" CHECK ("resolutionState" <> 'RESOLVED' OR "currentDecisionId" IS NOT NULL);

ALTER TABLE "AssessmentHumanRequest"
  ADD CONSTRAINT "AssessmentHumanRequest_resolved_shape" CHECK (
    ("status" = 'RESOLVED') = ("resolvedFactId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "AssessmentHumanRequest_question_nonblank" CHECK (length(btrim("question")) > 0),
  ADD CONSTRAINT "AssessmentHumanRequest_resolved_fact_fkey"
    FOREIGN KEY ("resolvedFactId", "assessmentId") REFERENCES "AssessmentCaseFact" ("factId", "assessmentId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AssessmentArtifact"
  ADD CONSTRAINT "AssessmentArtifact_active_is_complete" CHECK (
    "lifecycleState" <> 'ACTIVE'
    OR ("contentSha256" IS NOT NULL AND "sizeBytes" IS NOT NULL AND "storageRef" IS NOT NULL AND "activatedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "AssessmentArtifact_hash_format" CHECK ("contentSha256" IS NULL OR "contentSha256" ~ '^sha256:[a-f0-9]{64}$');
CREATE UNIQUE INDEX "AssessmentArtifact_one_active_per_kind"
  ON "AssessmentArtifact" ("assessmentId", "kind") WHERE "lifecycleState" = 'ACTIVE';

-- ---- Case pins: portfolio must be ACTIVE when pinned; repository pin must match its snapshot; ------
-- ---- pins are set once; the case revision only moves forward. ------------------------------------
CREATE FUNCTION lcsp_assessment_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  portfolio_state "ArtifactLifecycleState";
  snapshot_commit text;
  snapshot_assessment text;
  job_snapshot text;
BEGIN
  IF NEW."legalPortfolioVersionId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD."legalPortfolioVersionId" IS DISTINCT FROM NEW."legalPortfolioVersionId") THEN
    IF TG_OP = 'UPDATE' AND OLD."legalPortfolioVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'assessment legal portfolio pin is immutable' USING ERRCODE = 'check_violation';
    END IF;
    SELECT "lifecycleState" INTO portfolio_state FROM "LegalPortfolioVersion" WHERE "id" = NEW."legalPortfolioVersionId";
    IF portfolio_state IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'an assessment can only pin an ACTIVE legal portfolio' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."legalPortfolioVersionId" IS NOT NULL AND NEW."legalPortfolioVersionId" IS NULL THEN
    RAISE EXCEPTION 'assessment legal portfolio pin is immutable' USING ERRCODE = 'check_violation';
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
  IF NEW."legalPortfolioVersionId" IS NOT NULL AND NEW."pinnedAt" IS NULL THEN
    NEW."pinnedAt" := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentCase_guard" BEFORE INSERT OR UPDATE ON "AssessmentCase"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_case_guard();

-- ---- Evidence: pinned to the case's repository commit; immutable except ACCEPTED -> INVALIDATED. --
CREATE FUNCTION lcsp_assessment_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_commit text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "repositoryCommit" INTO case_commit FROM "AssessmentCase" WHERE "assessmentId" = NEW."assessmentId";
    IF case_commit IS NULL OR case_commit <> NEW."repositoryCommit" THEN
      RAISE EXCEPTION 'evidence must be pinned to the assessment repository commit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."state" <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'evidence is created ACCEPTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."evidenceId", OLD."assessmentId", OLD."type", OLD."repositoryCommit", OLD."contentSha256", OLD."payload"::text, OLD."createdAt")
     IS DISTINCT FROM (NEW."evidenceId", NEW."assessmentId", NEW."type", NEW."repositoryCommit", NEW."contentSha256", NEW."payload"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'accepted evidence is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (OLD."state" = 'ACCEPTED' AND NEW."state" = 'INVALIDATED') THEN
    RAISE EXCEPTION 'evidence state may only move ACCEPTED -> INVALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentEvidence_guard" BEFORE INSERT OR UPDATE ON "AssessmentEvidence"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_evidence_guard();

-- ---- Facts: one fact per case revision, aligned with the case row; immutable except invalidation. --
CREATE FUNCTION lcsp_assessment_fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "caseRevision" INTO current_revision FROM "AssessmentCase" WHERE "assessmentId" = NEW."assessmentId";
    IF current_revision IS NULL OR NEW."caseRevision" <> current_revision THEN
      RAISE EXCEPTION 'a fact must be created at the current case revision' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."state" <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'facts are created ACCEPTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."factId", OLD."assessmentId", OLD."caseRevision", OLD."kind", OLD."authority", OLD."statement", OLD."createdAt")
     IS DISTINCT FROM (NEW."factId", NEW."assessmentId", NEW."caseRevision", NEW."kind", NEW."authority", NEW."statement", NEW."createdAt") THEN
    RAISE EXCEPTION 'accepted facts are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (OLD."state" = 'ACCEPTED' AND NEW."state" = 'INVALIDATED') THEN
    RAISE EXCEPTION 'fact state may only move ACCEPTED -> INVALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentCaseFact_guard" BEFORE INSERT OR UPDATE ON "AssessmentCaseFact"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_fact_guard();

-- A fact can only cite ACCEPTED evidence, and fact/evidence links are immutable.
CREATE FUNCTION lcsp_assessment_fact_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence_state "AssessmentRecordState";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'fact evidence links are immutable' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "state" INTO evidence_state FROM "AssessmentEvidence" WHERE "evidenceId" = NEW."evidenceId";
  IF evidence_state IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'a fact can only cite ACCEPTED evidence' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentCaseFactEvidence_guard" BEFORE INSERT OR UPDATE ON "AssessmentCaseFactEvidence"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_fact_evidence_guard();

-- ---- Decisions: pinned to the case, revision allocated by the database, immutable history. -------
CREATE FUNCTION lcsp_assessment_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    SELECT "engineeringRuleVersion" INTO rule_version FROM "EngineeringRule"
      WHERE "portfolioVersionId" = NEW."portfolioVersionId" AND "engineeringRuleId" = NEW."engineeringRuleId";
    IF rule_version IS DISTINCT FROM NEW."engineeringRuleVersion" THEN
      RAISE EXCEPTION 'decision rule version must match the pinned portfolio rule' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(max("decisionRevision"), 0) INTO previous_revision FROM "AssessmentRuleDecision"
      WHERE "assessmentId" = NEW."assessmentId" AND "engineeringRuleId" = NEW."engineeringRuleId" AND "scopeId" = NEW."scopeId";
    IF NEW."decisionRevision" <> previous_revision + 1 THEN
      RAISE EXCEPTION 'decision revision must advance by exactly one' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."state" <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'decisions are created ACCEPTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."decisionId", OLD."assessmentId", OLD."portfolioVersionId", OLD."engineeringRuleId", OLD."engineeringRuleVersion",
      OLD."scopeId", OLD."decisionRevision", OLD."applicability", OLD."compliance", OLD."repositoryCommit", OLD."caseRevision",
      OLD."idempotencyKey", OLD."requestDigest", OLD."decision"::text, OLD."createdAt")
     IS DISTINCT FROM
     (NEW."decisionId", NEW."assessmentId", NEW."portfolioVersionId", NEW."engineeringRuleId", NEW."engineeringRuleVersion",
      NEW."scopeId", NEW."decisionRevision", NEW."applicability", NEW."compliance", NEW."repositoryCommit", NEW."caseRevision",
      NEW."idempotencyKey", NEW."requestDigest", NEW."decision"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'decision history is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (OLD."state" = 'ACCEPTED' AND NEW."state" IN ('SUPERSEDED', 'INVALIDATED')) THEN
    RAISE EXCEPTION 'decision state may only move ACCEPTED -> SUPERSEDED|INVALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentRuleDecision_guard" BEFORE INSERT OR UPDATE ON "AssessmentRuleDecision"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_decision_guard();

-- ---- Decision-resolution coverage: the exhaustive DRS transition table (freeze section 3.3). ----
CREATE FUNCTION lcsp_assessment_coverage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE decision_rule text; decision_state "AssessmentDecisionRecordState";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."resolutionState" <> 'PENDING' OR NEW."currentDecisionId" IS NOT NULL THEN
      RAISE EXCEPTION 'decision coverage starts PENDING without a decision' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."assessmentId", OLD."engineeringRuleId", OLD."portfolioVersionId", OLD."engineeringRuleVersion")
     IS DISTINCT FROM (NEW."assessmentId", NEW."engineeringRuleId", NEW."portfolioVersionId", NEW."engineeringRuleVersion") THEN
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
    SELECT "engineeringRuleId", "state" INTO decision_rule, decision_state FROM "AssessmentRuleDecision"
      WHERE "decisionId" = NEW."currentDecisionId" AND "assessmentId" = NEW."assessmentId";
    IF decision_rule IS DISTINCT FROM NEW."engineeringRuleId" OR decision_state IS DISTINCT FROM 'ACCEPTED' THEN
      RAISE EXCEPTION 'RESOLVED requires the rule''s ACCEPTED decision' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentDecisionCoverage_guard" BEFORE INSERT OR UPDATE ON "AssessmentDecisionCoverage"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_coverage_guard();

-- ---- Human requests: OPEN is the only mutable status; question content is immutable. -------------
CREATE FUNCTION lcsp_assessment_human_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'human requests are created OPEN' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."requestId", OLD."assessmentId", OLD."threadId", OLD."caseRevision", OLD."engineeringRuleId", OLD."criterionIds"::text,
      OLD."question", OLD."unresolvedFact", OLD."decisionImpact"::text, OLD."resolutionAttempts"::text, OLD."controlType", OLD."choices"::text, OLD."createdAt")
     IS DISTINCT FROM
     (NEW."requestId", NEW."assessmentId", NEW."threadId", NEW."caseRevision", NEW."engineeringRuleId", NEW."criterionIds"::text,
      NEW."question", NEW."unresolvedFact", NEW."decisionImpact"::text, NEW."resolutionAttempts"::text, NEW."controlType", NEW."choices"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'the human request content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'OPEN' AND (OLD."status" <> NEW."status" OR OLD."answers"::text <> NEW."answers"::text) THEN
    RAISE EXCEPTION 'a closed human request is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentHumanRequest_guard" BEFORE INSERT OR UPDATE ON "AssessmentHumanRequest"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_human_request_guard();

-- ---- Artifacts: the ALCS transition table; an ACTIVE artifact's content is immutable. ------------
CREATE FUNCTION lcsp_assessment_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
     (OLD."legalPortfolioVersionId", OLD."repositorySnapshotId", OLD."repositoryCommit", OLD."caseRevision", OLD."schemaVersion",
      OLD."contentSha256", OLD."sizeBytes", OLD."storageRef", OLD."kind")
     IS DISTINCT FROM
     (NEW."legalPortfolioVersionId", NEW."repositorySnapshotId", NEW."repositoryCommit", NEW."caseRevision", NEW."schemaVersion",
      NEW."contentSha256", NEW."sizeBytes", NEW."storageRef", NEW."kind") THEN
    RAISE EXCEPTION 'a published artifact is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentArtifact_guard" BEFORE INSERT OR UPDATE ON "AssessmentArtifact"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_artifact_guard();

-- ---- Entering ACTIVE requires a complete pinned case covering EVERY pinned EngineeringRule. ------
CREATE FUNCTION lcsp_assessment_active_requires_pins() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pinned_portfolio text;
  pinned_snapshot text;
  rule_count integer;
  coverage_count integer;
BEGIN
  IF NEW."lifecycleState" = 'ACTIVE' AND OLD."lifecycleState" IS DISTINCT FROM 'ACTIVE' THEN
    SELECT "legalPortfolioVersionId", "repositorySnapshotId" INTO pinned_portfolio, pinned_snapshot
      FROM "AssessmentCase" WHERE "assessmentId" = NEW."id";
    IF NOT FOUND OR pinned_portfolio IS NULL OR pinned_snapshot IS NULL THEN
      RAISE EXCEPTION 'an assessment cannot be ACTIVE without a pinned legal portfolio and repository snapshot' USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO rule_count FROM "EngineeringRule" WHERE "portfolioVersionId" = pinned_portfolio;
    SELECT count(*) INTO coverage_count FROM "AssessmentDecisionCoverage" WHERE "assessmentId" = NEW."id";
    IF rule_count = 0 OR coverage_count <> rule_count THEN
      RAISE EXCEPTION 'decision coverage must exist for every pinned EngineeringRule' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Assessment_active_requires_pins" BEFORE UPDATE OF "lifecycleState" ON "Assessment"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_active_requires_pins();

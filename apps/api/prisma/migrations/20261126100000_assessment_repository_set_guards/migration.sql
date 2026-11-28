-- Multi-repository Assessment, phase 2: make the database guards understand the repository set.
-- Behavior for single-repository assessments is unchanged: the scalar case pin remains the primary pin
-- (ordinal 0) and stays authoritative for decisions; evidence may now belong to any pinned repository.

-- Evidence: valid when it belongs to a pinned repository of the case.
--  * bound evidence (repositoryKey set) must match that repository's own pin (commit included);
--  * keyless evidence (older rows, human answers) must carry the primary commit or any pinned commit.
-- The repository identity of accepted evidence is immutable together with its other identity columns.
CREATE OR REPLACE FUNCTION lcsp_assessment_evidence_guard() RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE case_commit text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "repositoryCommit" INTO case_commit FROM "AssessmentCase" WHERE "assessmentId" = NEW."assessmentId";
    IF NEW."repositoryKey" IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM "AssessmentCaseRepository" r
        WHERE r."assessmentId" = NEW."assessmentId"
          AND r."repositoryKey" = NEW."repositoryKey"
          AND r."repositoryCommit" = NEW."repositoryCommit"
      ) THEN
        RAISE EXCEPTION 'evidence must be pinned to a repository of the assessment repository set' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF case_commit IS NULL OR (
      case_commit <> NEW."repositoryCommit"
      AND NOT EXISTS (
        SELECT 1 FROM "AssessmentCaseRepository" r
        WHERE r."assessmentId" = NEW."assessmentId" AND r."repositoryCommit" = NEW."repositoryCommit"
      )
    ) THEN
      RAISE EXCEPTION 'evidence must be pinned to the assessment repository commit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."state" <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'evidence is created ACCEPTED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."evidenceId", OLD."assessmentId", OLD."type", OLD."repositoryCommit", OLD."repositoryKey", OLD."contentSha256", OLD."payload"::text, OLD."createdAt")
     IS DISTINCT FROM (NEW."evidenceId", NEW."assessmentId", NEW."type", NEW."repositoryCommit", NEW."repositoryKey", NEW."contentSha256", NEW."payload"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'accepted evidence is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (OLD."state" = 'ACCEPTED' AND NEW."state" = 'INVALIDATED') THEN
    RAISE EXCEPTION 'evidence state may only move ACCEPTED -> INVALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- Decision: still pinned to the primary commit; additionally pinned to the repository set when it carries a
-- digest and the case has one. The digest becomes part of immutable decision history.
CREATE OR REPLACE FUNCTION lcsp_assessment_decision_guard() RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  case_commit text;
  case_revision integer;
  case_digest text;
  previous_revision integer;
  rule_version text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "repositoryCommit", "caseRevision", "repositorySetDigest" INTO case_commit, case_revision, case_digest
      FROM "AssessmentCase" WHERE "assessmentId" = NEW."assessmentId";
    IF case_commit IS NULL OR case_commit <> NEW."repositoryCommit" THEN
      RAISE EXCEPTION 'decision must be pinned to the assessment repository commit' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."repositorySetDigest" IS NOT NULL AND case_digest IS NOT NULL AND NEW."repositorySetDigest" <> case_digest THEN
      RAISE EXCEPTION 'decision must be pinned to the assessment repository set' USING ERRCODE = 'check_violation';
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
      OLD."scopeId", OLD."decisionRevision", OLD."applicability", OLD."compliance", OLD."repositoryCommit", OLD."repositorySetDigest", OLD."caseRevision",
      OLD."idempotencyKey", OLD."requestDigest", OLD."decision"::text, OLD."createdAt")
     IS DISTINCT FROM
     (NEW."decisionId", NEW."assessmentId", NEW."ruleSetVersionId", NEW."assessmentRuleId", NEW."assessmentRuleVersion",
      NEW."scopeId", NEW."decisionRevision", NEW."applicability", NEW."compliance", NEW."repositoryCommit", NEW."repositorySetDigest", NEW."caseRevision",
      NEW."idempotencyKey", NEW."requestDigest", NEW."decision"::text, NEW."createdAt") THEN
    RAISE EXCEPTION 'decision history is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (OLD."state" = 'ACCEPTED' AND NEW."state" IN ('SUPERSEDED', 'INVALIDATED')) THEN
    RAISE EXCEPTION 'decision state may only move ACCEPTED -> SUPERSEDED|INVALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- Audit request: the repository set it was made for is part of its immutable identity.
CREATE OR REPLACE FUNCTION lcsp_guard_rule_audit_request_identity() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (OLD."assessmentId", OLD."requestRevision", OLD."idempotencyKey", OLD."requestDigest", OLD."scopeMode", OLD."ruleSetVersionId", OLD."ruleSetDigest", OLD."repositorySnapshotId", OLD."repositoryCommit", OLD."repositorySetDigest", OLD."requestedAt")
     IS DISTINCT FROM
     (NEW."assessmentId", NEW."requestRevision", NEW."idempotencyKey", NEW."requestDigest", NEW."scopeMode", NEW."ruleSetVersionId", NEW."ruleSetDigest", NEW."repositorySnapshotId", NEW."repositoryCommit", NEW."repositorySetDigest", NEW."requestedAt") THEN
    RAISE EXCEPTION 'audit request identity is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

-- Artifact: a published artifact is immutable including the repository set it reports on.
CREATE OR REPLACE FUNCTION lcsp_assessment_artifact_guard() RETURNS trigger
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
     (OLD."ruleSetVersionId", OLD."repositorySnapshotId", OLD."repositoryCommit", OLD."repositorySetDigest", OLD."caseRevision", OLD."schemaVersion",
      OLD."contentSha256", OLD."sizeBytes", OLD."storageRef", OLD."kind", OLD."reportRequestDigest")
     IS DISTINCT FROM
     (NEW."ruleSetVersionId", NEW."repositorySnapshotId", NEW."repositoryCommit", NEW."repositorySetDigest", NEW."caseRevision", NEW."schemaVersion",
      NEW."contentSha256", NEW."sizeBytes", NEW."storageRef", NEW."kind", NEW."reportRequestDigest") THEN
    RAISE EXCEPTION 'a published artifact is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

-- Repository set pins: every pin is consistent with its own snapshot and scan job when it is recorded, and
-- recorded pins never change. (Removal happens only through the case cascade, which is not a trigger event.)
CREATE OR REPLACE FUNCTION lcsp_assessment_case_repository_guard() RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  snapshot_assessment text;
  snapshot_commit text;
  snapshot_repository text;
  snapshot_connection text;
  snapshot_prefix text;
  job_snapshot text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'assessment repository set pins are immutable' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "assessmentId", "commitSha", "repositoryId", "connectionId", "sourcePathPrefix"
    INTO snapshot_assessment, snapshot_commit, snapshot_repository, snapshot_connection, snapshot_prefix
    FROM "RepositorySnapshot" WHERE "id" = NEW."repositorySnapshotId";
  IF snapshot_assessment IS DISTINCT FROM NEW."assessmentId"
     OR lower(snapshot_commit) IS DISTINCT FROM lower(NEW."repositoryCommit")
     OR snapshot_repository IS DISTINCT FROM NEW."repositoryId"
     OR snapshot_connection IS DISTINCT FROM NEW."connectionId"
     OR snapshot_prefix IS DISTINCT FROM NEW."sourcePathPrefix" THEN
    RAISE EXCEPTION 'repository set pin must match its own snapshot, commit and source scope' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "snapshotId" INTO job_snapshot FROM "RepositoryScanJob"
    WHERE "id" = NEW."repositoryScanJobId" AND "assessmentId" = NEW."assessmentId";
  IF job_snapshot IS DISTINCT FROM NEW."repositorySnapshotId" THEN
    RAISE EXCEPTION 'repository set pin scan job must belong to the pinned snapshot' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER "AssessmentCaseRepository_guard"
  BEFORE INSERT OR UPDATE ON "AssessmentCaseRepository"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_case_repository_guard();

CREATE TRIGGER lcsp_execution_writer_fence
  BEFORE INSERT OR DELETE OR UPDATE ON "AssessmentCaseRepository"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_execution_writer_fence();

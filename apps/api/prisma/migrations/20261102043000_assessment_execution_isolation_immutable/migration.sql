-- Business purpose: Preserve the deployed writer fence itself, including its audit attribution.
-- Business rules: Enrollment is append-only; even a granted application login may
-- not update/delete/truncate it. Only its actual non-privileged login can enroll
-- unstarted work with active ADMIN attribution. SET ROLE cannot change that login.
-- Execution flow:
-- 1. Reject all mutations of existing enrollment and all table truncation.
-- 2. Lock the Assessment and validate login, actor and unstarted canonical state on insert.
-- 3. Permit a new enrollment without changing any existing Assessment or execution.
-- Failure cases: Unauthorized or started enrollment raises 42501; existing rows
-- remain untouched. A DBA capable of disabling triggers remains a trusted boundary.
-- Side effects: Adds guards only; no role transfer, data backfill or history rewrite.
CREATE FUNCTION lcsp_assessment_execution_isolation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND NOT EXISTS (SELECT 1 FROM public."AssessmentExecutionIsolation") THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'LCSP_EXECUTION_ISOLATION_IMMUTABLE' USING ERRCODE = '42501';
  END IF;

  IF NEW."writerRole" <> session_user OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = session_user
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls
  ) OR NOT EXISTS (
    SELECT 1 FROM public."User" WHERE id = NEW."actorId"
      AND role = 'ADMIN' AND "accessStatus" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'LCSP_EXECUTION_ISOLATION_ENROLLMENT_DENIED' USING ERRCODE = '42501';
  END IF;

  -- Share the existing API activation lock; a racing dispatch cannot slip between
  -- the unstarted-state check and enrollment commit.
  PERFORM id FROM public."Assessment" WHERE id = NEW."assessmentId" FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public."Assessment" a
      JOIN public."AssessmentRuntime" r ON r."assessmentId" = a.id
    WHERE a.id = NEW."assessmentId" AND a."lifecycleState" = 'PREPARING'
      AND r."executionState" = 'QUEUED' AND r."currentExecutionId" IS NULL
      AND r."checkpointId" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public."AssessmentRuntimeTurn" WHERE "assessmentId" = NEW."assessmentId"
  ) OR EXISTS (
    SELECT 1 FROM public."AssessmentRootAdmissionRequest" WHERE "assessmentId" = NEW."assessmentId"
  ) OR EXISTS (
    SELECT 1 FROM public."OutboxMessage" WHERE "aggregateId" = NEW."assessmentId"
      AND "eventType" = 'command.assessment.root.requested.v1'
  ) THEN
    RAISE EXCEPTION 'LCSP_EXECUTION_ISOLATION_ENROLLMENT_DENIED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lcsp_execution_isolation_guard
BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentExecutionIsolation"
FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_execution_isolation_guard();

CREATE TRIGGER lcsp_execution_isolation_truncate_guard
BEFORE TRUNCATE ON "AssessmentExecutionIsolation"
FOR EACH STATEMENT EXECUTE FUNCTION lcsp_assessment_execution_isolation_guard();

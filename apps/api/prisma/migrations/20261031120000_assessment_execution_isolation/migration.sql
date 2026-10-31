-- Business purpose: Fence explicitly enrolled, new canaries from mixed-version
-- API publishers/writers sharing this database. Existing Assessments are untouched.
-- Business rules: The database login (not caller-supplied application_name or
-- SET ROLE) owns publication and writes; this is not protection against a malicious
-- database superuser. Normal Root leases and paid/legal gates still apply.
-- Execution flow: Enroll before dispatch, redirect pending/retrying outbox rows to
-- a status old publishers do not select, and reject foreign-login mutations.
-- Failure cases: A foreign writer aborts its transaction with 42501; missing
-- enrollment leaves legacy behavior unchanged. No historical rows are rewritten.
-- Side effects: Adds an opt-in route table and triggers; does not execute work.
ALTER TYPE "OutboxStatus" ADD VALUE 'OWNED_PENDING';

CREATE TABLE "AssessmentExecutionIsolation" (
  "assessmentId" TEXT PRIMARY KEY REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "writerRole" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION lcsp_assessment_execution_writer_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  record_json jsonb;
  assessment_id text;
  writer_role text;
  old_assessment_id text;
BEGIN
  record_json := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  assessment_id := CASE TG_TABLE_NAME
    WHEN 'Assessment' THEN record_json->>'id'
    WHEN 'OutboxMessage' THEN record_json->>'aggregateId'
    ELSE record_json->>'assessmentId'
  END;
  SELECT "writerRole" INTO writer_role FROM public."AssessmentExecutionIsolation"
    WHERE "assessmentId" = assessment_id;
  IF writer_role IS NOT NULL AND writer_role <> session_user THEN
    RAISE LOG 'LCSP_EXECUTION_WRITER_FENCED table=% assessment=% login=%', TG_TABLE_NAME, assessment_id, session_user;
    RAISE EXCEPTION 'LCSP_EXECUTION_WRITER_FENCED' USING ERRCODE = '42501';
  END IF;
  -- Moving a row out of a protected Assessment must not evade its original fence.
  IF TG_OP = 'UPDATE' THEN
    old_assessment_id := CASE TG_TABLE_NAME
      WHEN 'Assessment' THEN to_jsonb(OLD)->>'id'
      WHEN 'OutboxMessage' THEN to_jsonb(OLD)->>'aggregateId'
      ELSE to_jsonb(OLD)->>'assessmentId'
    END;
    IF old_assessment_id IS DISTINCT FROM assessment_id AND EXISTS (
      SELECT 1 FROM public."AssessmentExecutionIsolation"
      WHERE "assessmentId" = old_assessment_id AND "writerRole" <> session_user
    ) THEN
      RAISE EXCEPTION 'LCSP_EXECUTION_WRITER_FENCED' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF writer_role IS NOT NULL AND TG_TABLE_NAME = 'OutboxMessage' AND TG_OP <> 'DELETE'
     AND record_json->>'status' IN ('PENDING', 'FAILED') THEN
    NEW.status := 'OWNED_PENDING';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Also fence owned evidence, decisions, turns, usage and stream rows. This list is
-- derived from the installed canonical schema, including nullable assessmentId.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT DISTINCT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (c.column_name = 'assessmentId' OR c.table_name IN ('Assessment', 'OutboxMessage'))
      AND c.table_name <> 'AssessmentExecutionIsolation'
  LOOP
    EXECUTE format('CREATE TRIGGER lcsp_execution_writer_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_execution_writer_fence()', target.table_name);
  END LOOP;
END;
$$;

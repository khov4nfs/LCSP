-- Rebind only unchanged UNKNOWN requests under a live, server-persisted review authorization.
-- Keep replay identity, append-only history and unknown-fact protections unchanged.
CREATE OR REPLACE FUNCTION lcsp_assessment_human_answer_guard() RETURNS trigger LANGUAGE plpgsql AS $human_review_guard$
DECLARE
  review_authorized BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."requestRevision" <> 0 OR NEW."answers" <> '[]'::jsonb THEN
      RAISE EXCEPTION 'human request starts without answers' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."idempotencyKey", OLD."requestDigest")
       IS DISTINCT FROM (NEW."idempotencyKey", NEW."requestDigest") THEN
    RAISE EXCEPTION 'human request replay identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."checkpointId" IS NOT NULL AND OLD."checkpointId" IS DISTINCT FROM NEW."checkpointId" THEN
    IF OLD."status" = 'OPEN' AND NEW."status" = 'OPEN'
       AND NEW."checkpointId" IS NOT NULL
       AND OLD."requestRevision" = NEW."requestRevision"
       AND OLD."answers" IS NOT DISTINCT FROM NEW."answers"
       AND OLD."resolvedFactId" IS NULL AND NEW."resolvedFactId" IS NULL
       AND (OLD."answers" -> -1 ->> 'doesNotKnow') = 'true'
       AND (OLD."answers" -> -1 -> 'answer') = 'null'::jsonb
       AND (OLD."answers" -> -1 ->> 'checkpointId') = OLD."checkpointId"::text
       AND (OLD."answers" -> -1 -> 'requestRevision') = to_jsonb(OLD."requestRevision") THEN
      SELECT EXISTS (
        SELECT 1
        FROM "AssessmentRuntime" runtime
        JOIN "AssessmentRuntimeTurn" turn
          ON turn."id" = runtime."currentExecutionId"::text
         AND turn."assessmentId" = runtime."assessmentId"
         AND turn."threadId" = runtime."threadId"::text
        JOIN "Assessment" assessment ON assessment."id" = runtime."assessmentId"
        JOIN "AssessmentCase" assessment_case ON assessment_case."assessmentId" = runtime."assessmentId"
        WHERE runtime."assessmentId" = OLD."assessmentId"
          AND runtime."threadId" = OLD."threadId"
          AND runtime."executionState" = 'RUNNING'
          AND runtime."leaseToken" IS NOT NULL
          AND runtime."leaseExpiresAt" > CURRENT_TIMESTAMP
          AND turn."boundary" = 'ASSESSMENT_ROOT'
          -- A review grant cannot be replayed under another selected audit or
          -- checkpoint thread even when both runs belong to the same case.
          AND (turn."contextJson" ->> 'auditRequestId')
            IS NOT DISTINCT FROM runtime."currentAuditRequestId"::text
          AND (
            (
              runtime."currentAuditRequestId" IS NULL
              AND assessment_case."auditMode" = 'LEGACY_FULL'
              AND (
                (turn."contextJson" ->> 'checkpointThreadId') IS NULL
                OR (turn."contextJson" ->> 'checkpointThreadId') = runtime."threadId"::text
              )
            )
            OR (
              runtime."currentAuditRequestId" IS NOT NULL
              AND (turn."contextJson" ->> 'checkpointThreadId') = runtime."currentAuditRequestId"::text
              AND EXISTS (
                SELECT 1
                FROM "AssessmentRuleAuditRequest" audit_request
                JOIN "AssessmentRuleAuditItem" audit_item
                  ON audit_item."requestId" = audit_request."requestId"
                JOIN "AssessmentHumanRequestDependency" dependency
                  ON dependency."assessmentId" = runtime."assessmentId"
                 AND dependency."assessmentRuleId" = audit_item."assessmentRuleId"
                 AND dependency."requestId" = OLD."requestId"
                WHERE audit_request."requestId" = runtime."currentAuditRequestId"
                  AND audit_request."assessmentId" = runtime."assessmentId"
              )
            )
          )
          AND (assessment."lifecycleState" = 'WAITING_FOR_HUMAN'
            OR (assessment."lifecycleState" = 'BLOCKED'
              AND assessment."blockerReason" = 'HUMAN_FACT_UNRESOLVABLE'))
          AND (turn."contextJson" -> 'humanAnswerReview' ->> 'checkpointId') = OLD."checkpointId"::text
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(turn."contextJson" -> 'humanAnswerReview' -> 'requests') = 'array'
                THEN turn."contextJson" -> 'humanAnswerReview' -> 'requests'
                ELSE '[]'::jsonb END
            ) review_entry
            WHERE review_entry ->> 'requestId' = OLD."requestId"::text
              AND review_entry -> 'requestRevision' = to_jsonb(OLD."requestRevision")
          )
      ) INTO review_authorized;
    END IF;
    IF NOT review_authorized THEN
      RAISE EXCEPTION 'human request checkpoint requires exact server review authority' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD."answers" IS DISTINCT FROM NEW."answers" THEN
    IF OLD."status" <> 'OPEN' OR NEW."requestRevision" <> OLD."requestRevision" + 1
       OR jsonb_array_length(NEW."answers") <> jsonb_array_length(OLD."answers") + 1
       OR (SELECT jsonb_agg(value) FROM jsonb_array_elements(NEW."answers") WITH ORDINALITY WHERE ordinality <= jsonb_array_length(OLD."answers")) IS DISTINCT FROM NULLIF(OLD."answers", '[]'::jsonb) THEN
      RAISE EXCEPTION 'answer history must append once under request revision CAS' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD."requestRevision" <> NEW."requestRevision" THEN
    RAISE EXCEPTION 'request revision advances only with an answer' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'RESOLVED' AND (NEW."answers" -> -1 ->> 'doesNotKnow') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'unknown answer cannot resolve a human request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $human_review_guard$;

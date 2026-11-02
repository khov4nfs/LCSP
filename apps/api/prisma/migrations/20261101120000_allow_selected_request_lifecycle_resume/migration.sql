-- A selected assessment may become ACTIVE again while resuming a request whose
-- immutable members already own decision-coverage rows. Historical coverage for
-- other requests remains valid and is not authority to write in the current run.
CREATE OR REPLACE FUNCTION public.lcsp_assessment_active_requires_pins()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  pinned_rule_set text;
  pinned_snapshot text;
  pinned_audit_mode "AssessmentAuditMode";
  rule_count integer;
  coverage_count integer;
  current_request uuid;
  request_member_count integer;
  covered_member_count integer;
BEGIN
  IF NEW."lifecycleState" = 'ACTIVE' AND OLD."lifecycleState" IS DISTINCT FROM 'ACTIVE' THEN
    SELECT "ruleSetVersionId", "repositorySnapshotId", "auditMode"
      INTO pinned_rule_set, pinned_snapshot, pinned_audit_mode
      FROM "AssessmentCase" WHERE "assessmentId" = NEW."id";
    IF NOT FOUND OR pinned_rule_set IS NULL OR pinned_snapshot IS NULL THEN
      RAISE EXCEPTION 'an assessment cannot be ACTIVE without a pinned compliance rule set and repository snapshot' USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO rule_count FROM "AssessmentRule" WHERE "ruleSetVersionId" = pinned_rule_set;
    IF rule_count = 0 THEN
      RAISE EXCEPTION 'an assessment cannot be ACTIVE without pinned AssessmentRules' USING ERRCODE = 'check_violation';
    END IF;
    IF pinned_audit_mode = 'LEGACY_FULL' THEN
      SELECT count(*) INTO coverage_count FROM "AssessmentDecisionCoverage" WHERE "assessmentId" = NEW."id";
      IF coverage_count <> rule_count THEN
        RAISE EXCEPTION 'decision coverage must exist for every pinned AssessmentRule' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF pinned_audit_mode = 'CUSTOMER_SELECTED' THEN
      SELECT r."currentAuditRequestId" INTO current_request
        FROM "AssessmentRuntime" r WHERE r."assessmentId" = NEW."id";
      IF current_request IS NULL THEN
        SELECT count(*) INTO coverage_count
          FROM "AssessmentDecisionCoverage" coverage WHERE coverage."assessmentId" = NEW."id";
        IF coverage_count <> 0 THEN
          RAISE EXCEPTION 'customer-selected assessment without a request cannot have decision coverage' USING ERRCODE = 'check_violation';
        END IF;
      ELSIF NOT EXISTS (
        SELECT 1 FROM "AssessmentRuleAuditRequest" request
        WHERE request."requestId" = current_request
          AND request."assessmentId" = NEW."id"
          AND request."status" IN ('QUEUED', 'RUNNING', 'WAITING_FOR_CUSTOMER', 'FAILED', 'INTERRUPTED')
      ) THEN
        RAISE EXCEPTION 'customer-selected assessment must have an active audit request before resuming' USING ERRCODE = 'check_violation';
      END IF;
      IF current_request IS NOT NULL THEN
        SELECT count(*) INTO request_member_count
          FROM "AssessmentRuleAuditItem" item WHERE item."requestId" = current_request;
        SELECT count(*) INTO covered_member_count
          FROM "AssessmentRuleAuditItem" item
          JOIN "AssessmentDecisionCoverage" coverage
            ON coverage."assessmentId" = NEW."id"
           AND coverage."assessmentRuleId" = item."assessmentRuleId"
           AND coverage."ruleSetVersionId" = pinned_rule_set
           AND coverage."assessmentRuleVersion" = item."assessmentRuleVersion"
          WHERE item."requestId" = current_request;
        IF request_member_count = 0 OR covered_member_count <> request_member_count THEN
          RAISE EXCEPTION 'decision coverage must exist for every current audit request member' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Disposable PostgreSQL 16-only integration smoke for LCSP-347.
-- Run AFTER 'prisma migrate deploy' against an independently created test DB.
-- Transaction ROLLBACK ensures that no inserted fixture remains.
-- Do not point this at production or shared team databases.
\set ON_ERROR_STOP on

BEGIN;

-- Fail closed if accidentally pointed at a non-disposable database.
DO $db_guard$
BEGIN
  IF current_database() !~* '(disposable|_test|_e2e)' THEN
    RAISE EXCEPTION 'SCOPE_SMOKE_REFUSES_NON_DISPOSABLE_DATABASE';
  END IF;
  IF current_setting('server_version_num')::int < 160000 OR
     current_setting('server_version_num')::int >= 170000 THEN
    RAISE EXCEPTION 'SCOPE_SMOKE_EXPECTS_POSTGRESQL_16';
  END IF;
END;
$db_guard$;

INSERT INTO "LegalSourceVersion" ("id","version","status","sourceManifest")
VALUES
 ('c1111111-1111-4111-8111-111111111111','scope-smoke-source-v1','DRAFT','{}'::jsonb),
 ('c2222222-2222-4222-8222-222222222222','scope-smoke-source-v2','DRAFT','{}'::jsonb);

INSERT INTO "RuleSetPreparationRun"
 ("id","idempotencyKey","legalSourceVersionId","requestedBy","correlationId",
  "executionState","claimPhase","scopeReviewRequested")
VALUES
 ('c3333333-3333-4333-8333-333333333333',
  'scope-smoke-disposable-preparation',
  'c1111111-1111-4111-8111-111111111111',
  'scope-smoke-initiator','scope-smoke-correlation',
  'PAUSED','CLAIM_INVENTORY_READY',true);

INSERT INTO "RuleSetPreparationClaimInventory"
 ("preparationRunId","revision","fingerprint","graphDigest","graph","identities")
VALUES
 ('c3333333-3333-4333-8333-333333333333',1,repeat('a',64),repeat('b',64),'{}','{}');

INSERT INTO "RuleSetPreparationScopeReview"
 ("preparationRunId","inventoryRevision","legalSourceVersionId",
  "inventoryFingerprint","graphDigest","decisionDigest",
  "decisions","projection","submittedBy","updatedAt")
VALUES
 ('c3333333-3333-4333-8333-333333333333',1,
  'c1111111-1111-4111-8111-111111111111',
  repeat('a',64),repeat('b',64),repeat('c',64),
  '[{"claimId":"scope-test"}]'::jsonb,
  '{"developmentClaimIds":["scope-test"]}'::jsonb,
  'scope-smoke-reviewer-a',now());

DO $scope_smoke$
DECLARE
  run_id text := 'c3333333-3333-4333-8333-333333333333';
  source1 text := 'c1111111-1111-4111-8111-111111111111';
  source2 text := 'c2222222-2222-4222-8222-222222222222';
  checked integer := 0;
  observed_scope text;
BEGIN
  SELECT "targetActivityScope"::text INTO observed_scope
  FROM "RuleSetPreparationRun" WHERE id=run_id;
  IF observed_scope <> 'FULL_SOURCE' THEN
    RAISE EXCEPTION 'DEFAULT_SCOPE_MISMATCH: %', observed_scope;
  END IF;
  IF (SELECT "scopeReviewRequested" FROM "RuleSetPreparationRun" WHERE id=run_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'REQUESTED_SCOPE_INTENT_NOT_SAVED';
  END IF;
  IF (SELECT count(*) FROM "RuleSetPreparationScopeReview" WHERE "preparationRunId"=run_id) <> 1 THEN
    RAISE EXCEPTION 'SCOPE_LEDGER_NOT_PERSISTED';
  END IF;
  checked := checked + 3;

  -- Both the pinned source FK and frozen inventory FK MUST be enforced.
  BEGIN
    UPDATE "RuleSetPreparationScopeReview"
      SET "legalSourceVersionId"=source2 WHERE "preparationRunId"=run_id;
    RAISE EXCEPTION 'EXPECTED_SOURCE_FK_VIOLATION';
  EXCEPTION WHEN foreign_key_violation THEN checked := checked + 1;
  END;

  BEGIN
    INSERT INTO "RuleSetPreparationScopeReview"
      ("preparationRunId","inventoryRevision","legalSourceVersionId",
       "inventoryFingerprint","graphDigest","decisionDigest","decisions","projection","submittedBy","updatedAt")
    VALUES (run_id,2,source1,repeat('a',64),repeat('b',64),repeat('c',64),'[]','{}','scope-smoke-reviewer-a',now());
    RAISE EXCEPTION 'EXPECTED_INVENTORY_FK_VIOLATION';
  EXCEPTION WHEN foreign_key_violation THEN checked := checked + 1;
  END;

  BEGIN
    INSERT INTO "RuleSetPreparationScopeReview"
      ("preparationRunId","inventoryRevision","legalSourceVersionId",
       "inventoryFingerprint","graphDigest","decisionDigest","decisions","projection","submittedBy","updatedAt")
    VALUES (run_id,1,source1,repeat('a',64),repeat('b',64),repeat('c',64),'[]','{}','scope-smoke-reviewer-a',now());
    RAISE EXCEPTION 'EXPECTED_DUPLICATE_REVIEW_VIOLATION';
  EXCEPTION WHEN unique_violation THEN checked := checked + 1;
  END;

  -- Missing reviewer/time must never count as approved at the database boundary.
  BEGIN
    UPDATE "RuleSetPreparationScopeReview"
       SET state='APPROVED' WHERE "preparationRunId"=run_id;
    RAISE EXCEPTION 'EXPECTED_APPROVAL_CHECK_VIOLATION';
  EXCEPTION WHEN check_violation THEN checked := checked + 1;
  END;

  BEGIN
    UPDATE "RuleSetPreparationScopeReview"
       SET "approvedBy"='scope-smoke-reviewer-b',state='APPROVED'
     WHERE "preparationRunId"=run_id;
    RAISE EXCEPTION 'EXPECTED_APPROVAL_TIME_CHECK_VIOLATION';
  EXCEPTION WHEN check_violation THEN checked := checked + 1;
  END;

  -- A properly completed approval is representable.
  UPDATE "RuleSetPreparationScopeReview"
     SET state='APPROVED',"approvedBy"='scope-smoke-reviewer-b',"approvedAt"=now(),
         "revision"="revision"+1,"updatedAt"=now()
   WHERE "preparationRunId"=run_id;
  IF NOT EXISTS (
    SELECT 1 FROM "RuleSetPreparationScopeReview"
     WHERE "preparationRunId"=run_id AND state='APPROVED'
       AND "revision"=2 AND "approvedBy"='scope-smoke-reviewer-b'
  ) THEN RAISE EXCEPTION 'APPROVED_REVIEW_NOT_RECORDED'; END IF;
  checked := checked + 1;

  -- Backdating a review to DRAFT without removing approval metadata is rejected.
  BEGIN
    UPDATE "RuleSetPreparationScopeReview"
       SET state='DRAFT' WHERE "preparationRunId"=run_id;
    RAISE EXCEPTION 'EXPECTED_APPROVAL_REVERSAL_CHECK_VIOLATION';
  EXCEPTION WHEN check_violation THEN checked := checked + 1;
  END;

  -- Frozen inventory cannot be mutated after the scope review points to it.
  BEGIN
    UPDATE "RuleSetPreparationClaimInventory" SET "fingerprint"=repeat('f',64)
     WHERE "preparationRunId"=run_id AND revision=1;
    RAISE EXCEPTION 'EXPECTED_FROZEN_INVENTORY_IMMUTABILITY_FAILURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Frozen claim inventory is immutable%' THEN RAISE; END IF;
    checked := checked + 1;
  END;

  IF checked<>11 THEN RAISE EXCEPTION 'UNEXPECTED_ASSERTION_COUNT: %',checked; END IF;
  RAISE NOTICE 'PASS: independent PostgreSQL 16 scope review fixture, % assertions',checked;
END;
$scope_smoke$;

ROLLBACK;

-- Existing migrations and all constraints remain. No smoke rows persist.
SELECT count(*) AS smoke_review_rows_after_rollback
 FROM "RuleSetPreparationScopeReview"
 WHERE "submittedBy"='scope-smoke-reviewer-a';

-- Source deletion is the only authorized path for physically removing these otherwise immutable
-- Rule Set and preparation records. The service creates this transaction's deletion receipt and
-- sets the matching transaction-local source ID before issuing any DELETE.
CREATE OR REPLACE FUNCTION public.lcsp_compliance_rule_set_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_id text;
  receipt_row "LegalSourceDeletionReceipt"%ROWTYPE;
  row_data jsonb;
  owned_rule_set_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_id := current_setting('lcsp.source_deletion_source_id', true);
    IF source_id IS NOT NULL THEN
      SELECT * INTO receipt_row
      FROM "LegalSourceDeletionReceipt"
      WHERE "sourceId" = source_id;
      IF FOUND THEN
        row_data := to_jsonb(OLD);
        IF TG_TABLE_NAME = 'ComplianceRuleSetReactivationRecord' THEN
          IF receipt_row."deletedRuleSetVersionIds" @> jsonb_build_array(row_data->>'targetRuleSetVersionId')
             AND receipt_row."deletedRuleSetVersionIds" @> jsonb_build_array(row_data->>'previousRuleSetVersionId') THEN
            RETURN OLD;
          END IF;
        ELSE
          owned_rule_set_id := row_data->>'ruleSetVersionId';
          IF owned_rule_set_id IS NOT NULL
             AND receipt_row."deletedRuleSetVersionIds" @> jsonb_build_array(owned_rule_set_id) THEN
            RETURN OLD;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are immutable once written', TG_TABLE_NAME;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lcsp_compliance_rule_set_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_id text;
  receipt_row "LegalSourceDeletionReceipt"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_id := current_setting('lcsp.source_deletion_source_id', true);
    IF source_id IS NOT NULL THEN
      SELECT * INTO receipt_row
      FROM "LegalSourceDeletionReceipt"
      WHERE "sourceId" = source_id;
      IF FOUND AND receipt_row."deletedRuleSetVersionIds" @> jsonb_build_array(OLD."id") THEN
        RETURN OLD;
      END IF;
    END IF;
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

CREATE OR REPLACE FUNCTION public.lcsp_frozen_claim_inventory_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_id text;
  receipt_row "LegalSourceDeletionReceipt"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_id := current_setting('lcsp.source_deletion_source_id', true);
    IF source_id IS NOT NULL THEN
      SELECT * INTO receipt_row
      FROM "LegalSourceDeletionReceipt"
      WHERE "sourceId" = source_id;
      IF FOUND AND receipt_row."deletedPreparationRunIds" @> jsonb_build_array(OLD."preparationRunId") THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Frozen claim inventory is immutable; reopen a new revision';
END;
$function$;

CREATE OR REPLACE FUNCTION public.lcsp_review_frontier_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_id text;
  receipt_row "LegalSourceDeletionReceipt"%ROWTYPE;
  preparation_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_id := current_setting('lcsp.source_deletion_source_id', true);
    preparation_id := to_jsonb(OLD)->>'preparationRunId';
    IF source_id IS NOT NULL AND preparation_id IS NOT NULL THEN
      SELECT * INTO receipt_row
      FROM "LegalSourceDeletionReceipt"
      WHERE "sourceId" = source_id;
      IF FOUND AND receipt_row."deletedPreparationRunIds" @> jsonb_build_array(preparation_id) THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'RuleSetPreparationReviewFrontier' THEN
    IF OLD."frozenAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Frozen review frontier is immutable';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "RuleSetPreparationReviewFrontier" f
      WHERE f."preparationRunId" = COALESCE(NEW."preparationRunId", OLD."preparationRunId")
        AND f."inventoryRevision" = COALESCE(NEW."inventoryRevision", OLD."inventoryRevision")
        AND f."frozenAt" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Frozen review dispositions are immutable';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

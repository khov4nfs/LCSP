ALTER TABLE "ComplianceRuleSetVersion"
  ALTER COLUMN "preparationRunId" DROP NOT NULL,
  ADD COLUMN "selectedPreparationResults" JSONB,
  ADD CONSTRAINT "ComplianceRuleSetVersion_publication_origin_check" CHECK (
    ("preparationRunId" IS NOT NULL AND "selectedPreparationResults" IS NULL)
    OR (
      "preparationRunId" IS NULL
      AND "selectedPreparationResults" IS NOT NULL
      AND jsonb_typeof("selectedPreparationResults") = 'array'
      AND jsonb_array_length("selectedPreparationResults") > 0
    )
  );

ALTER TABLE "ComplianceRuleSetActivationRecord"
  ALTER COLUMN "preparationRunId" DROP NOT NULL,
  ADD COLUMN "selectedPreparationResults" JSONB,
  ADD CONSTRAINT "ComplianceRuleSetActivationRecord_publication_origin_check" CHECK (
    ("preparationRunId" IS NOT NULL AND "selectedPreparationResults" IS NULL)
    OR (
      "preparationRunId" IS NULL
      AND "selectedPreparationResults" IS NOT NULL
      AND jsonb_typeof("selectedPreparationResults") = 'array'
      AND jsonb_array_length("selectedPreparationResults") > 0
    )
  );

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

  IF NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."legalSourceVersionId" IS DISTINCT FROM OLD."legalSourceVersionId"
     OR NEW."preparationRunId" IS DISTINCT FROM OLD."preparationRunId"
     OR NEW."selectedPreparationResults" IS DISTINCT FROM OLD."selectedPreparationResults"
     OR NEW."ruleSetDigest" IS DISTINCT FROM OLD."ruleSetDigest" THEN
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

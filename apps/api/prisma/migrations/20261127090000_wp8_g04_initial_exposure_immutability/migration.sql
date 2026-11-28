-- Rationale ("Why"): WP8 G-04 Maximum Exposure Invariant.
-- Historical records must preserve their approved initial monetary exposure snapshot immutably,
-- even after maximumExposureMicrocredits is zeroed out upon settlement, cancellation, or no-usage resolution.
-- Mechanism ("How"):
-- 1. Add "initialExposureMicrocredits" BIGINT (nullable only for legacy historical rows that cannot be reliably backfilled).
-- 2. Backfill only active/unresolved records where maximumExposureMicrocredits has not been zeroed.
-- 3. BEFORE INSERT trigger enforces that all future admissions MUST supply a non-negative initialExposureMicrocredits snapshot.
-- 4. BEFORE UPDATE trigger strictly rejects ANY modification to initialExposureMicrocredits (including NULL -> number and number -> number).
-- Invariants: Canonical initial exposure snapshot cannot be mutated, guessed, or fabricated after admission creation.

ALTER TABLE "BillableInvocationAdmission"
ADD COLUMN IF NOT EXISTS "initialExposureMicrocredits" BIGINT;

-- Backfill active and unresolved admissions where exposure retains authentic provenance
UPDATE "BillableInvocationAdmission"
SET "initialExposureMicrocredits" = "maximumExposureMicrocredits"
WHERE "initialExposureMicrocredits" IS NULL
  AND "state" IN ('ADMITTED', 'IN_FLIGHT', 'DISPATCH_UNKNOWN', 'OUTCOME_UNKNOWN', 'BILLING_INTEGRITY_REVIEW')
  AND "maximumExposureMicrocredits" >= 0;

-- 1. Enforce mandatory initialExposureMicrocredits on all future INSERTs
CREATE OR REPLACE FUNCTION "enforce_initial_exposure_on_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."initialExposureMicrocredits" IS NULL THEN
    RAISE EXCEPTION 'initialExposureMicrocredits is mandatory on insert';
  END IF;
  IF NEW."initialExposureMicrocredits" < 0 THEN
    RAISE EXCEPTION 'initialExposureMicrocredits must be non-negative';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "BillableInvocationAdmission_initial_exposure_insert" ON "BillableInvocationAdmission";
CREATE TRIGGER "BillableInvocationAdmission_initial_exposure_insert"
BEFORE INSERT ON "BillableInvocationAdmission"
FOR EACH ROW EXECUTE FUNCTION "enforce_initial_exposure_on_insert"();

-- 2. Enforce strict immutability against ANY update to initialExposureMicrocredits (including NULL -> value)
CREATE OR REPLACE FUNCTION "prevent_initial_exposure_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."initialExposureMicrocredits" IS DISTINCT FROM OLD."initialExposureMicrocredits" THEN
    RAISE EXCEPTION 'initialExposureMicrocredits is immutable and cannot be updated once created';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "BillableInvocationAdmission_initial_exposure_immutable" ON "BillableInvocationAdmission";
CREATE TRIGGER "BillableInvocationAdmission_initial_exposure_immutable"
BEFORE UPDATE ON "BillableInvocationAdmission"
FOR EACH ROW EXECUTE FUNCTION "prevent_initial_exposure_mutation"();

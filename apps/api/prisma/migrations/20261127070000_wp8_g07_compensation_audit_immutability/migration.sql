-- Rationale ("Why"): WP8 G-07 Financial Integrity Invariant.
-- AuditEvent records representing financial transactions (specifically billing compensation snapshots)
-- must be strictly immutable at the database storage tier to prevent tampering, deletion, or ledger desynchronization.
-- Mechanism ("How"): A BEFORE UPDATE OR DELETE trigger on "AuditEvent" rejects any mutation or deletion
-- when eventType = 'billing.debit.compensated'.
-- Invariants: Storage-layer append-only protection for financial compensation audit snapshots.

CREATE OR REPLACE FUNCTION "prevent_compensation_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."eventType" = 'billing.debit.compensated' THEN
    RAISE EXCEPTION 'AuditEvent rows for eventType = ''billing.debit.compensated'' are immutable at storage tier and cannot be updated or deleted';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "AuditEvent_compensation_immutable" ON "AuditEvent";
CREATE TRIGGER "AuditEvent_compensation_immutable"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_compensation_audit_event_mutation"();

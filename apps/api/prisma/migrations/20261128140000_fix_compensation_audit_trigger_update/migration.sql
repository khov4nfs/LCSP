-- Why: The earlier BEFORE UPDATE OR DELETE trigger returned OLD for every
-- ordinary AuditEvent. PostgreSQL therefore discarded payload redactions on
-- non-compensation audit rows while reporting the UPDATE as successful.
-- How: Keep the compensation rejection and return NEW for permitted UPDATEs.
-- Invariant: Compensation records remain immutable; ordinary DELETEs retain
-- their previous behavior.
CREATE OR REPLACE FUNCTION "prevent_compensation_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."eventType" = 'billing.debit.compensated' THEN
    RAISE EXCEPTION 'AuditEvent rows for eventType = ''billing.debit.compensated'' are immutable at storage tier and cannot be updated or deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

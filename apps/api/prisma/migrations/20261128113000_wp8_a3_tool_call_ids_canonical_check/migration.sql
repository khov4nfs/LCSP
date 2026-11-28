-- Why: A direct DB writer could bypass the API schema and pin ambiguous tool-call causation in an immutable receipt.
-- How: Validate the same bounded printable-ASCII sorted set at PostgreSQL INSERT time.
-- Invariant: Historical empty arrays remain valid; immutable receipt rows cannot be rewritten to evade this guard.
CREATE OR REPLACE FUNCTION "lcsp_model_receipt_tool_call_ids_canonical"(ids TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  previous_id TEXT;
  current_id TEXT;
BEGIN
  IF ids IS NULL OR cardinality(ids) > 64 THEN
    RETURN FALSE;
  END IF;

  FOREACH current_id IN ARRAY ids LOOP
    IF current_id IS NULL
       OR length(current_id) < 1
       OR length(current_id) > 200
       OR (current_id COLLATE "C") !~ '^[!-~]+$'
       OR (previous_id IS NOT NULL AND (previous_id COLLATE "C") >= (current_id COLLATE "C")) THEN
      RETURN FALSE;
    END IF;
    previous_id := current_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

ALTER TABLE "ModelUsageReceipt"
ADD CONSTRAINT "ModelUsageReceipt_toolCallIds_canonical"
CHECK ("lcsp_model_receipt_tool_call_ids_canonical"("toolCallIds"));

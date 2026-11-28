-- Why: Domain output evaluation must prove the rejected tool call came from this paid invocation.
-- How: Pin response tool-call identifiers alongside the immutable usage receipt at settlement.
-- Invariant: Existing receipts have no asserted call IDs; empty arrays never prove causation.
ALTER TABLE "ModelUsageReceipt"
ADD COLUMN "toolCallIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

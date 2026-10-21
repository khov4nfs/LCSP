-- A unit with no structural reference to wait on may block on the reopened units whose relations touch its claims;
-- the API records them in payload.blockedSourceNodeIds. Every other column of the shape check is unchanged.
ALTER TABLE "RuleSetPreparationSourceReview" DROP CONSTRAINT "SourceReview_shape_check";
ALTER TABLE "RuleSetPreparationSourceReview" ADD CONSTRAINT "SourceReview_shape_check" CHECK (
 "inventoryRevision">0 AND ordinal>=0 AND "ownedClaimCount"=jsonb_array_length(payload->'claims') AND "stateFingerprint" ~ '^[a-f0-9]{64}$'
 AND ((state='IN_REVIEW')=("operationId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL))
 AND (state<>'REVIEWED_WITH_CLAIMS' OR (cardinality("claimIds")>0 AND disposition IN ('CLAIMS_AUTHORED','CONTEXT_ONLY') AND "completedAt" IS NOT NULL))
 AND (state<>'REVIEWED_NO_CLAIMS' OR (cardinality("claimIds")=0 AND disposition='NO_RELEVANT_SEMANTIC_CLAIMS' AND length(trim(reason))>0 AND "completedAt" IS NOT NULL))
 AND (state<>'BLOCKED_REFERENCE' OR (disposition='REQUIRES_REFERENCE_RESOLUTION'
  AND (cardinality("blockedReferenceIds")>0 OR jsonb_array_length(COALESCE(payload->'blockedSourceNodeIds','[]'::jsonb))>0)
  AND length(trim(reason))>0)));

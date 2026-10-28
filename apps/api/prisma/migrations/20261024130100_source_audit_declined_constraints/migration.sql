-- Separate migration: PostgreSQL must commit enum additions before using the values.
ALTER TABLE "RuleSetPreparationReviewFrontier" DROP CONSTRAINT "ReviewFrontier_shape_check";
ALTER TABLE "RuleSetPreparationReviewFrontier" ADD CONSTRAINT "ReviewFrontier_shape_check" CHECK (
 revision>0 AND "inventoryRevision">0 AND fingerprint ~ '^[a-f0-9]{64}$' AND "stateFingerprint" ~ '^[a-f0-9]{64}$' AND "stateAccumulator" ~ '^[a-f0-9]{64}$'
 AND "unitCount"="pendingCount"+"inReviewCount"+"reviewedWithClaimsCount"+"reviewedNoClaimsCount"+"auditDeclinedCount"+"blockedCount"
 AND LEAST("pendingCount","inReviewCount","reviewedWithClaimsCount","reviewedNoClaimsCount","auditDeclinedCount","blockedCount","persistedClaimCount")>=0);

ALTER TABLE "RuleSetPreparationSourceReview" ADD CONSTRAINT "SourceReview_audit_declined_check" CHECK (
 state<>'AUDIT_DECLINED' OR (disposition IS NOT NULL AND disposition='AUDIT_DECLINED'
 AND reason IS NOT NULL AND length(trim(reason))>0 AND "completedAt" IS NOT NULL
 AND cardinality("claimIds")=0 AND cardinality("blockedReferenceIds")=0 AND "ownedClaimCount"=0
 AND payload @> '{"claims":[],"identities":{},"relations":[],"referenceAccounting":[]}'::jsonb
 AND payload->'claims'='[]'::jsonb AND payload->'identities'='{}'::jsonb
 AND payload->'relations'='[]'::jsonb AND payload->'referenceAccounting'='[]'::jsonb
 AND NOT (payload ? 'semanticAudit')
 AND COALESCE(payload->'dependencyFingerprints','{}'::jsonb)='{}'::jsonb
 AND COALESCE(payload->'blockedEndpointFingerprints','{}'::jsonb)='{}'::jsonb
 AND COALESCE(payload->'blockedSourceNodeIds','[]'::jsonb)='[]'::jsonb
 AND COALESCE(payload->'invalidatedRelationIds','[]'::jsonb)='[]'::jsonb));

ALTER TABLE "RuleSetPreparationClaimInventory" ADD CONSTRAINT "ClaimInventory_audit_declined_array_check" CHECK (jsonb_typeof("auditDeclined")='array');

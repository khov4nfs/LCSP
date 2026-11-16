-- Additive provenance binding for source ranges claimed during FactNeed investigation.
-- Historical FactNeeds remain NULL and preserve their original meaning.
ALTER TABLE "AssessmentFactNeed"
ADD COLUMN "investigationDiscoveryRefs" JSONB;

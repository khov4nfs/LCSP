-- Historical legal packets retain their bytes/digests; unknown logic is never backfilled by inference.
ALTER TABLE "LegalRequirement" ADD COLUMN "applicabilityLogic" JSONB;

-- Enable btree_gist extension idempotently
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    CREATE EXTENSION btree_gist;
  END IF;
END $$;

-- Enforce anti-overlap GiST exclusion constraint on PlatformSponsorshipPolicySnapshot
-- Scope: (policyName, provider, resolvedModel)
-- Interval: [effectiveFrom, COALESCE(effectiveTo, 'infinity'::timestamptz))
ALTER TABLE "PlatformSponsorshipPolicySnapshot"
  ADD CONSTRAINT "PlatformSponsorshipPolicySnapshot_no_overlap"
  EXCLUDE USING gist (
    "policyName" WITH =,
    "provider" WITH =,
    "resolvedModel" WITH =,
    tstzrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamptz), '[)') WITH &&
  );

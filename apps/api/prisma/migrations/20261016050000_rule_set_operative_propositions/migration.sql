-- Historical accepted packets and digests remain unchanged; new authoring is checked by the Gate.
ALTER TABLE "LegalRequirement" ADD COLUMN "operativePropositions" JSONB;

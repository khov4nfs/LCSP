-- Forward repair for 20261013132644_re_generate_db.
--
-- That migration was generated from `prisma migrate diff`, so it also dropped
-- "AssessmentHumanRequest_resolved_fact_fkey". The constraint is not obsolete: it is a
-- database-only composite foreign key (Prisma's model keeps only the scalar "resolvedFactId")
-- that guarantees a resolved human request points at an existing fact of the SAME assessment,
-- next to the "AssessmentHumanRequest_resolved_shape" check. Like the composite key on
-- "LegalRequirementContextRelation" that re_generate_db deliberately preserved, it has no Prisma
-- relation and is documented in schema.prisma.
--
-- re_generate_db is already merged and may be applied elsewhere, so it is left untouched
-- (editing an applied migration changes its checksum). The constraint is restored here with the
-- exact definition from 20261007120000_assessment_domain_expand. Idempotent for databases that
-- never lost it.
ALTER TABLE "AssessmentHumanRequest"
  DROP CONSTRAINT IF EXISTS "AssessmentHumanRequest_resolved_fact_fkey";
ALTER TABLE "AssessmentHumanRequest"
  ADD CONSTRAINT "AssessmentHumanRequest_resolved_fact_fkey"
    FOREIGN KEY ("resolvedFactId", "assessmentId")
    REFERENCES "AssessmentCaseFact" ("factId", "assessmentId")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

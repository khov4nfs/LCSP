-- W4 additive Human Resolution replay/CAS/checkpoint bindings. No V1 semantic backfill.
ALTER TYPE "AssessmentEvidenceType" ADD VALUE 'HUMAN_ANSWER';
ALTER TABLE "AssessmentHumanRequest"
  ADD COLUMN "requestRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestDigest" TEXT,
  ADD COLUMN "checkpointId" UUID,
  ADD CONSTRAINT "AssessmentHumanRequest_revision_nonnegative" CHECK ("requestRevision" >= 0),
  ADD CONSTRAINT "AssessmentHumanRequest_replay_pair" CHECK (("idempotencyKey" IS NULL) = ("requestDigest" IS NULL)),
  ADD CONSTRAINT "AssessmentHumanRequest_digest_format" CHECK ("requestDigest" IS NULL OR "requestDigest" ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX "AssessmentHumanRequest_assessmentId_idempotencyKey_key"
  ON "AssessmentHumanRequest" ("assessmentId", "idempotencyKey");

CREATE FUNCTION lcsp_assessment_human_answer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."requestRevision" <> 0 OR NEW."answers" <> '[]'::jsonb THEN
      RAISE EXCEPTION 'human request starts without answers' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD."idempotencyKey", OLD."requestDigest") IS DISTINCT FROM (NEW."idempotencyKey", NEW."requestDigest")
     OR (OLD."checkpointId" IS NOT NULL AND OLD."checkpointId" IS DISTINCT FROM NEW."checkpointId") THEN
    RAISE EXCEPTION 'human request replay and checkpoint binding are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."answers" IS DISTINCT FROM NEW."answers" THEN
    IF OLD."status" <> 'OPEN' OR NEW."requestRevision" <> OLD."requestRevision" + 1
       OR jsonb_array_length(NEW."answers") <> jsonb_array_length(OLD."answers") + 1
       OR (SELECT jsonb_agg(value) FROM jsonb_array_elements(NEW."answers") WITH ORDINALITY WHERE ordinality <= jsonb_array_length(OLD."answers")) IS DISTINCT FROM NULLIF(OLD."answers", '[]'::jsonb) THEN
      RAISE EXCEPTION 'answer history must append once under request revision CAS' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD."requestRevision" <> NEW."requestRevision" THEN
    RAISE EXCEPTION 'request revision advances only with an answer' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'RESOLVED' AND (NEW."answers" -> -1 ->> 'doesNotKnow') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'unknown answer cannot resolve a human request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssessmentHumanRequest_answer_guard" BEFORE INSERT OR UPDATE ON "AssessmentHumanRequest"
  FOR EACH ROW EXECUTE FUNCTION lcsp_assessment_human_answer_guard();

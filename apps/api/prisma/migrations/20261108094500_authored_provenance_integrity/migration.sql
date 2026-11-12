ALTER TABLE "AuthoredLocalizationRequest"
  ADD CONSTRAINT authored_source_review_pair CHECK (("sourceReviewedBy" IS NULL) = ("sourceReviewedAt" IS NULL)),
  ADD CONSTRAINT authored_output_review_pair CHECK (("translationReviewedBy" IS NULL) = ("translationReviewedAt" IS NULL));

CREATE FUNCTION lcsp_authored_request_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."idempotencyKey",NEW."scopeId",NEW."entityType",NEW."entityId",NEW."canonicalRevision",NEW."canonicalDigest",NEW."fieldPath",NEW."locale",NEW."originSha256",NEW."originalContent",NEW."translationRevision")
    IS DISTINCT FROM ROW(OLD."idempotencyKey",OLD."scopeId",OLD."entityType",OLD."entityId",OLD."canonicalRevision",OLD."canonicalDigest",OLD."fieldPath",OLD."locale",OLD."originSha256",OLD."originalContent",OLD."translationRevision") THEN
    RAISE EXCEPTION 'AUTHORED_ORIGIN_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF OLD."sourceReviewedAt" IS NOT NULL AND ROW(NEW."sourceLanguage",NEW."originalLanguage",NEW."sourceReviewedBy",NEW."sourceReviewedAt") IS DISTINCT FROM ROW(OLD."sourceLanguage",OLD."originalLanguage",OLD."sourceReviewedBy",OLD."sourceReviewedAt") THEN
    RAISE EXCEPTION 'AUTHORED_SOURCE_REVIEW_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF OLD."translationReviewedAt" IS NOT NULL AND ROW(NEW."translationReviewedBy",NEW."translationReviewedAt") IS DISTINCT FROM ROW(OLD."translationReviewedBy",OLD."translationReviewedAt") THEN
    RAISE EXCEPTION 'AUTHORED_OUTPUT_REVIEW_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER authored_request_integrity BEFORE UPDATE ON "AuthoredLocalizationRequest"
FOR EACH ROW EXECUTE FUNCTION lcsp_authored_request_integrity();
CREATE TRIGGER authored_localized_revision_immutable BEFORE UPDATE OR DELETE ON "AuthoredLocalizedRevision"
FOR EACH ROW EXECUTE FUNCTION lcsp_authored_language_review_immutable();

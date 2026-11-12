CREATE TYPE "AuthoredLocalizationState" AS ENUM ('PENDING','READY','FAILED');
CREATE TYPE "AuthoredLocalizationLocale" AS ENUM ('EN','VI');
CREATE TYPE "AuthoredLocalizationEntity" AS ENUM ('LEGAL_REQUIREMENT','ASSESSMENT_RULE','DECISION','HUMAN_REQUEST','EVENT','REPORT');
CREATE TABLE "AuthoredLocalizationRequest" (
 "id" TEXT PRIMARY KEY, "idempotencyKey" TEXT NOT NULL UNIQUE,
 "scopeId" TEXT NOT NULL, "entityType" "AuthoredLocalizationEntity" NOT NULL, "entityId" TEXT NOT NULL,
 "canonicalRevision" TEXT NOT NULL, "canonicalDigest" TEXT NOT NULL,
 "fieldPath" TEXT NOT NULL, "locale" "AuthoredLocalizationLocale" NOT NULL,
 "originalLanguage" "AuthoredLocalizationLocale", "originSha256" TEXT NOT NULL,
 "originalContent" TEXT NOT NULL, "translationRevision" INTEGER NOT NULL DEFAULT 1,
 "state" "AuthoredLocalizationState" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "errorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("originSha256" ~ '^[a-f0-9]{64}$' AND "canonicalDigest" ~ '^[a-f0-9]{64}$'),
 CHECK ("translationRevision" > 0 AND "attempts" >= 0)
);
CREATE INDEX ON "AuthoredLocalizationRequest" ("state","nextAttemptAt","leaseUntil");
CREATE INDEX ON "AuthoredLocalizationRequest" ("scopeId","originSha256","locale","state");
CREATE TABLE "AuthoredLocalizedRevision" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL UNIQUE REFERENCES "AuthoredLocalizationRequest"("id") ON DELETE RESTRICT,
 "content" TEXT NOT NULL, "contentSha256" TEXT NOT NULL CHECK ("contentSha256" ~ '^[a-f0-9]{64}$'),
 "engine" TEXT NOT NULL, "engineVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "LocalizedReportArtifact" (
 "id" TEXT PRIMARY KEY, "scopeId" TEXT NOT NULL, "sourceArtifactId" TEXT NOT NULL,
 "sourceSha256" TEXT NOT NULL, "locale" "AuthoredLocalizationLocale" NOT NULL,
 "translationRevision" INTEGER NOT NULL, "content" BYTEA NOT NULL, "contentSha256" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("scopeId","sourceArtifactId","locale","translationRevision")
);
CREATE FUNCTION "reject_localized_revision_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LOCALIZED_REVISION_IMMUTABLE'; END $$;
CREATE TRIGGER "AuthoredLocalizedRevision_immutable" BEFORE UPDATE OR DELETE ON "AuthoredLocalizedRevision" FOR EACH ROW EXECUTE FUNCTION "reject_localized_revision_mutation"();
CREATE TRIGGER "LocalizedReportArtifact_immutable" BEFORE UPDATE OR DELETE ON "LocalizedReportArtifact" FOR EACH ROW EXECUTE FUNCTION "reject_localized_revision_mutation"();

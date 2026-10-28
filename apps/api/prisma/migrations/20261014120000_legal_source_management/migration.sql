-- Admin-managed Legal Sources: a parent per family of Legal Source Versions, document ingestion
-- state and provenance, and content-addressed original bytes. Existing production data keeps its
-- ids, hashes, chunks and rule-set pins; each existing version only gains a parent and its
-- documents are marked MIGRATED / READY.

-- CreateEnum
CREATE TYPE "LegalSourceDocumentOrigin" AS ENUM ('UPLOAD', 'URL_IMPORT', 'MIGRATED');

-- CreateEnum
CREATE TYPE "LegalSourceDocumentIngestionState" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "LegalSource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalSourceDocumentBlob" (
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSourceDocumentBlob_pkey" PRIMARY KEY ("sha256")
);

-- AlterTable
ALTER TABLE "LegalSourceVersion" ADD COLUMN     "basedOnVersionId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "legalSourceId" TEXT;

-- AlterTable
ALTER TABLE "LegalSourceDocument" ADD COLUMN     "blobSha256" TEXT,
ADD COLUMN     "byteLength" INTEGER,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "extraction" JSONB,
ADD COLUMN     "ingestedAt" TIMESTAMP(3),
ADD COLUMN     "ingestionAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ingestionFailureCode" TEXT,
ADD COLUMN     "ingestionState" "LegalSourceDocumentIngestionState" NOT NULL DEFAULT 'READY',
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "origin" "LegalSourceDocumentOrigin" NOT NULL DEFAULT 'MIGRATED',
ADD COLUMN     "originalFileName" TEXT,
ADD COLUMN     "provenance" JSONB,
ADD COLUMN     "structureProfile" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LegalSource_slug_key" ON "LegalSource"("slug");

-- CreateIndex
CREATE INDEX "LegalSourceVersion_legalSourceId_createdAt_idx" ON "LegalSourceVersion"("legalSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "LegalSourceDocument_blobSha256_idx" ON "LegalSourceDocument"("blobSha256");

-- AddForeignKey
ALTER TABLE "LegalSourceVersion" ADD CONSTRAINT "LegalSourceVersion_legalSourceId_fkey" FOREIGN KEY ("legalSourceId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSourceDocument" ADD CONSTRAINT "LegalSourceDocument_blobSha256_fkey" FOREIGN KEY ("blobSha256") REFERENCES "LegalSourceDocumentBlob"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every version belongs to a parent Legal Source. Older callers (the worker ingest route, fixtures)
-- insert a version without naming one, so the database derives it from the version label.
CREATE FUNCTION "lcsp_assign_legal_source_parent"() RETURNS trigger AS $$
DECLARE
  base_slug text;
  parent_id text;
BEGIN
  IF NEW."legalSourceId" IS NULL THEN
    base_slug := trim(both '-' from lower(regexp_replace(NEW.version, '[^a-zA-Z0-9]+', '-', 'g')));
    IF base_slug = '' THEN
      base_slug := 'legal-source';
    END IF;
    IF EXISTS (SELECT 1 FROM "LegalSource" WHERE slug = base_slug) THEN
      base_slug := base_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    END IF;
    INSERT INTO "LegalSource"(id, slug, name, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, base_slug, NEW.version, now(), now())
    RETURNING id INTO parent_id;
    NEW."legalSourceId" := parent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegalSourceVersion_assign_parent"
BEFORE INSERT ON "LegalSourceVersion"
FOR EACH ROW EXECUTE FUNCTION "lcsp_assign_legal_source_parent"();

-- Backfill: one parent per existing version, named after the version, so identity, hashes, chunks
-- and rule-set pins are untouched and an operator can rename the parent afterwards.
INSERT INTO "LegalSource"(id, slug, name, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       CASE WHEN ranked.rn = 1 THEN ranked.base ELSE ranked.base || '-' || ranked.rn END,
       ranked.version,
       ranked."createdAt",
       now()
FROM (
  SELECT v.version,
         v."createdAt",
         COALESCE(NULLIF(trim(both '-' from lower(regexp_replace(v.version, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'legal-source') AS base,
         row_number() OVER (
           PARTITION BY COALESCE(NULLIF(trim(both '-' from lower(regexp_replace(v.version, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'legal-source')
           ORDER BY v."createdAt", v.id
         ) AS rn
  FROM "LegalSourceVersion" v
  WHERE v."legalSourceId" IS NULL
) ranked;
UPDATE "LegalSourceVersion" v
SET "legalSourceId" = s.id
FROM "LegalSource" s
WHERE v."legalSourceId" IS NULL AND s.name = v.version;

-- A pinned version's content never changes: documents and chunks of a non-DRAFT version are
-- read-only. A change is a new DRAFT version.
CREATE FUNCTION "lcsp_guard_frozen_legal_source_content"() RETURNS trigger AS $$
DECLARE
  version_status text;
BEGIN
  SELECT status::text INTO version_status FROM "LegalSourceVersion" WHERE id = OLD."legalSourceVersionId";
  IF version_status IS NOT NULL AND version_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'LEGAL_SOURCE_VERSION_IMMUTABLE: documents and chunks of a % legal source version cannot change', version_status
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegalSourceDocument_frozen_content"
BEFORE UPDATE ON "LegalSourceDocument"
FOR EACH ROW EXECUTE FUNCTION "lcsp_guard_frozen_legal_source_content"();

CREATE TRIGGER "LegalDocumentChunk_frozen_content"
BEFORE UPDATE ON "LegalDocumentChunk"
FOR EACH ROW EXECUTE FUNCTION "lcsp_guard_frozen_legal_source_content"();

-- One open draft per Legal Source instead of one in the whole platform: several sources are
-- managed side by side, each with at most one draft being assembled.
DROP INDEX IF EXISTS "LegalSourceVersion_single_draft_key";
CREATE UNIQUE INDEX "LegalSourceVersion_single_draft_per_source_key"
ON "LegalSourceVersion" ("legalSourceId")
WHERE "status" = 'DRAFT';

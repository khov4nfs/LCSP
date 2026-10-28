CREATE TYPE "LegalSourceDocumentCorpusRole" AS ENUM ('OPERATIVE', 'REFERENCE_ONLY');
ALTER TABLE "LegalSourceDocument" ADD COLUMN "corpusRole" "LegalSourceDocumentCorpusRole" NOT NULL DEFAULT 'OPERATIVE';
-- Non-DRAFT updates are already refused by LegalSourceDocument_frozen_content.

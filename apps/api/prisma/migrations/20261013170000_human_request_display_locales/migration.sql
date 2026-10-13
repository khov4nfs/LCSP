-- AlterTable
ALTER TABLE "AssessmentHumanRequest" ADD COLUMN IF NOT EXISTS "sourceLocale" TEXT DEFAULT 'en',
ADD COLUMN IF NOT EXISTS "displayLocales" JSONB;

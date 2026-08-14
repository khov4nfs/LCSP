DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'AssessmentStatus'
  ) THEN
    CREATE TYPE "AssessmentStatus" AS ENUM (
      'WIZARD_IN_PROGRESS',
      'WIZARD_SUBMITTED',
      'EVIDENCE_REQUIRED',
      'SCAN_IN_PROGRESS',
      'CLASSIFICATION_LOCKED',
      'READY_FOR_REVIEW'
    );
  END IF;
END $$;

ALTER TABLE "Assessment"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Assessment"
ALTER COLUMN "status" TYPE "AssessmentStatus"
USING "status"::"AssessmentStatus";

ALTER TABLE "Assessment"
ALTER COLUMN "status" SET DEFAULT 'WIZARD_IN_PROGRESS';

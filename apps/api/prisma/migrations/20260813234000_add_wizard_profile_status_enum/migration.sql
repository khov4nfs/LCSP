DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'WizardProfileStatus'
  ) THEN
    CREATE TYPE "WizardProfileStatus" AS ENUM (
      'NOT_STARTED',
      'IN_PROGRESS',
      'SUBMITTED'
    );
  END IF;
END $$;

ALTER TABLE "WizardProfile"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "WizardProfile"
ALTER COLUMN "status" TYPE "WizardProfileStatus"
USING (
  CASE UPPER("status"::text)
    WHEN 'NOT_STARTED' THEN 'NOT_STARTED'::"WizardProfileStatus"
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"WizardProfileStatus"
    WHEN 'SUBMITTED' THEN 'SUBMITTED'::"WizardProfileStatus"
    ELSE 'IN_PROGRESS'::"WizardProfileStatus"
  END
);

ALTER TABLE "WizardProfile"
ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

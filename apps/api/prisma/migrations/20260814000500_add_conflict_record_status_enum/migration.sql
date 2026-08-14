DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ConflictRecordStatus'
  ) THEN
    CREATE TYPE "ConflictRecordStatus" AS ENUM (
      'PENDING',
      'RESOLVED',
      'DISMISSED'
    );
  END IF;
END $$;

ALTER TABLE "ConflictRecord"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "ConflictRecord"
ALTER COLUMN "status" TYPE "ConflictRecordStatus"
USING (
  CASE UPPER("status"::text)
    WHEN 'PENDING' THEN 'PENDING'::"ConflictRecordStatus"
    WHEN 'RESOLVED' THEN 'RESOLVED'::"ConflictRecordStatus"
    WHEN 'DISMISSED' THEN 'DISMISSED'::"ConflictRecordStatus"
    ELSE 'PENDING'::"ConflictRecordStatus"
  END
);

ALTER TABLE "ConflictRecord"
ALTER COLUMN "status" SET DEFAULT 'PENDING';

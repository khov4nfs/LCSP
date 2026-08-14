DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'OutboxStatus'
  ) THEN
    CREATE TYPE "OutboxStatus" AS ENUM (
      'PENDING',
      'PUBLISHED',
      'FAILED',
      'DLQ'
    );
  END IF;
END $$;

ALTER TABLE "OutboxMessage"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "OutboxMessage"
ALTER COLUMN "status" TYPE "OutboxStatus"
USING (
  CASE UPPER("status"::text)
    WHEN 'PENDING' THEN 'PENDING'::"OutboxStatus"
    WHEN 'PUBLISHED' THEN 'PUBLISHED'::"OutboxStatus"
    WHEN 'FAILED' THEN 'FAILED'::"OutboxStatus"
    WHEN 'DLQ' THEN 'DLQ'::"OutboxStatus"
    ELSE 'PENDING'::"OutboxStatus"
  END
);

ALTER TABLE "OutboxMessage"
ALTER COLUMN "status" SET DEFAULT 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'RepositoryScanTriggerSource'
  ) THEN
    CREATE TYPE "RepositoryScanTriggerSource" AS ENUM (
      'MANUAL',
      'TRUSTED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'RepositoryScanJobStatus'
  ) THEN
    CREATE TYPE "RepositoryScanJobStatus" AS ENUM (
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'BLOCKED',
      'PENDING_MAPPING',
      'BLOCKED_MAPPING',
      'WAITING_FOR_CONTEXT',
      'READY_TO_SNAPSHOT'
    );
  END IF;
END $$;

ALTER TABLE "RepositoryScanJob"
ALTER COLUMN "triggerSource" TYPE "RepositoryScanTriggerSource"
USING (
  CASE UPPER("triggerSource"::text)
    WHEN 'MANUAL' THEN 'MANUAL'::"RepositoryScanTriggerSource"
    WHEN 'TRUSTED' THEN 'TRUSTED'::"RepositoryScanTriggerSource"
    ELSE 'MANUAL'::"RepositoryScanTriggerSource"
  END
);

ALTER TABLE "RepositoryScanJob"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "RepositoryScanJob"
ALTER COLUMN "status" TYPE "RepositoryScanJobStatus"
USING (
  CASE UPPER("status"::text)
    WHEN 'QUEUED' THEN 'QUEUED'::"RepositoryScanJobStatus"
    WHEN 'RUNNING' THEN 'RUNNING'::"RepositoryScanJobStatus"
    WHEN 'COMPLETED' THEN 'COMPLETED'::"RepositoryScanJobStatus"
    WHEN 'FAILED' THEN 'FAILED'::"RepositoryScanJobStatus"
    WHEN 'BLOCKED' THEN 'BLOCKED'::"RepositoryScanJobStatus"
    WHEN 'PENDING_MAPPING' THEN 'PENDING_MAPPING'::"RepositoryScanJobStatus"
    WHEN 'BLOCKED_MAPPING' THEN 'BLOCKED_MAPPING'::"RepositoryScanJobStatus"
    WHEN 'WAITING_FOR_CONTEXT' THEN 'WAITING_FOR_CONTEXT'::"RepositoryScanJobStatus"
    WHEN 'READY_TO_SNAPSHOT' THEN 'READY_TO_SNAPSHOT'::"RepositoryScanJobStatus"
    ELSE 'QUEUED'::"RepositoryScanJobStatus"
  END
);

ALTER TABLE "RepositoryScanJob"
ALTER COLUMN "status" SET DEFAULT 'QUEUED';

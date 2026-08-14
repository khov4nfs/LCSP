DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'RepositorySnapshotStatus'
  ) THEN
    CREATE TYPE "RepositorySnapshotStatus" AS ENUM (
      'READY'
    );
  END IF;
END $$;

ALTER TABLE "RepositorySnapshot"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "RepositorySnapshot"
ALTER COLUMN "status" TYPE "RepositorySnapshotStatus"
USING (
  CASE UPPER("status"::text)
    WHEN 'READY' THEN 'READY'::"RepositorySnapshotStatus"
    ELSE 'READY'::"RepositorySnapshotStatus"
  END
);

ALTER TABLE "RepositorySnapshot"
ALTER COLUMN "status" SET DEFAULT 'READY';

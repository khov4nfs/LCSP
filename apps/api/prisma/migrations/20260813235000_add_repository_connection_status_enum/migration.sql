DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'RepositoryConnectionStatus'
  ) THEN
    CREATE TYPE "RepositoryConnectionStatus" AS ENUM (
      'ACTIVE',
      'REVOKED'
    );
  END IF;
END $$;

ALTER TABLE "RepositoryConnection"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "RepositoryConnection"
ALTER COLUMN "status" TYPE "RepositoryConnectionStatus"
USING (
  CASE UPPER("status"::text)
    WHEN 'ACTIVE' THEN 'ACTIVE'::"RepositoryConnectionStatus"
    WHEN 'REVOKED' THEN 'REVOKED'::"RepositoryConnectionStatus"
    WHEN 'CONNECTED' THEN 'ACTIVE'::"RepositoryConnectionStatus"
    WHEN 'DISCONNECTED' THEN 'REVOKED'::"RepositoryConnectionStatus"
    ELSE 'ACTIVE'::"RepositoryConnectionStatus"
  END
);

ALTER TABLE "RepositoryConnection"
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

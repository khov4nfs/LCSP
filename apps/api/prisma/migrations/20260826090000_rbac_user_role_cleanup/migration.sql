-- Convert access control from persisted policy rows to user-level RBAC roles.

CREATE TYPE "AuthUserRole" AS ENUM ('ADMIN', 'CUSTOMER');

ALTER TABLE "AuthUser"
  ADD COLUMN "role" "AuthUserRole" NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE "AuthMembership"
  DROP CONSTRAINT IF EXISTS "AuthMembership_policyId_policyVersion_fkey";

ALTER TABLE "AuthMembership"
  DROP COLUMN IF EXISTS "subjectAttributes",
  DROP COLUMN IF EXISTS "policyId",
  DROP COLUMN IF EXISTS "policyVersion";

ALTER TABLE "AuthAuditEvent"
  DROP COLUMN IF EXISTS "policyId",
  DROP COLUMN IF EXISTS "policyVersion";

ALTER TABLE "AuthDecisionLog"
  DROP COLUMN IF EXISTS "policyId",
  DROP COLUMN IF EXISTS "policyVersion";

DROP TABLE IF EXISTS "AuthPolicy";
DROP TYPE IF EXISTS "AuthStateGate";

ALTER TYPE "AuthorizationReasonCode" RENAME VALUE 'PBAC_DENIED' TO 'RBAC_DENIED';
ALTER TYPE "AuthorizationReasonCode" RENAME VALUE 'PBAC_METADATA_MISSING' TO 'RBAC_METADATA_MISSING';

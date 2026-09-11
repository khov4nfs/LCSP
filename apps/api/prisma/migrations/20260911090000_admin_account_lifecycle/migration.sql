-- Durable product suspension is independent of login throttling.
CREATE TYPE "UserAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "AccountInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "AdminAccountOperation" AS ENUM ('ROLE_CHANGE', 'SUSPEND', 'RESTORE', 'INVITE');
ALTER TABLE "User" ADD COLUMN "accessStatus" "UserAccessStatus" NOT NULL DEFAULT 'ACTIVE',
                   ADD COLUMN "accessVersion" INTEGER NOT NULL DEFAULT 0;
-- The LCSP-295 placeholder used year 9999 for product suspension. Migrate
-- that exact sentinel only; finite failed-login lockouts remain unchanged.
UPDATE "User" SET "accessStatus" = 'SUSPENDED', "accessVersion" = 1, "lockUntil" = NULL
WHERE "lockUntil" = TIMESTAMP '9999-12-31 23:59:59.999';
UPDATE "AuthRecord" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'SESSION' AND "revokedAt" IS NULL
  AND "userId" IN (SELECT "id" FROM "User" WHERE "accessStatus" = 'SUSPENDED');
CREATE INDEX "User_accessStatus_role_createdAt_id_idx" ON "User"("accessStatus", "role", "createdAt", "id");
CREATE TABLE "AccountInvitation" (
  "id" TEXT PRIMARY KEY, "email" TEXT NOT NULL, "displayName" TEXT NOT NULL,
  "role" "AuthUserRole" NOT NULL, "status" "AccountInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "generation" INTEGER NOT NULL DEFAULT 0, "tokenHash" TEXT NOT NULL, "encryptedToken" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3), "acceptedUserId" TEXT, "invitedById" TEXT NOT NULL,
  "deliveryStatus" "InvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryLeaseId" TEXT, "deliveryLeaseUntil" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AccountInvitation_email_key" ON "AccountInvitation"("email");
CREATE UNIQUE INDEX "AccountInvitation_tokenHash_key" ON "AccountInvitation"("tokenHash");
CREATE INDEX "AccountInvitation_status_expiresAt_createdAt_id_idx" ON "AccountInvitation"("status", "expiresAt", "createdAt", "id");
CREATE TABLE "AdminAccountCommandReceipt" (
  "id" TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "operation" "AdminAccountOperation" NOT NULL, "requestHash" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL, "resourceGeneration" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AdminAccountCommandReceipt_actorId_idempotencyKey_key" ON "AdminAccountCommandReceipt"("actorId", "idempotencyKey");

ALTER TYPE "AuditResourceType" ADD VALUE 'AUTH_ACCOUNT';
ALTER TYPE "AuthorizationReasonCode" ADD VALUE 'ACCOUNT_SUSPENDED';

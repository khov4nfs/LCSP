-- Drop AccountInvitation table and related enums
DROP TABLE IF EXISTS "AccountInvitation";

DROP TYPE IF EXISTS "AccountInvitationStatus";
DROP TYPE IF EXISTS "InvitationDeliveryStatus";

-- Alter AdminAccountOperation enum to remove INVITE
BEGIN;
LOCK TABLE "AdminAccountCommandReceipt" IN ACCESS EXCLUSIVE MODE;
DELETE FROM "AdminAccountCommandReceipt" WHERE "operation"::text = 'INVITE';
CREATE TYPE "AdminAccountOperation_new" AS ENUM ('SUSPEND', 'RESTORE');
ALTER TABLE "AdminAccountCommandReceipt"
  ALTER COLUMN "operation" TYPE "AdminAccountOperation_new"
  USING ("operation"::text::"AdminAccountOperation_new");
ALTER TYPE "AdminAccountOperation" RENAME TO "AdminAccountOperation_old";
ALTER TYPE "AdminAccountOperation_new" RENAME TO "AdminAccountOperation";
DROP TYPE "AdminAccountOperation_old";
COMMIT;

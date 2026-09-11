-- LCSP-299 product clarification: existing account roles are immutable in Admin management.
-- Do not rewrite the earlier migration; some development databases already applied it.
-- Retire only command-deduplication receipts for the removed endpoint. AuditEvent,
-- User.role, sessions and receipts for supported commands are deliberately preserved.
BEGIN;
LOCK TABLE "AdminAccountCommandReceipt" IN ACCESS EXCLUSIVE MODE;
DELETE FROM "AdminAccountCommandReceipt" WHERE "operation"::text = 'ROLE_CHANGE';
CREATE TYPE "AdminAccountOperation_new" AS ENUM ('SUSPEND', 'RESTORE', 'INVITE');
ALTER TABLE "AdminAccountCommandReceipt"
  ALTER COLUMN "operation" TYPE "AdminAccountOperation_new"
  USING ("operation"::text::"AdminAccountOperation_new");
ALTER TYPE "AdminAccountOperation" RENAME TO "AdminAccountOperation_old";
ALTER TYPE "AdminAccountOperation_new" RENAME TO "AdminAccountOperation";
DROP TYPE "AdminAccountOperation_old";
COMMIT;

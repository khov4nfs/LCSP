ALTER TABLE "OutboxMessage"
ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "OutboxMessage_status_createdAt_idx";
CREATE INDEX "OutboxMessage_status_nextAttemptAt_createdAt_idx"
ON "OutboxMessage"("status", "nextAttemptAt", "createdAt");

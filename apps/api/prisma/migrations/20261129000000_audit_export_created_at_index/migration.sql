-- Bound audit export preflight and keyset pages by creation time and event ID.
CREATE INDEX "AuditEvent_createdAt_id_idx" ON "AuditEvent"("createdAt", "id");

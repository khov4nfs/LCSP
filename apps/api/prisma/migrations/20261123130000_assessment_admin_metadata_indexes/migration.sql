-- ADMIN metadata listing deliberately has no owner predicate. Dedicated indexes avoid
-- sorting the complete Assessment table for stable updatedAt/id pagination, while the
-- lifecycle-prefixed variant supports the only currently accepted ADMIN filter.
-- CONCURRENTLY keeps Assessment writes available during production index construction;
-- this migration must remain outside an explicit transaction because PostgreSQL forbids
-- concurrent index builds inside transaction blocks.
CREATE INDEX CONCURRENTLY "Assessment_updatedAt_id_idx"
ON "Assessment"("updatedAt" DESC, "id");

CREATE INDEX CONCURRENTLY "Assessment_lifecycleState_updatedAt_id_idx"
ON "Assessment"("lifecycleState", "updatedAt" DESC, "id");

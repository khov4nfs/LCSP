-- Keep Admin overview activity counts indexed across the whole Assessment population.
CREATE INDEX "Assessment_createdAt_idx" ON "Assessment"("createdAt");

-- Completion metrics use durable lifecycle events in a bounded time window.
CREATE INDEX "AssessmentEvent_eventType_timestamp_idx" ON "AssessmentEvent"("eventType", "timestamp");

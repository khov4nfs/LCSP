-- Why: Domain rejection callbacks need replay identity after provider settlement is immutable.
-- How: Store one evaluator journal event ID and exact callback fingerprint on the evaluation row.
-- Invariant: A second physical invocation cannot reuse the same evaluator event ID.
ALTER TABLE "ModelOutputEvaluation"
  ADD COLUMN "evaluatorEventId" TEXT,
  ADD COLUMN "evaluationFingerprint" TEXT;

CREATE UNIQUE INDEX "ModelOutputEvaluation_evaluatorEventId_key"
  ON "ModelOutputEvaluation"("evaluatorEventId");

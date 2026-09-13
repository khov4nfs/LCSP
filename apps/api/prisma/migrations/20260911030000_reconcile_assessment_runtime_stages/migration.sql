-- Complete the canonical post-finding runtime vocabulary.
ALTER TYPE "AssessmentRuntimeStage" ADD VALUE IF NOT EXISTS 'CODE_REVIEW';
ALTER TYPE "AssessmentRuntimeStage" ADD VALUE IF NOT EXISTS 'REMEDIATION';
ALTER TYPE "AssessmentRuntimeStage" ADD VALUE IF NOT EXISTS 'VERIFICATION';
ALTER TYPE "AssessmentRuntimeStage" ADD VALUE IF NOT EXISTS 'FINAL_ASSESSMENT';

-- Earlier local runtimes persisted internal engineering-pipeline phases as
-- stages. The public runtime represents this work as LEGAL_RETRIEVAL.
-- Compare as text so this also works on clean databases without legacy labels.
-- Preserve event identity, sequence, summaries, payloads and timestamps.
UPDATE "AssessmentRuntimeEvent"
SET "stage" = 'LEGAL_RETRIEVAL'::"AssessmentRuntimeStage"
WHERE "stage"::text IN ('RULES', 'PLANNER', 'INVESTIGATE', 'GATE');

CREATE TYPE "WorkflowBillingPauseSource" AS ENUM ('SCANNER', 'ENGINEERING', 'INTERVIEW');

ALTER TABLE "WorkflowBillingPause" ALTER COLUMN "sourceEvent" TYPE "WorkflowBillingPauseSource"
USING (CASE "sourceEvent"
  WHEN 'command.scan.requested.v1' THEN 'SCANNER'
  WHEN 'event.technical-evidence.accepted.v1' THEN 'ENGINEERING'
  WHEN 'command.assessment-interview.resume-agent.v1' THEN 'INTERVIEW'
  ELSE "sourceEvent"
END)::"WorkflowBillingPauseSource";

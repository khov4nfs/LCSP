import { Command } from "@nestjs/cqrs";

import type { AssessmentStatusCode } from "@lcsp/contracts/assessment";

export type MarkAiNotDetectedDto = {
  assessment_id: string;
  status: AssessmentStatusCode;
  technical_evidence_report_id: string;
};

/** Worker-requested terminal outcome for an assessment whose evidence proves no AI use. */
export class MarkAiNotDetectedCommand extends Command<MarkAiNotDetectedDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly technicalEvidenceReportId: unknown,
    public readonly correlationId: string,
  ) {
    super();
  }
}

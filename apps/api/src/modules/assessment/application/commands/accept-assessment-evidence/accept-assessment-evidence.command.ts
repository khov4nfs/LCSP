import type { AcceptEvidenceRequest } from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export type AcceptAssessmentEvidenceResult = {
  evidenceId: string;
  type: string;
  state: string;
  contentSha256: string;
  caseRevision: number;
  replayed: boolean;
};

export class AcceptAssessmentEvidenceCommand extends Command<AcceptAssessmentEvidenceResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: AcceptEvidenceRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}

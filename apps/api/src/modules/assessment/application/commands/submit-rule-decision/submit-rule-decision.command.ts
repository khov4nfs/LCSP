import type { SubmitRuleDecisionRequest } from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export type SubmitRuleDecisionResult = {
  decisionId: string;
  decisionRevision: number;
  replayed: boolean;
};

export class SubmitRuleDecisionCommand extends Command<SubmitRuleDecisionResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: SubmitRuleDecisionRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}

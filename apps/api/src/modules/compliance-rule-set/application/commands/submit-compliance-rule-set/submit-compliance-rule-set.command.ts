import type {
  ComplianceRuleSetSubmitRequest,
  ComplianceRuleSetSubmitResult,
} from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class SubmitComplianceRuleSetCommand extends Command<ComplianceRuleSetSubmitResult> {
  constructor(
    public readonly request: ComplianceRuleSetSubmitRequest,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

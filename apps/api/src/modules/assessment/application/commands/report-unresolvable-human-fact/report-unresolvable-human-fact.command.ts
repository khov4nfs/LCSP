import type {
  ReportUnresolvableHumanFactRequest,
  ReportUnresolvableHumanFactResult,
} from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export class ReportUnresolvableHumanFactCommand extends Command<ReportUnresolvableHumanFactResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: ReportUnresolvableHumanFactRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}

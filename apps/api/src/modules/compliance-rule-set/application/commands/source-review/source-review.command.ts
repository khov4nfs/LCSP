import { Command } from "@nestjs/cqrs";
import type { SourceReviewOperation } from "@lcsp/contracts/compliance-rule-set";
export class SourceReviewCommand extends Command<Record<string, unknown>> {
  constructor(
    public readonly request: SourceReviewOperation,
    public readonly correlationId: string,
  ) {
    super();
  }
}
export class StartClaimDiscoveryDiagnosticCommand extends Command<
  Record<string, unknown>
> {
  constructor(
    public readonly legalSourceVersionId: string,
    public readonly idempotencyKey: string,
  ) {
    super();
  }
}

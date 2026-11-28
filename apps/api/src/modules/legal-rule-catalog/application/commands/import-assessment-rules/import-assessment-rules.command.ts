import { Command } from "@nestjs/cqrs";
import type {
  AssessmentRuleImportRequest,
  AssessmentRuleImportResult,
} from "@lcsp/contracts/legal-rule-catalog";

// Why: One import request must preserve its catalog and Admin identity across the command boundary.
// How: The typed command groups the validated payload with actor and correlation context.
// Invariant: Dry-run and write paths share the same handler validation.
export class ImportAssessmentRulesCommand extends Command<AssessmentRuleImportResult> {
  constructor(
    public readonly catalogId: string,
    public readonly request: AssessmentRuleImportRequest,
    public readonly actor: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

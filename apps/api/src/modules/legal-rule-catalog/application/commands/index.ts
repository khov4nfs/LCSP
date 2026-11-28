import { ActivatePreparedRulesHandler } from "./activate-prepared-rules/activate-prepared-rules.handler.js";
import { ImportAssessmentRulesHandler } from "./import-assessment-rules/import-assessment-rules.handler.js";

// Why: Keep command registration aligned with the feature-local command folders used by Auth.
// How: Expose one provider list for Nest's CQRS module registration.
// Invariant: Every command handled by this module has exactly one registered handler.
export const LEGAL_RULE_CATALOG_COMMAND_HANDLERS = [
  ActivatePreparedRulesHandler,
  ImportAssessmentRulesHandler,
] as const;

export { ActivatePreparedRulesCommand } from "./activate-prepared-rules/activate-prepared-rules.command.js";
export { ImportAssessmentRulesCommand } from "./import-assessment-rules/import-assessment-rules.command.js";

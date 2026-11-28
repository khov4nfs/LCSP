import { Command } from "@nestjs/cqrs";
import type {
  AssessmentBudgetExtensionInput,
  AssessmentRuntimeControlAction,
  AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";
export class ControlAssessmentRuntimeCommand extends Command<AssessmentRuntimeControlResult> {
  /**
   * Why: Carries runtime control parameters, including admin budget override idempotency
   * and optimistic version fencing, from HTTP controllers to `AssessmentRuntimeControlService`.
   * How: Stores optional `idempotencyKey` and `expectedVersion` alongside `budgetExtension`.
   * Invariants: Both canonical admin and deprecated legacy routes must populate identical fields.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly actor: RbacRequestContext,
    public readonly action: AssessmentRuntimeControlAction,
    public readonly targetRunId: string,
    public readonly correlationId: string,
    public readonly responseLanguage?: string | null,
    public readonly budgetExtension?: AssessmentBudgetExtensionInput,
    public readonly idempotencyKey?: string,
    public readonly expectedVersion?: number,
  ) {
    super();
  }
}

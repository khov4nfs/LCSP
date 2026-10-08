import { Command } from "@nestjs/cqrs";
import type {
  AssessmentRuntimeControlAction,
  AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";
export class ControlAssessmentRuntimeCommand extends Command<AssessmentRuntimeControlResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly actor: RbacRequestContext,
    public readonly action: AssessmentRuntimeControlAction,
    public readonly targetRunId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}

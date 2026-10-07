import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { assessmentCompletionGateResultSchema } from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { RequestAssessmentFinalizationCommand } from "./request-assessment-finalization.command.js";

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

@CommandHandler(RequestAssessmentFinalizationCommand)
export class RequestAssessmentFinalizationHandler implements ICommandHandler<RequestAssessmentFinalizationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly completionGate: AssessmentCompletionGate,
    private readonly coordinator: AssessmentLifecycleCoordinator,
  ) {}

  execute(command: RequestAssessmentFinalizationCommand) {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        assessmentId: command.assessmentId,
        leaseToken: command.leaseToken,
        correlationId: command.correlationId,
        requireActive: false,
      });
      const inspection = await this.completionGate.inspectInTx(
        tx,
        command.assessmentId,
      );
      let lifecycleState = inspection.lifecycleState;
      if (
        inspection.blockers.length === 0 &&
        lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE
      ) {
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: command.assessmentId,
            expectedRevision: run.lifecycleRevision,
            toState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
            correlationId: command.correlationId,
            actorId: ORCHESTRATOR.id,
          },
          tx,
          [AGENTIC_RUNTIME_TRANSITION_GUARDS.COMPLETION_GATE_ZERO_BLOCKERS],
          ORCHESTRATOR,
        );
        lifecycleState = ASSESSMENT_LIFECYCLE_STATES.FINALIZING;
      }
      return assessmentCompletionGateResultSchema.parse({
        lifecycleState,
        blockers: inspection.blockers,
      });
    });
  }
}

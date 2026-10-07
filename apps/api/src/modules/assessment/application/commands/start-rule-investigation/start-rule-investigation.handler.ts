import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  DECISION_RESOLUTION_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  StartRuleInvestigationCommand,
  type StartRuleInvestigationResult,
} from "./start-rule-investigation.command.js";

@CommandHandler(StartRuleInvestigationCommand)
export class StartRuleInvestigationHandler implements ICommandHandler<StartRuleInvestigationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
  ) {}

  async execute(
    input: StartRuleInvestigationCommand,
  ): Promise<StartRuleInvestigationResult> {
    const request = input.request;

    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, input);
      const row = await this.support.requireCoverage(
        tx,
        input.assessmentId,
        request.engineeringRuleId,
        input.correlationId,
      );
      if (row.resolutionState === DECISION_RESOLUTION_STATES.INVESTIGATING) {
        return { resolutionState: row.resolutionState };
      }
      if (row.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.DECISION_REVISION_STALE,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      await tx.assessmentDecisionCoverage.update({
        where: {
          assessmentId_engineeringRuleId: {
            assessmentId: input.assessmentId,
            engineeringRuleId: request.engineeringRuleId,
          },
        },
        data: { resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING },
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        executionId: run.executionId,
        payload: {
          kind: ASSESSMENT_ACTIVITY_KINDS.DOMAIN,
          labelKey:
            ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS.RULE_INVESTIGATION_STARTED,
        },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      return { resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING };
    });
  }
}

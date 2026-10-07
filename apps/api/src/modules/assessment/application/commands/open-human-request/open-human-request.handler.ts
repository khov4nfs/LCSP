import { randomUUID } from "node:crypto";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { isCustomerSafe } from "../../../domain/customer-safe-text.js";
import { criterionIdsOf } from "../../../domain/rule-criteria.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  AssessmentCaseSupport,
  ROOT_AUDIT_ACTOR,
  invalid,
} from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  OpenHumanRequestCommand,
  type OpenHumanRequestResult,
} from "./open-human-request.command.js";

@CommandHandler(OpenHumanRequestCommand)
export class OpenHumanRequestHandler implements ICommandHandler<OpenHumanRequestCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
    private readonly audit: AuditWriterService,
    private readonly coordinator: AssessmentLifecycleCoordinator,
  ) {}

  async execute(
    input: OpenHumanRequestCommand,
  ): Promise<OpenHumanRequestResult> {
    const request = input.request;
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
        true,
      );
      if (pins.caseRevision !== request.expectedCaseRevision) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { currentCaseRevision: pins.caseRevision },
          },
        );
      }
      const coverage = await this.support.requireCoverage(
        tx,
        input.assessmentId,
        request.engineeringRuleId,
        input.correlationId,
      );
      const rule = await tx.engineeringRule.findUniqueOrThrow({
        where: {
          portfolioVersionId_engineeringRuleId: {
            portfolioVersionId: pins.legalPortfolioVersionId,
            engineeringRuleId: request.engineeringRuleId,
          },
        },
        select: { criteria: true },
      });
      const knownCriteria = new Set(criterionIdsOf(rule.criteria));
      const choiceValues = request.choices.map((choice) => choice.value);
      if (
        request.criterionIds.some((id) => !knownCriteria.has(id)) ||
        new Set(choiceValues).size !== choiceValues.length ||
        !isCustomerSafe(
          [
            request.question,
            request.unresolvedFact,
            ...request.choices.map((c) => c.label),
          ],
          await this.support.portfolioIdentifiers(
            tx,
            pins.legalPortfolioVersionId,
          ),
        )
      ) {
        throw invalid(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
          input.correlationId,
        );
      }
      const requestId = randomUUID();
      await tx.assessmentHumanRequest.create({
        data: {
          requestId,
          assessmentId: input.assessmentId,
          threadId: run.threadId,
          caseRevision: pins.caseRevision,
          engineeringRuleId: request.engineeringRuleId,
          criterionIds: request.criterionIds,
          question: request.question,
          unresolvedFact: request.unresolvedFact,
          decisionImpact: request.decisionImpact,
          resolutionAttempts: request.resolutionAttempts,
          controlType: request.controlType,
          choices: request.choices,
        },
      });
      await this.support.moveCoverageToWaiting(tx, {
        assessmentId: input.assessmentId,
        engineeringRuleId: request.engineeringRuleId,
        from: coverage.resolutionState,
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        executionId: run.executionId,
        payload: {
          requestId,
          fromStatus: null,
          toStatus: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          caseRevision: pins.caseRevision,
        },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      await this.coordinator.transitionVerifiedInTx(
        {
          assessmentId: input.assessmentId,
          expectedRevision: run.lifecycleRevision,
          toState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
          correlationId: input.correlationId,
          actorId: ROOT_AUDIT_ACTOR.id,
        },
        tx,
        [AGENTIC_RUNTIME_TRANSITION_GUARDS.OPEN_MATERIAL_HUMAN_REQUEST],
        ROOT_AUDIT_ACTOR,
      );
      await this.audit.writeInTx(
        {
          eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_REQUEST_OPENED,
          actorId: ROOT_AUDIT_ACTOR.id,
          actor: ROOT_AUDIT_ACTOR,
          assessmentId: input.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: input.assessmentId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: { requestId, engineeringRuleId: request.engineeringRuleId },
        },
        tx,
      );
      return { requestId, caseRevision: pins.caseRevision };
    });
  }
}

import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
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
  RecordRootActivityCommand,
  type RecordRootActivityResult,
} from "./record-root-activity.command.js";

@CommandHandler(RecordRootActivityCommand)
export class RecordRootActivityHandler implements ICommandHandler<RecordRootActivityCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
  ) {}

  async execute(
    input: RecordRootActivityCommand,
  ): Promise<RecordRootActivityResult> {
    const request = input.request;
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      const isChild =
        request.actorType === ASSESSMENT_EVENT_ACTOR_TYPES.SUBAGENT;
      if (
        isChild
          ? request.parentExecutionId !== run.executionId || !request.taskId
          : request.executionId !== run.executionId
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
          input.correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }
      const event = await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
        actorType: request.actorType,
        executionId: request.executionId,
        ...(isChild
          ? {
              parentExecutionId: request.parentExecutionId,
              taskId: request.taskId,
            }
          : {}),
        payload: { kind: request.kind, labelKey: request.labelKey },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      return { eventId: event.eventId, sequence: event.sequence };
    });
  }
}

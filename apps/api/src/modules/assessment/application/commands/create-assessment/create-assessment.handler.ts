import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Inject } from "@nestjs/common";
import type { ICommandHandler } from "@nestjs/cqrs";
import { CommandHandler } from "@nestjs/cqrs";

import {
  ASSESSMENT_DESCRIPTION_MAX_LENGTH,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  ASSESSMENT_NAME_MAX_LENGTH,
} from "@lcsp/contracts/assessment";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { CreateAssessmentDto } from "../../contracts/assessment/create-assessment.contract.js";
import { AssessmentRuntimePreparation } from "../../services/assessment-runtime-preparation.service.js";
import { AssessmentMapper } from "../../mappers/assessment.mapper.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { CreateAssessmentCommand } from "./create-assessment.command.js";

/**
 * Creates customer-owned assessments and atomically persists the assessment, audit record, and outbox event.
 */
@CommandHandler(CreateAssessmentCommand)
export class CreateAssessmentHandler implements ICommandHandler<CreateAssessmentCommand> {
  /**
   * Creates the handler with assessment persistence, audit, outbox, and transactional dependencies.
   *
   * @param assessmentRepository - Repository used to persist the assessment aggregate.
   * @param auditWriter - Audit writer used for allow/deny assessment events.
   * @param outboxRepository - Transactional outbox used to publish the assessment-created event.
   * @param prisma - Prisma service used to coordinate the creation transaction.
   */
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessmentRepository: AssessmentRepository,
    private readonly auditWriter: AuditWriterService,
    private readonly outboxRepository: OutboxRepository,
    private readonly prisma: PrismaService,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
    private readonly runtimePreparation: AssessmentRuntimePreparation,
  ) {}

  /**
   * Authorizes, validates, creates, and transactionally persists a new assessment.
   *
   * @param command - Assessment input plus RBAC and correlation context.
   * @returns The external assessment-creation DTO.
   * @throws When RBAC authorization fails or the requested name/description is invalid.
   */
  async execute(
    command: CreateAssessmentCommand,
  ): Promise<CreateAssessmentDto> {
    this.assertValid(command);

    const assessment = Assessment.create({
      ownerId: command.ownerId,
      name: command.name as string,
      description: command.description,
    });

    const auditEvent = {
      eventType: ASSESSMENT_EVENT_TYPES.created,
      actorId: assessment.ownerId,
      assessmentId: assessment.id,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessment.id,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: ASSESSMENT_EVENT_TYPES.created,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: {
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        correlationId: command.correlationId,
      },
    };
    const outboxEvent = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      aggregateId: assessment.id,
      eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
      assessmentId: assessment.id,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      actor: { id: assessment.ownerId, type: AUDIT_ACTOR_TYPES.user },
      result: ASSESSMENT_EVENT_TYPES.created,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${assessment.id}:${ASSESSMENT_EVENT_TYPES.createdOutbox}`,
      payload: {
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        status: assessment.status,
        correlationId: command.correlationId,
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.assessmentRepository.saveInTx(assessment, tx);
      await this.lifecycle.initializeInTx(
        {
          assessmentId: assessment.id,
          ownerId: assessment.ownerId,
          rootAgentVersion: "assessment-root-v2",
          checkpointNamespace: assessment.id,
          correlationId: command.correlationId,
        },
        tx,
      );
      // Pins the then-ACTIVE legal portfolio; the repository snapshot pins at setup completion.
      await this.runtimePreparation.createCaseInTx(tx, assessment.id);
      await this.lifecycle.transitionInTx(
        {
          assessmentId: assessment.id,
          expectedRevision: 0,
          toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
          correlationId: command.correlationId,
          actorId: assessment.ownerId,
        },
        tx,
      );
      await this.auditWriter.writeInTx(auditEvent, tx);
      await this.outboxRepository.enqueue(outboxEvent, tx);
    });

    return AssessmentMapper.toCreateDto(assessment, command.correlationId);
  }

  /**
   * Validates assessment name and optional description length constraints before domain creation.
   *
   * @param command - Creation command whose user-provided fields should be validated.
   * @returns Nothing when all request fields are valid.
   * @throws An invalid-request problem when the name is empty/too long or the description exceeds its limit.
   */
  private assertValid(command: CreateAssessmentCommand): void {
    const isNameValid =
      typeof command.name === "string" &&
      command.name.trim().length > 0 &&
      command.name.trim().length <= ASSESSMENT_NAME_MAX_LENGTH;

    const isDescriptionValid =
      command.description === undefined ||
      command.description === null ||
      (typeof command.description === "string" &&
        command.description.length <= ASSESSMENT_DESCRIPTION_MAX_LENGTH);

    if (!isNameValid || !isDescriptionValid) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
  }
}

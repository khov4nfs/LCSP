import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  AUDIT_ACTOR_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_NAME_MAX_LENGTH,
  ASSESSMENT_DESCRIPTION_MAX_LENGTH,
} from "@lcsp/contracts/assessment";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import { AssessmentMapper } from "../../mappers/assessment.mapper.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import type { CreateAssessmentDto } from "../../contracts/assessment/create-assessment.contract.js";
import { CreateAssessmentCommand } from "./create-assessment.command.js";

/**
 * Creates manager-owned assessments and atomically persists the assessment, audit record, and outbox event.
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
  ) {}

  /**
   * Authorizes, validates, creates, and transactionally persists a new assessment.
   *
   * @param command - Assessment input plus manager-only PBAC and correlation context.
   * @returns The external assessment-creation DTO.
   * @throws When PBAC authorization fails or the requested name/description is invalid.
   */
  async execute(
    command: CreateAssessmentCommand,
  ): Promise<CreateAssessmentDto> {
    await this.assertManagerOnlyAction(command);
    this.assertValid(command);

    const assessment = Assessment.create({
      organizationId: command.organizationId,
      ownerId: command.ownerId,
      name: command.name as string,
      description: command.description,
    });

    const auditEvent = {
      eventType: ASSESSMENT_EVENT_TYPES.created,
      actorId: assessment.ownerId,
      organizationId: assessment.organizationId,
      assessmentId: assessment.id,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessment.id,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: ASSESSMENT_EVENT_TYPES.created,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        assessmentId: assessment.id,
        organizationId: assessment.organizationId,
        ownerId: assessment.ownerId,
        correlationId: command.correlationId,
      },
    };
    const outboxEvent = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      aggregateId: assessment.id,
      eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
      organizationId: assessment.organizationId,
      assessmentId: assessment.id,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      actor: { id: assessment.ownerId, type: AUDIT_ACTOR_TYPES.user },
      result: ASSESSMENT_EVENT_TYPES.created,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${assessment.id}:${ASSESSMENT_EVENT_TYPES.createdOutbox}`,
      payload: {
        assessmentId: assessment.id,
        organizationId: assessment.organizationId,
        ownerId: assessment.ownerId,
        status: assessment.status,
        correlationId: command.correlationId,
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.assessmentRepository.saveInTx(assessment, tx);
      await this.auditWriter.writeInTx(auditEvent, tx);
      await this.outboxRepository.enqueue(outboxEvent, tx);
    });

    return AssessmentMapper.toCreateDto(assessment, command.correlationId);
  }

  /**
   * Enforces the manager-only assessment-create action and records a deny audit event before rejecting unauthorized requests.
   *
   * @param command - Creation command containing the evaluated PBAC context.
   * @returns A promise that resolves only when the manager/action/policy requirements are satisfied.
   * @throws A PBAC-denied problem when the authorization context is incomplete or not manager-approved.
   */
  private async assertManagerOnlyAction(
    command: CreateAssessmentCommand,
  ): Promise<void> {
    const allowed =
      command.authorization.subjectRole === SUBJECT_ROLES.manager &&
      command.authorization.selectedAction === PBAC_ACTIONS.assessmentCreate &&
      command.authorization.policyId !== null &&
      command.authorization.policyVersion !== null;

    if (allowed) return;

    await this.auditWriter.write({
      eventType: ASSESSMENT_EVENT_TYPES.created,
      actorId: command.ownerId,
      organizationId: command.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: null,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.deny,
      reasonCode: AUTH_ERROR_CODES.pbacDenied,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        action: PBAC_ACTIONS.assessmentCreate,
        result: AUDIT_DECISIONS.deny,
        correlationId: command.correlationId,
      },
    });

    throw problemException(AUTH_ERROR_CODES.pbacDenied, command.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
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

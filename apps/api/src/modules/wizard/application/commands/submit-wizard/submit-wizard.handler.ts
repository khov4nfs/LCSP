import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus, Inject } from "@nestjs/common";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  AUDIT_ACTOR_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { WIZARD_EVENT_TYPES } from "@lcsp/contracts/wizard";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { WIZARD_ERROR_CODES } from "@lcsp/contracts/wizard";

import { SubmitWizardCommand } from "./submit-wizard.command.js";
import {
  toPrismaAssessmentStatus,
  toPrismaWizardStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import type { SubmitWizardResponse } from "../../contracts/wizard/wizard-submit.contract.js";
import {
  WIZARD_PROFILE_REPOSITORY,
  type WizardProfileRepository,
} from "../../ports/persistence/wizard-profile.repository.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { Prisma } from "@prisma/client";
import { WizardValidatorService } from "../../services/wizard/wizard-validator.service.js";

@CommandHandler(SubmitWizardCommand)
export class SubmitWizardHandler implements ICommandHandler<
  SubmitWizardCommand,
  SubmitWizardResponse
> {
  constructor(
    @Inject(WIZARD_PROFILE_REPOSITORY)
    private readonly wizardRepository: WizardProfileRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outboxRepository: OutboxRepository,
    private readonly wizardValidator: WizardValidatorService,
  ) {}

  async execute(command: SubmitWizardCommand): Promise<SubmitWizardResponse> {
    const { assessmentId, organizationId, ownerId, answers, correlationId } =
      command;

    await this.assertManagerOnlyAction(command);

    // 1. Verify assessment ownership
    const isOwned = await this.wizardRepository.verifyAssessmentOwnership(
      assessmentId,
      organizationId,
      ownerId,
    );
    if (!isOwned) {
      throw new AssessmentNotFoundException(correlationId);
    }

    // 2. Fetch existing profile
    const profile =
      await this.wizardRepository.findByAssessmentId(assessmentId);
    if (profile && profile.status === WIZARD_STATUS_CODES.submitted) {
      const repositorySnapshot = await this.prisma.repositorySnapshot.findFirst(
        {
          where: { assessmentId },
        },
      );
      if (repositorySnapshot) {
        throw problemException(
          WIZARD_ERROR_CODES.alreadySubmitted,
          correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
    }

    // 3. Merge answers and validate
    const existingAnswersMap = new Map(
      (profile?.answers ?? []).map((a) => [a.questionId, a]),
    );
    for (const answer of answers) {
      existingAnswersMap.set(answer.questionId, answer);
    }
    const mergedAnswers = Array.from(existingAnswersMap.values());

    const validationErrors = this.wizardValidator.validate(mergedAnswers);
    if (validationErrors.length > 0) {
      throw problemException(
        WIZARD_ERROR_CODES.validationFailed,
        correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          meta: { message: validationErrors.map((e) => e.message).join(", ") },
        },
      );
    }

    const version = profile ? profile.version + 1 : 1;
    const submittedAt = new Date();
    const profileId = profile?.id ?? crypto.randomUUID();

    // 4. DB Transaction: update WizardProfile, update Assessment, enqueue outbox, write audit
    await this.prisma.$transaction(async (tx) => {
      // Upsert WizardProfile
      await tx.wizardProfile.upsert({
        where: { assessmentId },
        update: {
          status: toPrismaWizardStatus(WIZARD_STATUS_CODES.submitted),
          submittedAt,
          answers: mergedAnswers as unknown as Prisma.InputJsonArray,
          version,
        },
        create: {
          id: profileId,
          assessmentId,
          organizationId,
          ownerId,
          version,
          status: toPrismaWizardStatus(WIZARD_STATUS_CODES.submitted),
          answers: mergedAnswers as unknown as Prisma.InputJsonArray,
          submittedAt,
        },
      });

      // Transition Assessment Status
      await tx.assessment.update({
        where: { id: assessmentId },
        data: {
          status: toPrismaAssessmentStatus(
            ASSESSMENT_STATUS_CODES.wizardSubmitted,
          ),
        },
      });

      // Audit log (no answers payload)
      await this.auditWriter.writeInTx(
        {
          eventType: WIZARD_EVENT_TYPES.submitted,
          actorId: ownerId,
          organizationId,
          resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
          resourceId: profileId,
          decision: AUDIT_DECISIONS.allow,
          policyId: command.authorization.policyId,
          policyVersion: command.authorization.policyVersion,
          payload: {
            assessmentId,
            wizardProfileId: profileId,
            version,
            correlationId,
          },
          correlationId,
        },
        tx,
      );

      // Outbox event
      const outboxEvent = buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.wizardProfile,
        aggregateId: profileId,
        eventType: WIZARD_EVENT_TYPES.submittedOutbox,
        organizationId,
        assessmentId,
        correlationId,
        causationId: correlationId,
        actor: { id: ownerId, type: AUDIT_ACTOR_TYPES.user },
        result: WIZARD_EVENT_TYPES.submitted,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${profileId}:${WIZARD_EVENT_TYPES.submittedOutbox}:${version}`,
        payload: {
          assessmentId,
          wizardProfileId: profileId,
          version,
          correlationId,
        },
      });
      await this.outboxRepository.enqueue(outboxEvent, tx);
    });

    return {
      wizard_profile_id: profileId,
      status: WIZARD_STATUS_CODES.submitted,
      version,
      submitted_at: submittedAt.toISOString(),
      assessment_status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
      correlation_id: correlationId,
    };
  }

  private async assertManagerOnlyAction(
    command: SubmitWizardCommand,
  ): Promise<void> {
    const allowed =
      command.authorization.subjectRole === SUBJECT_ROLES.manager &&
      command.authorization.selectedAction === PBAC_ACTIONS.wizardSubmit &&
      command.authorization.policyId !== null &&
      command.authorization.policyVersion !== null;

    if (allowed) return;

    await this.auditWriter.write({
      eventType: WIZARD_EVENT_TYPES.submitted,
      actorId: command.ownerId,
      organizationId: command.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
      resourceId: null,
      decision: AUDIT_DECISIONS.deny,
      reasonCode: AUTH_ERROR_CODES.pbacDenied,
      correlationId: command.correlationId,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        assessmentId: command.assessmentId,
        action: PBAC_ACTIONS.wizardSubmit,
        result: AUDIT_DECISIONS.deny,
      },
    });

    throw problemException(AUTH_ERROR_CODES.pbacDenied, command.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
}

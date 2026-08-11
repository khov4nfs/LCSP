import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus, Inject } from "@nestjs/common";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { WIZARD_EVENT_TYPES } from "@lcsp/contracts/wizard";
import { SaveWizardDraftCommand } from "./save-wizard-draft.command.js";
import type { SaveWizardDraftResponse } from "../../contracts/wizard/wizard-draft.contract.js";
import { WIZARD_PROFILE_REPOSITORY } from "../../ports/persistence/wizard-profile.repository.js";
import type { WizardProfileRepository } from "../../ports/persistence/wizard-profile.repository.js";
import {
  AssessmentNotFoundException,
  WizardAlreadySubmittedException,
} from "../../../domain/exceptions/wizard.exceptions.js";
import { WizardProfileEntity } from "../../../domain/entities/wizard-profile.entity.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";

@CommandHandler(SaveWizardDraftCommand)
export class SaveWizardDraftHandler implements ICommandHandler<
  SaveWizardDraftCommand,
  SaveWizardDraftResponse
> {
  constructor(
    @Inject(WIZARD_PROFILE_REPOSITORY)
    private readonly wizardRepository: WizardProfileRepository,
    private readonly auditWriter: AuditWriterService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    command: SaveWizardDraftCommand,
  ): Promise<SaveWizardDraftResponse> {
    const { assessmentId, organizationId, ownerId, answers, correlationId } =
      command;
    await this.assertManagerOnlyAction(command);

    // 1. Verify assessment exists and is owned by caller
    const isOwned = await this.wizardRepository.verifyAssessmentOwnership(
      assessmentId,
      organizationId,
      ownerId,
    );
    if (!isOwned) {
      throw new AssessmentNotFoundException(correlationId);
    }

    // 2. Fetch existing profile or prepare a new one
    let profile = await this.wizardRepository.findByAssessmentId(assessmentId);

    if (profile) {
      if (profile.status === WIZARD_STATUS_CODES.submitted) {
        const repositorySnapshot =
          await this.prisma.repositorySnapshot.findFirst({
            where: { assessmentId },
          });
        if (repositorySnapshot) {
          throw new WizardAlreadySubmittedException(correlationId);
        }
      }
      const existingAnswersMap = new Map(
        profile.answers.map((a) => [a.questionId, a]),
      );
      for (const answer of answers) {
        existingAnswersMap.set(answer.questionId, answer);
      }
      profile.answers = Array.from(existingAnswersMap.values());
      profile.version += 1;
    } else {
      profile = new WizardProfileEntity({
        assessmentId,
        organizationId,
        ownerId,
        version: 1,
        status: WIZARD_STATUS_CODES.inProgress,
        answers,
      });
    }

    // 3. Upsert draft to DB
    const savedProfile = await this.wizardRepository.upsertDraft(profile);

    // 4. Audit logging
    await this.auditWriter.write({
      eventType: WIZARD_EVENT_TYPES.draftSaved,
      actorId: ownerId,
      organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
      resourceId: savedProfile.id,
      decision: AUDIT_DECISIONS.allow,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        assessmentId,
        wizardProfileId: savedProfile.id,
        version: savedProfile.version,
      },
      correlationId,
    });

    // 5. Map response
    return {
      wizard_profile_id: savedProfile.id,
      status: savedProfile.status,
      version: savedProfile.version,
      updated_at: savedProfile.updatedAt.toISOString(),
      correlation_id: correlationId,
    };
  }

  private async assertManagerOnlyAction(
    command: SaveWizardDraftCommand,
  ): Promise<void> {
    const allowed =
      command.authorization.subjectRole === SUBJECT_ROLES.manager &&
      command.authorization.selectedAction === PBAC_ACTIONS.wizardWrite &&
      command.authorization.policyId !== null &&
      command.authorization.policyVersion !== null;

    if (allowed) return;

    await this.auditWriter.write({
      eventType: WIZARD_EVENT_TYPES.draftSaved,
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
        action: PBAC_ACTIONS.wizardWrite,
        result: AUDIT_DECISIONS.deny,
      },
    });

    throw problemException(AUTH_ERROR_CODES.pbacDenied, command.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
}

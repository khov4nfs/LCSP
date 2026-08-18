import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES, type AuthErrorCode } from "@lcsp/contracts/auth";
import {
  LEGAL_CORPUS_RECOVERY_MISSING_REQUIREMENTS,
  LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND,
  LEGAL_MATCHING_REQUEST_COMMAND,
  LEGAL_RULE_LIFECYCLE_STATUSES,
  type LegalCorpusRecoveryMissingRequirement,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { LegalRetrievalIndexStatus, type Prisma } from "@prisma/client";

import {
  fromPrismaVerifiedProfileStatus,
  toPrismaConflictRecordStatus,
  toPrismaLegalRuleLifecycleStatus,
  toPrismaVerifiedProfileStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ApproveVerifiedProfileCommand } from "./approve-verified-profile.command.js";

export type ApproveVerifiedProfileDto = {
  verified_profile_id: string;
  status: typeof VERIFIED_PROFILE_STATUSES.approved;
  approved_at: string;
  approved_by_id: string;
  correlationId: string;
};

@CommandHandler(ApproveVerifiedProfileCommand)
export class ApproveVerifiedProfileHandler implements ICommandHandler<ApproveVerifiedProfileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(
    command: ApproveVerifiedProfileCommand,
  ): Promise<ApproveVerifiedProfileDto> {
    await this.assertManagerOnly(command);
    await this.assertOwnedAssessment(command);
    const approvedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.verifiedProfile.findFirst({
        where: {
          id: command.verifiedProfileId,
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
        },
        select: {
          id: true,
          assessmentId: true,
          organizationId: true,
          status: true,
        },
      });

      if (!profile) {
        throw problemException(
          SCAN_ERROR_CODES.verifiedProfileNotFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      const profileStatus = fromPrismaVerifiedProfileStatus(profile.status);
      if (profileStatus !== VERIFIED_PROFILE_STATUSES.pendingApproval) {
        throw problemException(
          SCAN_ERROR_CODES.verifiedProfileWrongState,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const pendingConflicts = await tx.conflictRecord.count({
        where: {
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
          status: toPrismaConflictRecordStatus(
            CONFLICT_RECORD_STATUSES.pending,
          ),
        },
      });
      if (pendingConflicts > 0) {
        throw problemException(
          SCAN_ERROR_CODES.pendingConflictsExist,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await tx.verifiedProfile.update({
        where: { id: profile.id },
        data: {
          status: toPrismaVerifiedProfileStatus(
            VERIFIED_PROFILE_STATUSES.approved,
          ),
          approvedAt,
          approvedById: command.approvedById,
        },
      });

      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.verifiedProfileApprovedAudit,
          actorId: command.approvedById,
          organizationId: command.organizationId,
          assessmentId: command.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
          resourceId: profile.id,
          correlationId: command.correlationId,
          causationId: profile.id,
          decision: AUDIT_DECISIONS.allow,
          result: VERIFIED_PROFILE_STATUSES.approved,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          policyId: command.authorization.policyId,
          policyVersion: command.authorization.policyVersion,
          actor: { id: command.approvedById, type: AUDIT_ACTOR_TYPES.user },
          payload: {
            verifiedProfileId: profile.id,
            assessmentId: command.assessmentId,
            approvedById: command.approvedById,
            approvedAt: approvedAt.toISOString(),
            correlationId: command.correlationId,
          },
        },
        tx,
      );

      await this.enqueueLegalMatchingOrRecoveryCommand(command, tx, profile.id);
    });

    return {
      verified_profile_id: command.verifiedProfileId,
      status: VERIFIED_PROFILE_STATUSES.approved,
      approved_at: approvedAt.toISOString(),
      approved_by_id: command.approvedById,
      correlationId: command.correlationId,
    };
  }

  private async assertManagerOnly(
    command: ApproveVerifiedProfileCommand,
  ): Promise<void> {
    const allowed =
      command.subjectRole === SUBJECT_ROLES.manager &&
      command.authorization.selectedAction ===
        PBAC_ACTIONS.verifiedProfileApprove &&
      command.authorization.policyId !== null &&
      command.authorization.policyVersion !== null;

    if (allowed) return;

    await this.auditDenied(command, AUTH_ERROR_CODES.pbacDenied);
    throw problemException(AUTH_ERROR_CODES.pbacDenied, command.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }

  private async assertOwnedAssessment(
    command: ApproveVerifiedProfileCommand,
  ): Promise<void> {
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: command.assessmentId,
        organizationId: command.organizationId,
        ownerId: command.approvedById,
      },
      select: { id: true },
    });

    if (assessment) return;

    await this.auditDenied(command, AUTH_ERROR_CODES.pbacDenied);
    throw problemException(
      ASSESSMENT_ERROR_CODES.notFound,
      command.correlationId,
      { status: HttpStatus.NOT_FOUND },
    );
  }

  private async auditDenied(
    command: ApproveVerifiedProfileCommand,
    reasonCode: AuthErrorCode,
  ): Promise<void> {
    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.verifiedProfileApprovedAudit,
      actorId: command.approvedById,
      organizationId: command.organizationId,
      assessmentId: command.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
      resourceId: command.verifiedProfileId,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.deny,
      reasonCode,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        assessmentId: command.assessmentId,
        verifiedProfileId: command.verifiedProfileId,
        action: PBAC_ACTIONS.verifiedProfileApprove,
        result: AUDIT_DECISIONS.deny,
      },
    });
  }

  private async enqueueLegalMatchingOrRecoveryCommand(
    command: ApproveVerifiedProfileCommand,
    tx: Prisma.TransactionClient,
    verifiedProfileId: string,
  ): Promise<void> {
    const existingMatch = await tx.legalRuleMatch.findFirst({
      where: { verifiedProfileId },
      select: { id: true },
    });
    if (existingMatch) {
      return;
    }

    const inFlightCommand = await tx.outboxMessage.findFirst({
      where: {
        aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
        aggregateId: verifiedProfileId,
        eventType: {
          in: [
            LEGAL_MATCHING_REQUEST_COMMAND,
            LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND,
          ],
        },
        status: {
          in: [OUTBOX_STATUSES.pending, OUTBOX_STATUSES.failed],
        },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (inFlightCommand) {
      return;
    }

    const corpus = await tx.legalCorpusVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
        approvedAt: { not: null },
      },
      orderBy: { approvedAt: "desc" },
      select: { id: true, approvedAt: true },
    });
    if (!corpus) {
      await this.enqueueLegalCorpusRecoveryCommand(
        command,
        tx,
        verifiedProfileId,
        {
          missingRequirement:
            LEGAL_CORPUS_RECOVERY_MISSING_REQUIREMENTS.approvedLegalCorpus,
          corpusVersionId: null,
        },
      );
      return;
    }

    const index = await tx.legalRetrievalIndex.findFirst({
      where: {
        legalCorpusVersionId: corpus.id,
        status: LegalRetrievalIndexStatus.VALID,
        validatedAt: { not: null },
        validationManifestRef: { not: null },
      },
      orderBy: [{ validatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (!index) {
      await this.enqueueLegalCorpusRecoveryCommand(
        command,
        tx,
        verifiedProfileId,
        {
          missingRequirement:
            LEGAL_CORPUS_RECOVERY_MISSING_REQUIREMENTS.validLegalRetrievalIndex,
          corpusVersionId: corpus.id,
        },
      );
      return;
    }

    const catalog = await tx.legalRuleCatalogVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
        approvedAt: { not: null },
      },
      orderBy: { approvedAt: "desc" },
      select: { id: true },
    });
    if (!catalog) {
      return;
    }

    const event = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
      aggregateId: verifiedProfileId,
      eventType: LEGAL_MATCHING_REQUEST_COMMAND,
      organizationId: command.organizationId,
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: verifiedProfileId,
      actor: { id: command.approvedById, type: AUDIT_ACTOR_TYPES.user },
      result: LEGAL_MATCHING_REQUEST_COMMAND,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      authorizationAction: PBAC_ACTIONS.verifiedProfileApprove,
      idempotencyKey: `${verifiedProfileId}:${LEGAL_MATCHING_REQUEST_COMMAND}:${corpus.id}`,
      payload: {
        verifiedProfileId,
        assessmentId: command.assessmentId,
        corpusVersionId: corpus.id,
        checkpointRef: `verified-profile:${verifiedProfileId}:${corpus.id}`,
        correlationId: command.correlationId,
      },
    });
    await this.outboxRepository.enqueue(event, tx);
  }

  private async enqueueLegalCorpusRecoveryCommand(
    command: ApproveVerifiedProfileCommand,
    tx: Prisma.TransactionClient,
    verifiedProfileId: string,
    input: {
      missingRequirement: LegalCorpusRecoveryMissingRequirement;
      corpusVersionId: string | null;
    },
  ): Promise<void> {
    const event = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.verifiedProfile,
      aggregateId: verifiedProfileId,
      eventType: LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND,
      organizationId: command.organizationId,
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: verifiedProfileId,
      actor: { id: command.approvedById, type: AUDIT_ACTOR_TYPES.user },
      result: LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      authorizationAction: PBAC_ACTIONS.verifiedProfileApprove,
      idempotencyKey: `${verifiedProfileId}:${LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND}`,
      payload: {
        verifiedProfileId,
        assessmentId: command.assessmentId,
        organizationId: command.organizationId,
        requestedById: command.approvedById,
        missingRequirement: input.missingRequirement,
        corpusVersionId: input.corpusVersionId,
        checkpointRef: `legal-corpus-recovery:${verifiedProfileId}`,
        idempotencyKey: `${verifiedProfileId}:${LEGAL_CORPUS_RECOVERY_REQUEST_COMMAND}`,
        correlationId: command.correlationId,
      },
    });
    await this.outboxRepository.enqueue(event, tx);
  }
}

import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES, type AuthErrorCode } from "@lcsp/contracts/auth";
import {
  LEGAL_MATCHING_REQUEST_COMMAND,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
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

      if (
        fromPrismaVerifiedProfileStatus(profile.status) !==
        VERIFIED_PROFILE_STATUSES.pendingApproval
      ) {
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

      await this.enqueueLegalMatchingCommandIfReady(command, tx, profile.id);
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

  private async enqueueLegalMatchingCommandIfReady(
    command: ApproveVerifiedProfileCommand,
    tx: Prisma.TransactionClient,
    verifiedProfileId: string,
  ): Promise<void> {
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
}

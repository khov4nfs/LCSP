import * as crypto from "node:crypto";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_SCHEMA_VERSIONS,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import {
  ConflictException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import {
  toPrismaConflictRecordStatus,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaVerifiedProfileStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import type { VerifiedProfileCallbackDto } from "../../contracts/reconciliation/verified-profile-callback.contract.js";
import { AcceptVerifiedProfileCommand } from "./accept-verified-profile.command.js";

const VERIFIED_PROFILE_WORKER_ACTOR_ID = AUDIT_ACTOR_IDS.verifiedProfileWorker;

@CommandHandler(AcceptVerifiedProfileCommand)
export class AcceptVerifiedProfileHandler implements ICommandHandler<AcceptVerifiedProfileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: AcceptVerifiedProfileCommand,
  ): Promise<VerifiedProfileCallbackDto> {
    this.validate(command);

    const payload = command.payload;
    const aiUsageFlow = await this.prisma.aIUsageFlow.findFirst({
      where: {
        id: payload.ai_usage_flow_id,
        assessmentId: payload.assessment_id,
        status: toPrismaEvidenceAcceptanceStatus(
          AI_USAGE_FLOW_STATUSES.accepted,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
      },
    });
    if (!aiUsageFlow) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.aiUsageFlowNotFound),
      );
    }

    // Verified profiles are immutable, so unresolved Manager conflicts must block acceptance.
    const pendingConflicts = await this.prisma.conflictRecord.count({
      where: {
        assessmentId: aiUsageFlow.assessmentId,
        organizationId: aiUsageFlow.organizationId,
        status: toPrismaConflictRecordStatus(CONFLICT_RECORD_STATUSES.pending),
      },
    });
    if (pendingConflicts > 0) {
      throw new ConflictException(
        this.errorBody(command, SCAN_ERROR_CODES.pendingConflictsExist),
      );
    }

    const existing = await this.prisma.verifiedProfile.findUnique({
      where: { aiUsageFlowId: aiUsageFlow.id },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        this.errorBody(command, SCAN_ERROR_CODES.profileAlreadyExists),
      );
    }

    const verifiedProfileId = crypto.randomUUID();
    const status = VERIFIED_PROFILE_STATUSES.pendingApproval;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.verifiedProfile.create({
          data: {
            id: verifiedProfileId,
            aiUsageFlowId: aiUsageFlow.id,
            assessmentId: aiUsageFlow.assessmentId,
            organizationId: aiUsageFlow.organizationId,
            schemaVersion: payload.schema_version,
            providerVersion: payload.provider_version,
            profileData: payload.profile_data as Prisma.InputJsonValue,
            gatesPassedAt: payload.gates_passed_at as Prisma.InputJsonValue,
            status: toPrismaVerifiedProfileStatus(status),
          },
        });

        // Generation is not approval. Do not emit verifiedProfileReady until a
        // Manager explicitly approves this immutable profile.
        await this.auditAccepted(
          command,
          tx,
          aiUsageFlow,
          verifiedProfileId,
          status,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          this.errorBody(command, SCAN_ERROR_CODES.profileAlreadyExists),
        );
      }
      throw error;
    }

    return {
      accepted: true,
      verified_profile_id: verifiedProfileId,
      status,
      correlationId: command.correlationId,
    };
  }

  private validate(command: AcceptVerifiedProfileCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.ai_usage_flow_id) ||
      !clean(payload.assessment_id) ||
      !VERIFIED_PROFILE_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof VERIFIED_PROFILE_SCHEMA_VERSIONS)[number],
      ) ||
      !clean(payload.provider_version) ||
      !isRecord(payload.profile_data) ||
      !isRecord(payload.gates_passed_at)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.verifiedProfileSchemaInvalid),
      );
    }
  }

  private async auditAccepted(
    command: AcceptVerifiedProfileCommand,
    tx: Prisma.TransactionClient,
    aiUsageFlow: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    verifiedProfileId: string,
    status: string,
  ): Promise<void> {
    await this.auditWriter.writeInTx(
      {
        eventType: SCAN_EVENT_TYPES.verifiedProfileAcceptedAudit,
        actorId: VERIFIED_PROFILE_WORKER_ACTOR_ID,
        organizationId: aiUsageFlow.organizationId,
        assessmentId: aiUsageFlow.assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
        resourceId: verifiedProfileId,
        correlationId: command.correlationId,
        causationId: aiUsageFlow.id,
        decision: AUDIT_DECISIONS.allow,
        result: SCAN_EVENT_TYPES.verifiedProfileAcceptedAudit,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        actor: {
          id: VERIFIED_PROFILE_WORKER_ACTOR_ID,
          type: AUDIT_ACTOR_TYPES.service,
        },
        // Keep detailed evidence out of audit logs; the profile record is the source of truth.
        payload: {
          verifiedProfileId,
          assessmentId: aiUsageFlow.assessmentId,
          aiUsageFlowId: aiUsageFlow.id,
          status,
          correlationId: command.correlationId,
        },
      },
      tx,
    );
  }

  private errorBody(command: AcceptVerifiedProfileCommand, errorCode: string) {
    return problemResult(errorCode, command.correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

import * as crypto from "node:crypto";
import * as fs from "node:fs";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  TECHNICAL_PROFILE_SCHEMA_VERSIONS,
  TECHNICAL_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import {
  ConflictException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import { isRecord } from "../../../../../common/utils/index.js";

import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaOutboxAggregateType,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";
import type { TechnicalProfileCallbackDto } from "../../contracts/evidence/technical-profile-callback.contract.js";
import { AcceptTechnicalProfileCommand } from "./accept-technical-profile.command.js";

const TECHNICAL_PROFILE_WORKER_ACTOR_ID =
  AUDIT_ACTOR_IDS.technicalProfileWorker;
const FORBIDDEN_PROFILE_KEYS = new Set([
  "codesnippet",
  "filecontent",
  "rawoutput",
  "rawsource",
  "rawsourcecode",
  "snippet",
  "sourcecode",
  "sourcecontent",
]);
const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
];

@CommandHandler(AcceptTechnicalProfileCommand)
export class AcceptTechnicalProfileHandler implements ICommandHandler<AcceptTechnicalProfileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: ArtifactStorageService,
  ) {}

  async execute(
    command: AcceptTechnicalProfileCommand,
  ): Promise<TechnicalProfileCallbackDto> {
    const payload = command.payload;
    if (payload.is_artifact_reference && payload.artifact_manifest) {
      try {
        const reconstructed = await this.storageService.readAndReconstruct(
          payload.artifact_manifest,
        );
        const fullPayload = JSON.parse(reconstructed) as Record<
          string,
          unknown
        >;
        Object.assign(payload, fullPayload);
        payload.is_artifact_reference = false;
      } catch {
        // If profile_data is already present inline in the callback payload,
        // we can fallback to it instead of failing.
        if (
          !payload.profile_data ||
          typeof payload.profile_data !== "object" ||
          Object.keys(payload.profile_data).length === 0
        ) {
          throw new UnprocessableEntityException(
            this.errorBody(
              command,
              SCAN_ERROR_CODES.artifactStorageError,
              HttpStatus.UNPROCESSABLE_ENTITY,
            ),
          );
        }
        payload.is_artifact_reference = false;
      }
    }

    if (payload?.profile_data && typeof payload.profile_data === "object") {
      const ref = payload.profile_data.profile_data_ref;
      if (typeof ref === "string" && ref) {
        try {
          if (fs.existsSync(ref)) {
            const fileContent = fs.readFileSync(ref, "utf8");
            const fileData = JSON.parse(fileContent) as Record<string, unknown>;
            if (fileData && typeof fileData === "object") {
              payload.profile_data = {
                ...fileData,
                ...payload.profile_data,
              };
            }
          }
        } catch {
          // ignore
        }
      }
    }

    this.validate(command);
    const evidenceReport = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        id: payload.evidence_report_id,
        assessmentId: payload.assessment_id,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
      },
    });
    if (!evidenceReport) {
      throw new NotFoundException(
        this.errorBody(
          command,
          SCAN_ERROR_CODES.evidenceReportNotFound,
          HttpStatus.NOT_FOUND,
        ),
      );
    }

    const existing = await this.prisma.technicalProfile.findUnique({
      where: { evidenceReportId: evidenceReport.id },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        this.errorBody(
          command,
          SCAN_ERROR_CODES.profileAlreadyExists,
          HttpStatus.CONFLICT,
        ),
      );
    }

    const technicalProfileId = crypto.randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.technicalProfile.create({
          data: {
            id: technicalProfileId,
            evidenceReportId: evidenceReport.id,
            assessmentId: evidenceReport.assessmentId,
            schemaVersion: payload.schema_version,
            providerVersion: payload.provider_version,
            profileData: payload.profile_data as Prisma.InputJsonValue,
            privacyFlags: payload.privacy_flags as Prisma.InputJsonValue,
            status: toPrismaEvidenceAcceptanceStatus(
              TECHNICAL_PROFILE_STATUSES.accepted,
            ),
          },
        });

        const outboxEvent = buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.technicalProfile,
          aggregateId: technicalProfileId,
          eventType: SCAN_EVENT_TYPES.technicalProfileReady,
          assessmentId: evidenceReport.assessmentId,
          correlationId: command.correlationId,
          causationId: evidenceReport.id,
          actor: {
            id: TECHNICAL_PROFILE_WORKER_ACTOR_ID,
            type: AUDIT_ACTOR_TYPES.service,
          },
          result: SCAN_EVENT_TYPES.technicalProfileAcceptedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${technicalProfileId}:${SCAN_EVENT_TYPES.technicalProfileReady}`,
          payload: {
            technicalProfileId,
            assessmentId: evidenceReport.assessmentId,
            evidenceReportId: evidenceReport.id,
            correlationId: command.correlationId,
          },
        });
        await tx.outboxMessage.create({
          data: {
            id: crypto.randomUUID(),
            aggregateType: toPrismaOutboxAggregateType(
              outboxEvent.aggregateType,
            ),
            aggregateId: outboxEvent.aggregateId,
            eventType: outboxEvent.eventType,
            payload: outboxEvent.payload as Prisma.InputJsonValue,
          },
        });

        const auditEvent = buildAuditEventInput({
          eventType: SCAN_EVENT_TYPES.technicalProfileAcceptedAudit,
          actorId: TECHNICAL_PROFILE_WORKER_ACTOR_ID,
          assessmentId: evidenceReport.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.technicalProfile,
          resourceId: technicalProfileId,
          correlationId: command.correlationId,
          causationId: evidenceReport.id,
          decision: AUDIT_DECISIONS.allow,
          result: SCAN_EVENT_TYPES.technicalProfileAcceptedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: {
            id: TECHNICAL_PROFILE_WORKER_ACTOR_ID,
            type: AUDIT_ACTOR_TYPES.service,
          },
          payload: {
            technicalProfileId,
            assessmentId: evidenceReport.assessmentId,
            evidenceReportId: evidenceReport.id,
            correlationId: command.correlationId,
          },
        });
        await tx.auditEvent.create({
          data: {
            id: crypto.randomUUID(),
            eventType: auditEvent.eventType,
            actorId: auditEvent.actorId,
            resourceType: auditEvent.resourceType
              ? toPrismaAuditResourceType(auditEvent.resourceType)
              : null,
            resourceId: auditEvent.resourceId ?? null,
            correlationId: auditEvent.correlationId,
            reasonCode: auditEvent.reasonCode ?? null,
            decision: auditEvent.decision
              ? toPrismaAuthDecision(auditEvent.decision)
              : null,
            payload: auditEvent.payload as Prisma.InputJsonValue,
          },
        });
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
      technical_profile_id: technicalProfileId,
      correlationId: command.correlationId,
    };
  }

  private validate(command: AcceptTechnicalProfileCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.evidence_report_id) ||
      !clean(payload.assessment_id) ||
      !TECHNICAL_PROFILE_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof TECHNICAL_PROFILE_SCHEMA_VERSIONS)[number],
      ) ||
      !clean(payload.provider_version) ||
      !isRecord(payload.profile_data) ||
      !isRecord(payload.privacy_flags)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(
          command,
          SCAN_ERROR_CODES.technicalProfileSchemaInvalid,
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );
    }

    if (
      payload.privacy_flags.containsSourceCode !== false ||
      payload.privacy_flags.secretsRedacted !== true ||
      containsUnsafeProfile(payload.profile_data)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(
          command,
          SCAN_ERROR_CODES.privacyFlagsInvalid,
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );
    }
  }

  private errorBody(
    command: AcceptTechnicalProfileCommand,
    errorCode: string,
    status: number = HttpStatus.UNPROCESSABLE_ENTITY,
  ) {
    return problemResult(errorCode, command.correlationId, {
      status,
    });
  }
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function containsUnsafeProfile(value: unknown): boolean {
  if (typeof value === "string") {
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafeProfile);
  }
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    return (
      FORBIDDEN_PROFILE_KEYS.has(normalizedKey) || containsUnsafeProfile(entry)
    );
  });
}

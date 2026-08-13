import {
  AUDIT_DECISIONS,
  AUDIT_ERROR_CODES,
  AUDIT_EVENT_TYPES,
  AUDIT_EXPORT_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { ORGANIZATION_SCOPE_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import {
  fromPrismaAuthDecision,
  toPrismaAuditExportStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  AuditExportArtifact,
  AuditExportArtifactEvent,
  AuditExportRequestDto,
} from "../../contracts/audit/audit-export.contract.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { ExportAuditTrailCommand } from "./export-audit-trail.command.js";

const MAX_DATE_RANGE_MS = 365 * 24 * 60 * 60 * 1_000;

@CommandHandler(ExportAuditTrailCommand)
export class ExportAuditTrailHandler implements ICommandHandler<ExportAuditTrailCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redactor: AuditRedactorService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: ExportAuditTrailCommand,
  ): Promise<AuditExportRequestDto> {
    if (command.organizationId !== command.sessionOrganizationId) {
      this.badRequest(
        ORGANIZATION_SCOPE_ERROR_CODES.mismatch,
        command.correlationId,
      );
    }

    const fromDate = this.parseDate(
      command.fromDate,
      "from_date",
      command.correlationId,
    );
    const toDate = this.parseDate(
      command.toDate,
      "to_date",
      command.correlationId,
    );
    const range = toDate.getTime() - fromDate.getTime();
    if (range < 0) {
      this.badRequest(
        AUDIT_ERROR_CODES.invalidDateRange,
        command.correlationId,
      );
    }
    if (range > MAX_DATE_RANGE_MS) {
      this.badRequest(
        AUDIT_ERROR_CODES.dateRangeExceeded,
        command.correlationId,
      );
    }

    const [latest, rows] = await Promise.all([
      this.prisma.auditExportRequest.findFirst({
        where: { organizationId: command.organizationId },
        orderBy: { version: "desc" },
        select: { version: true },
      }),
      this.prisma.authAuditEvent.findMany({
        where: {
          organizationId: command.organizationId,
          createdAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          eventType: true,
          actorId: true,
          organizationId: true,
          decision: true,
          payload: true,
          createdAt: true,
        },
      }),
    ]);

    const version = (latest?.version ?? 0) + 1;
    const generatedAt = new Date();
    const events: AuditExportArtifactEvent[] = rows.map((row) => ({
      event_id: row.id,
      event_type: row.eventType,
      actor_id: row.actorId,
      organization_id: row.organizationId ?? command.organizationId,
      decision: row.decision ? fromPrismaAuthDecision(row.decision) : null,
      payload: this.redactor.redact(row.payload),
      occurred_at: row.createdAt.toISOString(),
    }));

    const baseArtifact = {
      export_request_id: crypto.randomUUID(),
      organization_id: command.organizationId,
      version,
      generated_at: generatedAt.toISOString(),
      filter_criteria: {
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
      },
      total_events: events.length,
      events,
    };
    const checksum = createHash("sha256")
      .update(JSON.stringify(baseArtifact))
      .digest("hex");
    const artifact: AuditExportArtifact = {
      ...baseArtifact,
      checksum_sha256: checksum,
    };

    await this.prisma.auditExportRequest.create({
      data: {
        id: artifact.export_request_id,
        organizationId: command.organizationId,
        requestedById: command.requestedById,
        fromDate,
        toDate,
        status: toPrismaAuditExportStatus(AUDIT_EXPORT_STATUSES.ready),
        version,
        checksumSha256: checksum,
        contentJson: artifact as unknown as Prisma.InputJsonValue,
        correlationId: command.correlationId,
        createdAt: generatedAt,
        completedAt: generatedAt,
      },
    });

    await this.auditWriter.write({
      eventType: AUDIT_EVENT_TYPES.exportGenerated,
      actorId: command.requestedById,
      organizationId: command.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.auditExportRequest,
      resourceId: artifact.export_request_id,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        exportRequestId: artifact.export_request_id,
        version,
        checksumSha256: checksum,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        totalEvents: events.length,
      },
    });

    return {
      export_request_id: artifact.export_request_id,
      status: AUDIT_EXPORT_STATUSES.ready,
      from_date: fromDate.toISOString(),
      to_date: toDate.toISOString(),
      version,
      generated_at: generatedAt.toISOString(),
      correlationId: command.correlationId,
    };
  }

  private parseDate(value: string, field: string, correlationId: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      this.badRequest(AUDIT_ERROR_CODES.invalidQuery, correlationId, field);
    }

    return date;
  }

  private badRequest(
    errorCode: string,
    correlationId: string,
    field?: string,
  ): never {
    throw problemException(errorCode, correlationId, {
      status: HttpStatus.BAD_REQUEST,
      ...(field ? { meta: { field } } : {}),
    });
  }
}

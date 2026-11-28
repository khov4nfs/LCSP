import {
  AUDIT_DECISIONS,
  AUDIT_ERROR_CODES,
  AUDIT_EVENT_TYPES,
  AUDIT_EXPORT_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import {
  fromPrismaAuthDecision,
  toPrismaAuditExportStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import type {
  AuditExportArtifact,
  AuditExportArtifactEvent,
  AuditExportRequestDto,
} from "../../contracts/audit/audit-export.contract.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { auditExportChecksum } from "../../services/audit/audit-export-checksum.js";
import { ExportAuditTrailCommand } from "./export-audit-trail.command.js";

const MAX_DATE_RANGE_MS = 365 * 24 * 60 * 60 * 1_000;
const MAX_EXPORT_EVENTS = 10_000;
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
const EXPORT_PAGE_SIZE = 100;

/**
 * Builds immutable, redacted audit export artifacts and records the export action itself.
 */
@CommandHandler(ExportAuditTrailCommand)
export class ExportAuditTrailHandler implements ICommandHandler<ExportAuditTrailCommand> {
  /**
   * Creates the export handler with audit persistence, redaction, and audit-writing dependencies.
   *
   * @param prisma - Prisma service used to read audit events and persist export requests.
   * @param redactor - Service used to sanitize event payloads before they leave the audit store.
   * @param auditWriter - Audit writer used to record successful export generation.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly redactor: AuditRedactorService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Business purpose: Publish a bounded, verifiable snapshot of audit events for an Admin.
   * Business rules:
   * - Date range, event count and serialized size must remain within export limits; version is globally unique.
   * Execution flow:
   * 1. Validate dates and reject oversized database payloads before transferring event JSON.
   * 2. Read small, stable pages and redact each payload within the byte and event limits.
   * 3. Lock version allocation, calculate a canonical digest and persist the READY artifact with its audit event.
   * Failure cases:
   * - Invalid scope or oversized content returns a problem; persistence or audit failure rolls back the transaction.
   * Side effects:
   * - Inserts one export request and one audit event atomically.
   */
  async execute(
    command: ExportAuditTrailCommand,
  ): Promise<AuditExportRequestDto> {
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

    const generatedAt = new Date();
    // Freeze the upper read boundary so events written after preflight cannot enter later pages.
    const readToDate = toDate < generatedAt ? toDate : generatedAt;
    // Reject oversized scopes before PostgreSQL decodes their JSON payloads.
    const [count] = await this.prisma.$queryRaw<Array<{ eventCount: bigint }>>`
      SELECT COUNT(*) AS "eventCount" FROM (
        SELECT 1 FROM "AuditEvent"
        WHERE "createdAt" >= ${fromDate} AND "createdAt" <= ${readToDate}
        LIMIT ${MAX_EXPORT_EVENTS + 1}
      ) AS bounded_events
    `;
    if (!count || count.eventCount > BigInt(MAX_EXPORT_EVENTS)) {
      this.badRequest(
        AUDIT_ERROR_CODES.invalidQuery,
        command.correlationId,
        "event_limit",
      );
    }
    // Only a scope below the event cap reaches the byte measurement.
    const [size] = await this.prisma.$queryRaw<Array<{ payloadBytes: bigint }>>`
      SELECT COALESCE(SUM(octet_length("payload"::text)), 0) AS "payloadBytes"
      FROM "AuditEvent"
      WHERE "createdAt" >= ${fromDate} AND "createdAt" <= ${readToDate}
    `;
    if (!size || size.payloadBytes > BigInt(MAX_EXPORT_BYTES)) {
      this.badRequest(
        AUDIT_ERROR_CODES.invalidQuery,
        command.correlationId,
        "artifact_size",
      );
    }

    const events: AuditExportArtifactEvent[] = [];
    let serializedBytes = 0;
    let cursor: { createdAt: Date; id: string } | undefined;
    while (true) {
      // Keyset pages avoid deep OFFSET scans and keep each transfer bounded.
      const page = await this.prisma.auditEvent.findMany({
        where: {
          createdAt: { gte: fromDate, lte: readToDate },
          ...(cursor
            ? {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: EXPORT_PAGE_SIZE,
        select: {
          id: true,
          eventType: true,
          actorId: true,
          decision: true,
          payload: true,
          createdAt: true,
        },
      });
      if (events.length + page.length > MAX_EXPORT_EVENTS) {
        this.badRequest(
          AUDIT_ERROR_CODES.invalidQuery,
          command.correlationId,
          "event_limit",
        );
      }
      for (const row of page) {
        const event: AuditExportArtifactEvent = {
          event_id: row.id,
          event_type: row.eventType,
          actor_id: row.actorId,
          decision: row.decision ? fromPrismaAuthDecision(row.decision) : null,
          payload: this.redactor.redact(row.payload),
          occurred_at: row.createdAt.toISOString(),
        };
        serializedBytes += Buffer.byteLength(JSON.stringify(event), "utf8");
        if (serializedBytes > MAX_EXPORT_BYTES) {
          this.badRequest(
            AUDIT_ERROR_CODES.invalidQuery,
            command.correlationId,
            "artifact_size",
          );
        }
        events.push(event);
      }
      if (page.length < EXPORT_PAGE_SIZE) break;
      const last = page[page.length - 1];
      if (!last) break;
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    const exportRequestId = crypto.randomUUID();
    // Version authority and the audit proof are committed together under one DB lock.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(299, 7)`;
      const latest = await tx.auditExportRequest.findFirst({
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      const baseArtifact = {
        export_request_id: exportRequestId,
        version,
        generated_at: generatedAt.toISOString(),
        filter_criteria: {
          from_date: fromDate.toISOString(),
          to_date: toDate.toISOString(),
        },
        total_events: events.length,
        events,
      };
      const checksum = auditExportChecksum(baseArtifact);
      if (
        Buffer.byteLength(JSON.stringify(baseArtifact), "utf8") >
        MAX_EXPORT_BYTES
      ) {
        this.badRequest(
          AUDIT_ERROR_CODES.invalidQuery,
          command.correlationId,
          "artifact_size",
        );
      }
      const artifact: AuditExportArtifact = {
        ...baseArtifact,
        checksum_sha256: checksum,
      };

      await tx.auditExportRequest.create({
        data: {
          id: artifact.export_request_id,
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

      await this.auditWriter.writeInTx(
        {
          eventType: AUDIT_EVENT_TYPES.exportGenerated,
          actorId: command.requestedById,
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
        },
        tx,
      );

      return {
        export_request_id: artifact.export_request_id,
        status: AUDIT_EXPORT_STATUSES.ready,
        from_date: fromDate.toISOString(),
        to_date: toDate.toISOString(),
        version,
        generated_at: generatedAt.toISOString(),
        correlationId: command.correlationId,
      };
    });
  }

  /**
   * Parses a required ISO-compatible date field and maps invalid values to the audit problem contract.
   *
   * @param value - Raw date string supplied by the caller.
   * @param field - Request field name reported in validation metadata.
   * @param correlationId - Correlation identifier attached to validation errors.
   * @returns Parsed date value.
   * @throws An invalid-query problem when the date cannot be parsed.
   */
  private parseDate(value: string, field: string, correlationId: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      this.badRequest(AUDIT_ERROR_CODES.invalidQuery, correlationId, field);
    }

    return date;
  }

  /**
   * Throws a standardized audit bad-request problem.
   *
   * @param errorCode - Stable audit or organization-scope error code.
   * @param correlationId - Correlation identifier attached to the problem response.
   * @param field - Optional invalid field name to expose in problem metadata.
   * @throws Always throws the constructed bad-request problem.
   */
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

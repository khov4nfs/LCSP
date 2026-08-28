import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
  type AuditEventInput,
} from "@lcsp/contracts/audit";

import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
} from "../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuditSanitizer } from "./audit-sanitizer.js";

/**
 * Persists normalized and sanitized audit events to the canonical AuditEvent store through Prisma.
 */
@Injectable()
export class AuditWriterService {
  private readonly logger = new Logger(AuditWriterService.name);

  /**
   * Creates an audit writer backed by the application Prisma client.
   *
   * @param prisma - Prisma service used for non-transactional AuditEvent writes.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an audit event using the default Prisma client.
   *
   * @param event - Audit event to sanitize, normalize, and persist.
   * @returns A promise that resolves after the audit event has been stored.
   */
  async write(event: AuditEventInput): Promise<void> {
    await this.persist(this.prisma, event);
  }

  /**
   * Persists an audit event within an existing Prisma transaction.
   *
   * @param event - Audit event to sanitize, normalize, and persist.
   * @param tx - Active Prisma transaction client that owns the AuditEvent write.
   * @returns A promise that resolves after the audit event has been stored.
   */
  async writeInTx(
    event: AuditEventInput,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.persist(tx, event);
  }

  /**
   * Sanitizes an audit event, enriches its payload envelope, and writes it using the supplied client.
   *
   * @param client - Prisma transaction-compatible client used to persist the canonical AuditEvent record.
   * @param event - Audit event to normalize and persist.
   * @returns A promise that resolves when persistence completes.
   */
  private async persist(
    client: Prisma.TransactionClient,
    event: AuditEventInput,
  ): Promise<void> {
    const { payload, removedKeys } = AuditSanitizer.sanitize(event.payload);
    const redactionStatus =
      event.redactionStatus ??
      (removedKeys.length > 0
        ? AUDIT_REDACTION_STATUSES.redacted
        : AUDIT_REDACTION_STATUSES.none);
    const actor = event.actor ?? {
      id: event.actorId,
      type: event.actorId ? AUDIT_ACTOR_TYPES.user : AUDIT_ACTOR_TYPES.system,
    };
    const payloadWithEnvelope = {
      ...(payload ?? {}),
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      actor,
      ...(event.assessmentId ? { assessmentId: event.assessmentId } : {}),
      ...(event.causationId ? { causationId: event.causationId } : {}),
      redactionStatus,
      result: event.result ?? event.decision ?? event.eventType,
    };

    for (const key of removedKeys) {
      this.logger.warn(`Audit payload field removed by sanitizer: ${key}`);
    }

    try {
      await client.auditEvent.create({
        data: {
          id: crypto.randomUUID(),
          eventType: event.eventType,
          actorId: event.actorId,
          resourceType: event.resourceType
            ? toPrismaAuditResourceType(event.resourceType)
            : null,
          resourceId: event.resourceId ?? null,
          reasonCode: event.reasonCode ?? null,
          correlationId: event.correlationId,
          sessionId: event.sessionId ?? null,
          decision: event.decision
            ? toPrismaAuthDecision(event.decision)
            : null,
          payload: payloadWithEnvelope as unknown as Prisma.InputJsonValue,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit event (eventType=${event.eventType}): ${(error as Error).message}`,
      );
      throw error;
    }
  }
}

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
   * Business purpose: Persist required audit evidence in the source-deletion transaction and expose its durable identity to the receipt.
   *
   * Business rules:
   * - The supplied Prisma transaction owns both the audit write and rollback; this method never commits independently.
   *
   * Execution flow:
   * 1. Delegate to the canonical sanitizer and persistence path using the caller transaction.
   * 2. Return the created AuditEvent identifier for receipt linkage.
   *
   * Failure cases:
   * - Sanitization or database persistence failures propagate and force the caller transaction to roll back.
   *
   * Side effects:
   * - Inserts one sanitized AuditEvent row in the caller's transaction.
   */
  async writeInTxReturningId(
    event: AuditEventInput,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return this.persist(tx, event);
  }

  /**
   * Binds the audit sink to an existing transaction without creating or
   * committing another transaction. Application callers receive only a writer.
   */
  forTransaction(tx: Prisma.TransactionClient): {
    write(event: AuditEventInput): Promise<void>;
  } {
    return { write: (event) => this.writeInTx(event, tx) };
  }

  /**
   * Business purpose: Store a normalized audit event while enforcing payload sanitization and actor attribution.
   *
   * Business rules:
   * - Sensitive payload fields are removed by the canonical sanitizer; a supplied transaction client controls commit or rollback.
   *
   * Execution flow:
   * 1. Sanitize payload fields and derive redaction, actor, schema-version, and result metadata.
   * 2. Insert the normalized AuditEvent row through the supplied Prisma client.
   * 3. Return its row identifier to transactional callers.
   *
   * Failure cases:
   * - Persistence errors are logged without payload content and rethrown so required audit cannot be silently omitted.
   *
   * Side effects:
   * - Writes one AuditEvent row and emits redaction warnings containing removed field names only.
   */
  private async persist(
    client: Prisma.TransactionClient,
    event: AuditEventInput,
  ): Promise<string> {
    const { payload, removedKeys } = AuditSanitizer.sanitize(event.payload);
    const redactionStatus =
      removedKeys.length > 0
        ? AUDIT_REDACTION_STATUSES.redacted
        : (event.redactionStatus ?? AUDIT_REDACTION_STATUSES.none);
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
      this.logger.warn(
        `Audit payload field redacted, truncated, or removed by sanitizer: ${key}`,
      );
    }

    try {
      const id = crypto.randomUUID();
      await client.auditEvent.create({
        data: {
          id,
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
      return id;
    } catch (error) {
      this.logger.error(
        `Failed to write audit event (eventType=${event.eventType}): ${(error as Error).message}`,
      );
      throw error;
    }
  }
}

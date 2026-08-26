import { randomUUID } from "node:crypto";

import type {
  AuditDecision,
  AuditEvent as AuditEventProps,
  AuditEventInput,
} from "@lcsp/contracts/audit";

/**
 * Represents an immutable audit event used by the application before and after persistence.
 */
export class AuditEventEntity implements AuditEventProps {
  readonly id: string = randomUUID();

  /**
   * Creates an audit event entity with its normalized domain fields.
   *
   * @param eventType - Identifier describing the audited action or event.
   * @param actorId - Identifier of the actor that triggered the event, or null for system activity.
   * @param correlationId - Correlation identifier used to trace the event across operations.
   * @param decision - Authorization or policy decision associated with the event, when applicable.
   * @param payload - Additional structured audit metadata.
   * @param occurredAt - Timestamp at which the audited event occurred.
   */
  private constructor(
    readonly eventType: string,
    readonly actorId: string | null,
    readonly correlationId: string,
    readonly decision: AuditDecision | null,
    readonly payload: Record<string, unknown>,
    readonly occurredAt: Date,
  ) {}

  /**
   * Creates a new audit event from application input and assigns a generated entity ID.
   *
   * @param input - Audit event data supplied by the caller.
   * @param occurredAt - Optional occurrence timestamp; defaults to the current time.
   * @returns A newly created audit event entity.
   */
  static create(
    input: AuditEventInput,
    occurredAt: Date = new Date(),
  ): AuditEventEntity {
    return new AuditEventEntity(
      input.eventType,
      input.actorId,
      input.correlationId,
      input.decision,
      input.payload ?? {},
      occurredAt,
    );
  }

  /**
   * Rehydrates an audit event entity from fields loaded from persistence.
   *
   * @param fields - Persisted audit event fields, including the original entity ID.
   * @returns An audit event entity whose ID matches the persisted record.
   */
  static fromPersistence(fields: AuditEventProps): AuditEventEntity {
    const entity = new AuditEventEntity(
      fields.eventType,
      fields.actorId,
      fields.correlationId,
      fields.decision,
      fields.payload,
      fields.occurredAt,
    );
    Object.assign(entity, { id: fields.id });
    return entity;
  }
}

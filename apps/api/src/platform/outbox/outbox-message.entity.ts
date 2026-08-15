import { randomUUID } from "node:crypto";

import {
  type OutboxAggregateType,
  OUTBOX_STATUSES,
  type OutboxMessageInput,
  type OutboxStatus,
} from "@lcsp/contracts/outbox";

/**
 * Represents an outbox message and its delivery state across creation and persistence rehydration.
 */
export class OutboxMessageEntity {
  readonly id: string;
  readonly aggregateType: OutboxAggregateType;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly lastAttemptAt: Date | null;
  readonly publishedAt: Date | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;

  /**
   * Creates an outbox entity from normalized delivery fields.
   *
   * @param fields - Aggregate identity, event payload, delivery state, retry metadata, and creation time.
   */
  private constructor(fields: {
    aggregateType: OutboxAggregateType;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    status: OutboxStatus;
    attempts: number;
    lastAttemptAt: Date | null;
    publishedAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
  }) {
    this.id = randomUUID();
    this.aggregateType = fields.aggregateType;
    this.aggregateId = fields.aggregateId;
    this.eventType = fields.eventType;
    this.payload = fields.payload;
    this.status = fields.status;
    this.attempts = fields.attempts;
    this.lastAttemptAt = fields.lastAttemptAt;
    this.publishedAt = fields.publishedAt;
    this.errorMessage = fields.errorMessage;
    this.createdAt = fields.createdAt;
  }

  /**
   * Creates a new pending outbox message with no prior delivery attempts.
   *
   * @param input - Aggregate and event data to place in the transactional outbox.
   * @param createdAt - Optional creation timestamp; defaults to the current time.
   * @returns A new pending outbox message entity.
   */
  static create(
    input: OutboxMessageInput,
    createdAt: Date = new Date(),
  ): OutboxMessageEntity {
    return new OutboxMessageEntity({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      status: OUTBOX_STATUSES.pending,
      attempts: 0,
      lastAttemptAt: null,
      publishedAt: null,
      errorMessage: null,
      createdAt,
    });
  }

  /**
   * Rehydrates an outbox entity from a previously persisted database record.
   *
   * @param fields - Persisted outbox fields including the original message identifier.
   * @returns An outbox entity whose ID and delivery state match the persisted record.
   */
  static fromPersistence(fields: {
    id: string;
    aggregateType: OutboxAggregateType;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    status: OutboxStatus;
    attempts: number;
    lastAttemptAt: Date | null;
    publishedAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
  }): OutboxMessageEntity {
    const entity = new OutboxMessageEntity(fields);
    Object.assign(entity, { id: fields.id });
    return entity;
  }
}

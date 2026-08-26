import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/outbox";
import {
  SCAN_ERROR_CODES,
  TARGETED_REANALYSIS_CAPACITY_POLICY,
} from "@lcsp/contracts/scan";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditWriterService } from "../audit/audit-writer.service.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { OutboxRepository } from "./outbox.repository.js";
import type { RabbitMqMessageHeaders } from "./rabbitmq.client.js";
import { RabbitMqClient } from "./rabbitmq.client.js";
import { SnapshotCreatedAutoScanService } from "./snapshot-created-auto-scan.service.js";

/**
 * Polls transactional outbox messages, publishes them to RabbitMQ, and records retry or DLQ outcomes.
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  /**
   * Creates the publisher with outbox persistence, messaging, configuration, auditing, and local event handlers.
   *
   * @param outboxRepository - Repository used to lock, update, and retry outbox messages.
   * @param rabbitMqClient - RabbitMQ client used to publish event payloads.
   * @param configService - Runtime configuration source for polling and messaging settings.
   * @param auditWriter - Audit writer used to record retry and DLQ transitions.
   * @param snapshotCreatedAutoScanService - Local handler that triggers trusted scans for snapshot-created events.
   */
  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly rabbitMqClient: RabbitMqClient,
    private readonly configService: ConfigService,
    private readonly auditWriter: AuditWriterService,
    private readonly snapshotCreatedAutoScanService: SnapshotCreatedAutoScanService,
  ) {}

  /**
   * Starts the periodic outbox poller when publishing is enabled by configuration.
   */
  onModuleInit(): void {
    const enabled = this.configService.get<boolean>("outbox.enabled", true);
    if (!enabled) {
      this.logger.log("Outbox publisher disabled by configuration.");
      return;
    }

    const pollIntervalMs = this.configService.get<number>(
      "outbox.pollIntervalMs",
      1000,
    );

    this.timer = setInterval(() => {
      void this.poll();
    }, pollIntervalMs);
  }

  /**
   * Stops the periodic outbox poller during module shutdown.
   */
  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Publishes one locked batch of eligible outbox messages and records delivery failures for retry or DLQ handling.
   *
   * @returns A promise that resolves after the current polling attempt finishes or is skipped.
   */
  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;

    const batchSize = this.configService.get<number>("outbox.batchSize", 50);
    const maxAttempts = this.configService.get<number>("outbox.maxAttempts", 5);
    const exchange = this.configService.get<string>(
      "rabbitmq.exchange",
      "lcsp.events",
    );

    const failures: Array<{
      message: OutboxMessageEntity;
      attempts: number;
      maxAttempts: number;
      reason: string;
      nextAttemptAt: Date | null;
    }> = [];

    try {
      await this.rabbitMqClient.ensureConnected();
      await this.outboxRepository.withPendingBatch(
        batchSize,
        async (messages, tx) => {
          for (const message of messages) {
            const now = new Date();

            if (
              message.aggregateType ===
                OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest &&
              !(await this.outboxRepository.reserveTargetedReanalysisDispatch(
                tx,
                message.aggregateId,
              ))
            ) {
              continue;
            }

            try {
              await this.snapshotCreatedAutoScanService.handle(message);
              const headers = contextHeaders(message.payload);
              if (headers) {
                await this.rabbitMqClient.publish(
                  exchange,
                  message.eventType,
                  message.payload,
                  headers,
                );
              } else {
                await this.rabbitMqClient.publish(
                  exchange,
                  message.eventType,
                  message.payload,
                );
              }
              await this.outboxRepository.markPublished(tx, message.id, now);
            } catch (error) {
              const nextAttempts = message.attempts + 1;
              const reason = (error as Error).message;
              const messageMaxAttempts = maxAttemptsFor(message, maxAttempts);
              const nextAttemptAt =
                nextAttempts >= messageMaxAttempts
                  ? null
                  : retryAt(now, nextAttempts);

              await this.outboxRepository.markFailure(
                tx,
                message.id,
                nextAttempts,
                messageMaxAttempts,
                reason,
                now,
                nextAttemptAt,
              );
              if (
                message.aggregateType ===
                OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest
              ) {
                await this.outboxRepository.recordTargetedReanalysisPublishFailure(
                  tx,
                  message.aggregateId,
                  nextAttempts,
                  nextAttempts >= messageMaxAttempts
                    ? SCAN_ERROR_CODES.targetedReanalysisOutboxDeliveryExhausted
                    : null,
                );
              }
              failures.push({
                message,
                attempts: nextAttempts,
                maxAttempts: messageMaxAttempts,
                reason,
                nextAttemptAt,
              });
              this.logger.error(
                `Outbox message ${message.id} publish failed (attempt ${nextAttempts}/${maxAttempts}): ${reason}`,
              );
            }
          }
        },
      );
      await Promise.all(failures.map((failure) => this.auditFailure(failure)));
    } catch (error) {
      this.logger.error(
        `Outbox poll batch failed: ${(error as Error).message}`,
      );
    } finally {
      this.polling = false;
    }
  }

  /**
   * Writes an audit event describing a scheduled retry or transition into the outbox DLQ.
   *
   * @param failure - Failed message plus retry count, limit, reason, and next-attempt timestamp.
   * @returns A promise that resolves after the audit record is persisted.
   */
  private async auditFailure(failure: {
    message: {
      id: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    };
    attempts: number;
    maxAttempts: number;
    reason: string;
    nextAttemptAt: Date | null;
  }): Promise<void> {
    const payload = failure.message.payload;
    const assessmentId = readString(payload.assessmentId);
    const correlationId =
      readString(payload.correlationId) ?? `outbox:${failure.message.id}`;
    const actor = readActor(payload.actor);
    const isDlq = failure.attempts >= failure.maxAttempts;

    await this.auditWriter.write({
      eventType: isDlq
        ? OUTBOX_AUDIT_EVENT_TYPES.dlqEntered
        : OUTBOX_AUDIT_EVENT_TYPES.retryScheduled,
      actorId: actor?.id ?? null,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.outbox,
      resourceId: failure.message.id,
      correlationId,
      reasonCode: safeReasonCode(failure.reason),
      decision: AUDIT_DECISIONS.allow,
      result: isDlq
        ? OUTBOX_AUDIT_EVENT_TYPES.dlqEntered
        : OUTBOX_AUDIT_EVENT_TYPES.retryScheduled,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      actor: actor ?? {
        id: "outbox-publisher",
        type: AUDIT_ACTOR_TYPES.service,
      },
      payload: {
        aggregateId: failure.message.aggregateId,
        attempts: failure.attempts,
        maxAttempts: failure.maxAttempts,
        ...(failure.nextAttemptAt
          ? { nextRetryAt: failure.nextAttemptAt.toISOString() }
          : { operatorRecoveryAction: "REPLAY_DLQ_AFTER_RECOVERY" }),
      },
    });
  }
}

/**
 * Resolves the maximum delivery attempts for an outbox message, including targeted-reanalysis policy overrides.
 *
 * @param message - Outbox message whose aggregate type determines retry policy.
 * @param defaultMaxAttempts - General configured retry limit.
 * @returns Maximum attempts allowed for the message.
 */
function maxAttemptsFor(
  message: OutboxMessageEntity,
  defaultMaxAttempts: number,
): number {
  if (
    message.aggregateType === OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest
  ) {
    return TARGETED_REANALYSIS_CAPACITY_POLICY.apiOutboxMaxAttempts;
  }
  return defaultMaxAttempts;
}

/**
 * Calculates the next retry time using capped exponential backoff and a small random jitter.
 *
 * @param now - Timestamp from which the retry delay should be calculated.
 * @param attempts - Number of delivery attempts already made after the current failure.
 * @returns Timestamp for the next retry.
 */
function retryAt(now: Date, attempts: number): Date {
  const baseDelayMs = Math.min(30_000, 1_000 * 2 ** (attempts - 1));
  const jitterMs = Math.floor(Math.random() * 250);
  return new Date(now.getTime() + baseDelayMs + jitterMs);
}

/**
 * Extracts actor and correlation context from an outbox payload for RabbitMQ headers.
 *
 * @param payload - Event payload that may contain actor and correlation context.
 * @returns RabbitMQ headers when all required context fields are present; otherwise undefined.
 */
function contextHeaders(
  payload: Record<string, unknown>,
): RabbitMqMessageHeaders | undefined {
  const actor = payload.actor;
  const actorId =
    actor && typeof actor === "object"
      ? readString((actor as Record<string, unknown>).id)
      : undefined;
  const correlationId = readString(payload.correlationId);

  if (!actorId || !correlationId) {
    return undefined;
  }

  return {
    user_id: actorId,
    "x-correlation-id": correlationId,
  };
}

/**
 * Reads a non-empty string from an unknown payload value.
 *
 * @param value - Unknown value to validate.
 * @returns The string value when non-empty; otherwise undefined.
 */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Validates and normalizes an audit actor embedded in an outbox payload.
 *
 * @param value - Unknown actor payload to inspect.
 * @returns A validated user or service actor, or undefined when invalid.
 */
function readActor(
  value: unknown,
): { id: string; type: "USER" | "SERVICE" } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const actor = value as Record<string, unknown>;
  const id = readString(actor.id);
  const type = actor.type;
  if (
    !id ||
    (type !== AUDIT_ACTOR_TYPES.user && type !== AUDIT_ACTOR_TYPES.service)
  ) {
    return undefined;
  }
  return { id, type };
}

/**
 * Converts an arbitrary publication error message into a bounded audit-safe reason code.
 *
 * @param reason - Raw delivery failure reason.
 * @returns Upper/lowercase alphanumeric-and-underscore reason code limited to 120 characters.
 */
function safeReasonCode(reason: string): string {
  return (
    reason.replace(/[^A-Z0-9_]/gi, "_").slice(0, 120) || "OUTBOX_PUBLISH_FAILED"
  );
}

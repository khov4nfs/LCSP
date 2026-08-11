import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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

import { AuditWriterService } from "../audit/audit-writer.service.js";
import { OutboxRepository } from "./outbox.repository.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { RabbitMqClient } from "./rabbitmq.client.js";
import type { RabbitMqMessageHeaders } from "./rabbitmq.client.js";

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly rabbitMqClient: RabbitMqClient,
    private readonly configService: ConfigService,
    private readonly auditWriter: AuditWriterService,
  ) {}

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

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;

    try {
      await this.rabbitMqClient.ensureConnected();
    } catch (error) {
      this.logger.error(
        `Outbox poll skipped — RabbitMQ unavailable: ${(error as Error).message}`,
      );
      this.polling = false;
      return;
    }

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
              const headers = authorizationHeaders(message.payload);
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
    const organizationId = readString(payload.organizationId);
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
      organizationId: organizationId ?? null,
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

function retryAt(now: Date, attempts: number): Date {
  const baseDelayMs = Math.min(30_000, 1_000 * 2 ** (attempts - 1));
  const jitterMs = Math.floor(Math.random() * 250);
  return new Date(now.getTime() + baseDelayMs + jitterMs);
}

function authorizationHeaders(
  payload: Record<string, unknown>,
): RabbitMqMessageHeaders | undefined {
  const actor = payload.actor;
  const actorId =
    actor && typeof actor === "object"
      ? readString((actor as Record<string, unknown>).id)
      : undefined;
  const organizationId = readString(payload.organizationId);
  const action = readString(payload.authorizationAction);
  const correlationId = readString(payload.correlationId);

  if (!actorId || !organizationId || !action || !correlationId) {
    return undefined;
  }

  return {
    user_id: actorId,
    organization_id: organizationId,
    action,
    "x-correlation-id": correlationId,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

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

function safeReasonCode(reason: string): string {
  return (
    reason.replace(/[^A-Z0-9_]/gi, "_").slice(0, 120) || "OUTBOX_PUBLISH_FAILED"
  );
}

import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  type AuditActorType,
  type AuditDecision,
  type AuditResourceType,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  RBAC_AUDIT_EVENT_TYPES,
  RBAC_OUTBOX_EVENT_TYPES,
  RBAC_REASON_CODES,
} from "@lcsp/contracts/rbac";
import { OUTBOX_AUDIT_EVENT_TYPES } from "@lcsp/contracts/outbox";
import {
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import { AuditWriterService } from "../audit/audit-writer.service.js";
import { authorizationDecisionKey } from "../rbac/authorization-decision-key.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { OutboxRepository } from "./outbox.repository.js";
import type { RabbitMqMessageHeaders } from "./rabbitmq.client.js";
import { RabbitMqClient } from "./rabbitmq.client.js";

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
   */
  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly rabbitMqClient: RabbitMqClient,
    private readonly configService: ConfigService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Starts the periodic outbox poller (always on).
   */
  onModuleInit(): void {
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
   * Business purpose: Deliver pending integration events and restore durable authorization-audit fallbacks.
   * Business rules:
   * - Local audit recovery does not depend on RabbitMQ availability, while broker messages retain normal delivery semantics.
   * - Only one poll may run per provider instance, and failed deliveries follow the configured bounded retry/DLQ policy.
   * Execution flow:
   * 1. Lock one eligible batch and separate local audit recovery rows from broker-bound rows.
   * 2. Restore local canonical audits transactionally, then publish ordinary messages when RabbitMQ is available.
   * 3. Mark successful rows published and persist bounded failure state for retry or DLQ handling.
   * Failure cases:
   * - A local recovery failure remains pending through retry state; a broker outage leaves broker rows untouched for a later poll.
   * - A batch persistence failure rolls back the locked transaction and emits a bounded operational log.
   * Side effects:
   * - Writes AuditEvent and outbox delivery state, publishes broker messages, and emits retry audit telemetry.
   */
  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;

    const batchSize = this.configService.get<number>("outbox.batchSize", 50);
    const maxAttempts = this.configService.get<number>("outbox.maxAttempts", 5);
    const brokerConnectTimeoutMs = this.configService.get<number>(
      "outbox.brokerConnectTimeoutMs",
      5_000,
    );
    const brokerPublishTimeoutMs = this.configService.get<number>(
      "outbox.brokerPublishTimeoutMs",
      5_000,
    );
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
      // Local recovery gets its own transaction and event-type-filtered batch.
      // It therefore commits before any potentially slow broker connection and
      // cannot starve behind an older RabbitMQ backlog.
      await this.outboxRepository.withPendingBatchByEventType(
        RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
        batchSize,
        async (messages, tx) => {
          for (const message of messages) {
            const now = new Date();
            try {
              await this.recoverAuthorizationAudit(message, tx);
              await this.outboxRepository.markPublished(tx, message.id, now);
            } catch (error) {
              await this.recordDeliveryFailure({
                error,
                message,
                maxAttempts,
                now,
                failures,
                tx,
              });
            }
          }
        },
      );

      await this.outboxRepository.withPendingBatch(
        batchSize,
        async (messages, tx) => {
          if (messages.length > 0) {
            try {
              await withDeadline(
                this.rabbitMqClient.ensureConnected(),
                brokerConnectTimeoutMs,
              );
            } catch (error) {
              // Leave broker-bound rows pending. A global broker outage must
              // not burn retry attempts or roll back local audit recovery.
              this.logger.error(
                `Outbox broker unavailable before publish batch failure=${error instanceof Error ? error.name : typeof error}`,
              );
              return;
            }
          }

          for (const message of messages) {
            const now = new Date();

            try {
              const payload = message.payload;
              const headers = contextHeaders(payload);
              if (headers) {
                await withDeadline(
                  this.rabbitMqClient.publish(
                    exchange,
                    message.eventType,
                    payload,
                    headers,
                  ),
                  brokerPublishTimeoutMs,
                );
              } else {
                await withDeadline(
                  this.rabbitMqClient.publish(
                    exchange,
                    message.eventType,
                    payload,
                  ),
                  brokerPublishTimeoutMs,
                );
              }
              await this.outboxRepository.markPublished(tx, message.id, now);
            } catch (error) {
              await this.recordDeliveryFailure({
                error,
                message,
                maxAttempts,
                now,
                failures,
                tx,
              });
            }
          }
        },
      );
      await Promise.all(failures.map((failure) => this.auditFailure(failure)));
    } catch (error) {
      this.logger.error(
        `Outbox poll batch failed error_type=${error instanceof Error ? error.name : typeof error}`,
      );
    } finally {
      this.polling = false;
    }
  }

  /**
   * Business purpose: Restore one durable authorization fallback into the canonical AuditEvent store.
   * Business rules:
   * - Only the dedicated local fallback event is accepted; all required decision fields are validated before persistence.
   * Execution flow:
   * 1. Parse the sanitized decision envelope from the outbox payload.
   * 2. Write the canonical AuditEvent using the transaction that owns the outbox row.
   * Failure cases:
   * - Malformed payload or audit persistence failure propagates into normal outbox retry/DLQ handling.
   * Side effects:
   * - Inserts one AuditEvent; the caller marks the fallback row published in the same transaction.
   */
  private async recoverAuthorizationAudit(
    message: OutboxMessageEntity,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const decision = authorizationDecisionFromFallback(message.payload);
    await this.auditWriter.writeInTx(
      {
        idempotencyKey: decision.idempotencyKey,
        eventType: RBAC_AUDIT_EVENT_TYPES.authorizationDecision,
        actorId: decision.actorId,
        resourceType: decision.resourceType,
        resourceId: decision.resourceId,
        reasonCode: decision.reasonCode,
        correlationId: decision.correlationId,
        result: decision.decision,
        redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
        actor: {
          id: decision.actorId,
          type: decision.actorId
            ? AUDIT_ACTOR_TYPES.user
            : AUDIT_ACTOR_TYPES.system,
        },
        sessionId: decision.sessionId,
        decision: decision.decision,
        payload: {
          recoverySource: "AUTHORIZATION_AUDIT_OUTBOX",
          fallbackMessageId: message.id,
        },
      },
      tx,
    );
  }

  /**
   * Business purpose: Apply the existing bounded retry/DLQ policy to a failed broker or local recovery delivery.
   * Business rules:
   * - Attempts increment exactly once; reaching the configured limit enters DLQ and diagnostics remain bounded.
   * Execution flow:
   * 1. Classify the error, calculate the next retry time, and persist the resulting failure state.
   * 2. Queue a sanitized receipt for post-transaction retry or DLQ audit telemetry.
   * Failure cases:
   * - Failure-state persistence errors propagate and roll back the locked batch.
   * Side effects:
   * - Updates one outbox row and appends one in-memory post-transaction failure receipt.
   */
  private async recordDeliveryFailure(input: {
    error: unknown;
    message: OutboxMessageEntity;
    maxAttempts: number;
    now: Date;
    failures: Array<{
      message: OutboxMessageEntity;
      attempts: number;
      maxAttempts: number;
      reason: string;
      nextAttemptAt: Date | null;
    }>;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    const nextAttempts = input.message.attempts + 1;
    const failureDetails = describeOutboxError(input.error);
    // Authorization recovery can fail with database/provider details. Persist
    // only a stable operational reason so the durable outbox never becomes a
    // secondary store for raw infrastructure error text.
    const persistedReason =
      input.message.eventType ===
      RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback
        ? "AUTHORIZATION_AUDIT_RECOVERY_FAILED"
        : failureDetails.message;
    const nextAttemptAt =
      nextAttempts >= input.maxAttempts
        ? null
        : retryAt(input.now, nextAttempts);
    await this.outboxRepository.markFailure(
      input.tx,
      input.message.id,
      nextAttempts,
      input.maxAttempts,
      persistedReason,
      input.now,
      nextAttemptAt,
    );
    input.failures.push({
      message: input.message,
      attempts: nextAttempts,
      maxAttempts: input.maxAttempts,
      reason: persistedReason,
      nextAttemptAt,
    });
    this.logger.error(
      `Outbox message ${input.message.id} delivery failed (attempt ${nextAttempts}/${input.maxAttempts}) error_type=${failureDetails.type} error_code=${failureDetails.code ?? "UNKNOWN"}`,
    );
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
 * Business purpose: Bound broker admission so local audit recovery continues on later poll cycles.
 * Business rules:
 * - A broker promise may not hold the publisher latch beyond the configured positive deadline.
 * Execution flow:
 * 1. Race broker connection against a timer and clear the timer when either branch settles.
 * Failure cases:
 * - Deadline expiry rejects with a bounded operational error; the caller leaves broker rows pending.
 * Side effects:
 * - Allocates and clears one in-process timer without cancelling the underlying client promise.
 */
async function withDeadline(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const boundedTimeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("RabbitMQ connection deadline exceeded")),
          boundedTimeout,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Extracts non-sensitive exception metadata for outbox failure logs. Payloads are
 * intentionally excluded so operators can diagnose exception class and problem
 * code without leaking event data.
 *
 * @param error - Unknown caught publication/local-handler error.
 * @returns Bounded error message, exception type, and optional problem code.
 */
function describeOutboxError(error: unknown): {
  message: string;
  type: string;
  code?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const type =
    error instanceof Error && error.constructor.name
      ? error.constructor.name
      : typeof error;

  if (error instanceof HttpException) {
    const response = error.getResponse();
    const code = readProblemCode(response);
    return code ? { message, type, code } : { message, type };
  }

  return { message, type };
}

/**
 * Reads a standard API problem code from an unknown Nest exception response.
 *
 * @param response - Value returned by HttpException.getResponse().
 * @returns Stable problem code when present.
 */
function readProblemCode(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const problem = (response as Record<string, unknown>).problem;
  if (!problem || typeof problem !== "object") {
    return undefined;
  }
  return readString((problem as Record<string, unknown>).code);
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
 * Business purpose: Reconstruct a canonical RBAC decision from a durable local recovery envelope.
 * Business rules:
 * - Only known audit resource and decision values with non-empty identity and correlation fields are accepted.
 * Execution flow:
 * 1. Read nullable actor/session identity and required authorization fields from the sanitized payload.
 * 2. Validate canonical value sets, then return the typed decision accepted by AuditWriterService.
 * Failure cases:
 * - Missing or unknown fields reject the recovery so the outbox retry/DLQ policy retains evidence.
 * Side effects:
 * - None; this function validates and projects an in-memory payload only.
 */
function authorizationDecisionFromFallback(payload: Record<string, unknown>): {
  actorId: string | null;
  sessionId: string | null;
  resourceType: AuditResourceType;
  resourceId: string;
  decision: AuditDecision;
  reasonCode: string;
  correlationId: string;
  idempotencyKey: string;
} {
  const actorId = readString(payload.actor_id) ?? null;
  const sessionId = readString(payload.session_id) ?? null;
  const resourceType = readString(payload.resource_type);
  const resourceId = readString(payload.resource_id);
  const decision = readString(payload.decision);
  const reasonCode = readString(payload.reason_code);
  const correlationId = readString(payload.correlationId);
  const idempotencyKey = readString(payload.idempotencyKey);
  const decisionOccurrenceId = readString(payload.decision_occurrence_id);
  const allowedReasonCodes = new Set<string>([
    ...Object.values(AUTH_ERROR_CODES),
    ...Object.values(RBAC_REASON_CODES),
  ]);
  if (
    !resourceType ||
    !Object.values(AUDIT_RESOURCE_TYPES).includes(
      resourceType as AuditResourceType,
    ) ||
    !resourceId ||
    !decision ||
    !Object.values(AUDIT_DECISIONS).includes(decision as AuditDecision) ||
    !reasonCode ||
    !allowedReasonCodes.has(reasonCode) ||
    !correlationId ||
    !idempotencyKey ||
    !decisionOccurrenceId
  ) {
    throw new Error("Authorization audit fallback payload is invalid");
  }
  const canonicalKey = authorizationDecisionKey(
    {
      actor_id: actorId,
      session_id: sessionId,
      resource_type: resourceType as AuditResourceType,
      resource_id: resourceId,
      decision: decision as AuditDecision,
      reason_code: reasonCode as
        | (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES]
        | (typeof RBAC_REASON_CODES)[keyof typeof RBAC_REASON_CODES],
      correlationId,
    },
    decisionOccurrenceId,
  );
  if (idempotencyKey !== canonicalKey) {
    throw new Error("Authorization audit fallback identity is invalid");
  }
  return {
    actorId,
    sessionId,
    resourceType: resourceType as AuditResourceType,
    resourceId,
    decision: decision as AuditDecision,
    reasonCode,
    correlationId,
    idempotencyKey: canonicalKey,
  };
}

/**
 * Validates and normalizes an audit actor embedded in an outbox payload.
 *
 * @param value - Unknown actor payload to inspect.
 * @returns A validated user or service actor, or undefined when invalid.
 */
function readActor(
  value: unknown,
): { id: string; type: AuditActorType } | undefined {
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

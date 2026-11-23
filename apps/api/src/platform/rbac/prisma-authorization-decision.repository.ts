import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  RBAC_AUDIT_EVENT_TYPES,
  RBAC_OUTBOX_EVENT_TYPES,
} from "@lcsp/contracts/rbac";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AuditWriterService } from "../audit/audit-writer.service.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import type {
  AuthorizationDecision,
  AuthorizationDecisionRepository,
} from "./authorization-decision.repository.js";
import { authorizationDecisionKey } from "./authorization-decision-key.js";

@Injectable()
export class PrismaAuthorizationDecisionRepository implements AuthorizationDecisionRepository {
  private readonly logger = new Logger(
    PrismaAuthorizationDecisionRepository.name,
  );
  private fallbackCount = 0;
  private degraded = false;

  constructor(
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Business purpose: Persist one RBAC decision without losing ordinary-read evidence during a primary audit outage.
   * Business rules:
   * - Canonical AuditEvent is primary; an idempotent local outbox row is the only accepted fallback.
   * - The stable identity covers the complete actor, session, resource, decision, reason and correlation tuple.
   * Execution flow:
   * 1. Build and persist the sanitized canonical AuditEvent under a deterministic retry identity.
   * 2. On primary failure, enqueue the same decision through the central outbox repository.
   * 3. Raise a bounded degraded metric/alert signal after fallback durability is confirmed.
   * Failure cases:
   * - Primary and fallback failure propagates the fallback error without logging private provider details.
   * Side effects:
   * - Inserts or replays one AuditEvent or OutboxMessage and updates process-local health telemetry.
   */
  async append(decision: AuthorizationDecision): Promise<void> {
    // Each authorization check is a distinct occurrence even when a workflow
    // legitimately reuses one correlation ID across repeated calls.
    const decisionOccurrenceId = randomUUID();
    const idempotencyKey = authorizationDecisionKey(
      decision,
      decisionOccurrenceId,
    );
    const event = buildAuditEventInput({
      idempotencyKey,
      eventType: RBAC_AUDIT_EVENT_TYPES.authorizationDecision,
      actorId: decision.actor_id ?? null,
      resourceType: decision.resource_type,
      resourceId: decision.resource_id,
      reasonCode: decision.reason_code,
      correlationId: decision.correlationId,
      result: decision.decision,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      actor: {
        id: decision.actor_id ?? null,
        type: decision.actor_id
          ? AUDIT_ACTOR_TYPES.user
          : AUDIT_ACTOR_TYPES.system,
      },
      sessionId: decision.session_id ?? null,
      decision: decision.decision,
      payload: {
        decision_occurrence_id: decisionOccurrenceId,
        authorizationResourceId: decision.resource_id,
        authorizationReasonCode: decision.reason_code,
      },
    });
    try {
      await this.auditWriter.write(event);
      return;
    } catch {
      // Central outbox persistence keeps status mapping, deterministic IDs and
      // delivery policies in one boundary rather than duplicating them here.
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.authUser,
          aggregateId:
            decision.actor_id ?? `anonymous:${decision.correlationId}`,
          eventType: RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
          correlationId: decision.correlationId,
          causationId: decision.correlationId,
          actor: event.actor ?? {
            id: null,
            type: AUDIT_ACTOR_TYPES.system,
          },
          result: decision.decision,
          redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
          idempotencyKey,
          payload: {
            ...decision,
            decision_occurrence_id: decisionOccurrenceId,
          },
        }),
      );
      this.fallbackCount += 1;
      this.degraded = true;
      // The deployment log pipeline treats this stable metric/alert tuple as
      // the operational degraded signal; durable evidence remains in outbox.
      this.logger.error(
        `AUTHORIZATION_AUDIT_DEGRADED metric=rbac.audit.write_failed fallback_count=${this.fallbackCount} alert=authorization_audit_degraded correlationId=${decision.correlationId}`,
      );
    }
  }

  /**
   * Business purpose: Expose the local metric and alert state for health/operations adapters.
   * Business rules: The counter is diagnostic only; durable decisions remain in AuditEvent or OutboxMessage.
   * Execution flow: Return an immutable snapshot of fallback count and degraded state.
   * Failure cases: None; the snapshot is always available while the provider is alive.
   * Side effects: None; read-only process telemetry.
   */
  healthSnapshot(): { fallbackCount: number; degraded: boolean } {
    return { fallbackCount: this.fallbackCount, degraded: this.degraded };
  }
}

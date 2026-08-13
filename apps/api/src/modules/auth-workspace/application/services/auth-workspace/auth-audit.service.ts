import type {
  AuditDecision,
  AuditEventInput,
  AuditResourceType,
} from "@lcsp/contracts/audit";
import {
  authAuditReadDecision,
  authAuditReadNullableString,
  authAuditReadRequiredString,
  isLegacyAuthAuditEvent,
  normalizeLegacyAuthAuditEventType,
  type AuthAuditEventType,
} from "@lcsp/contracts/auth";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { AuditSanitizer } from "../../../../../platform/audit/audit-sanitizer.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { AuditEvent } from "../../../domain/models/auth-workspace.models.ts";

export type AuthAuditEventInput = {
  eventType: AuthAuditEventType;
  actorId: string | null;
  organizationId: string | null;
  correlationId: string;
  decision: AuditDecision | null;
  resourceType?: AuditResourceType | null;
  resourceId?: string | null;
  reasonCode?: string | null;
  sessionId?: string | null;
  policyId?: string | null;
  policyVersion?: string | null;
  payload?: Record<string, unknown>;
};

type NormalizedAuthAuditEventInput = Omit<AuthAuditEventInput, "eventType"> & {
  eventType: string;
};

@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(private readonly auditWriter: AuditWriterService) {}

  async write(event: AuthAuditEventInput | AuditEvent): Promise<void> {
    try {
      await this.auditWriter.write(this.toAuditEventInput(event));
    } catch (error) {
      this.logger.error(
        `Failed to write auth audit event: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async writeInTx(
    event: AuthAuditEventInput | AuditEvent,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    try {
      await this.auditWriter.writeInTx(this.toAuditEventInput(event), tx);
    } catch (error) {
      this.logger.error(
        `Failed to write auth audit event in transaction: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private toAuditEventInput(
    event: AuthAuditEventInput | AuditEvent,
  ): AuditEventInput {
    const normalized: NormalizedAuthAuditEventInput = isLegacyAuthAuditEvent(
      event,
    )
      ? this.fromLegacyAuditEvent(event)
      : event;
    const { payload, removedKeys } = AuditSanitizer.sanitize(
      normalized.payload,
    );

    for (const key of removedKeys) {
      this.logger.warn(`Auth audit payload field removed by sanitizer: ${key}`);
    }

    return {
      eventType: normalized.eventType,
      actorId: normalized.actorId,
      organizationId: normalized.organizationId,
      resourceType: normalized.resourceType ?? null,
      resourceId: normalized.resourceId ?? null,
      reasonCode: normalized.reasonCode ?? null,
      correlationId: normalized.correlationId,
      sessionId: normalized.sessionId ?? null,
      policyId: normalized.policyId ?? null,
      policyVersion: normalized.policyVersion ?? null,
      decision: normalized.decision,
      payload,
    };
  }

  private fromLegacyAuditEvent(
    event: AuditEvent,
  ): NormalizedAuthAuditEventInput {
    const eventType = authAuditReadRequiredString(event, "event_type");
    return {
      eventType: normalizeLegacyAuthAuditEventType(eventType),
      actorId: authAuditReadNullableString(event, "actor_id"),
      organizationId: authAuditReadNullableString(event, "organization_id"),
      resourceType: event.resource_type ?? null,
      resourceId: authAuditReadNullableString(event, "resource_id"),
      reasonCode: authAuditReadNullableString(event, "reason_code"),
      correlationId: authAuditReadRequiredString(event, "correlationId"),
      sessionId: authAuditReadNullableString(event, "session_id"),
      policyId: authAuditReadNullableString(event, "policy_id"),
      policyVersion: authAuditReadNullableString(event, "policy_version"),
      decision: authAuditReadDecision(event, "decision"),
      payload: { ...event },
    };
  }
}

import * as crypto from "node:crypto";
import {
  authAuditReadDecision,
  authAuditReadNullableString,
  authAuditReadString,
  normalizeLegacyAuthAuditEventType,
} from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toPrismaAuthDecision } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuditEventRepository } from "../../application/ports/persistence/audit-event.repository.ts";
import type { AuditEvent } from "../../domain/models/auth.models.ts";

@Injectable()
export class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: AuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({ data: normalizeAuditEvent(event) });
  }
}

function normalizeAuditEvent(
  event: AuditEvent,
): Prisma.AuditEventUncheckedCreateInput {
  const payload = event as Prisma.InputJsonValue;
  const rawEventType = authAuditReadString(event, "event_type");
  return {
    id: crypto.randomUUID(),
    eventType: normalizeLegacyAuthAuditEventType(rawEventType),
    actorId: authAuditReadNullableString(event, "actor_id"),
    decision: mapNullableAuthDecision(authAuditReadDecision(event, "decision")),
    reasonCode: authAuditReadNullableString(event, "reason_code"),
    correlationId: authAuditReadString(event, "correlationId"),
    sessionId: authAuditReadNullableString(event, "session_id"),
    payload,
  };
}

function mapNullableAuthDecision(
  decision: ReturnType<typeof authAuditReadDecision>,
) {
  return decision ? toPrismaAuthDecision(decision) : null;
}

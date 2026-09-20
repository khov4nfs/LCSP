import crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
} from "../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type {
  AuthorizationDecision,
  AuthorizationDecisionRepository,
} from "./authorization-decision.repository.js";

@Injectable()
export class PrismaAuthorizationDecisionRepository implements AuthorizationDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(decision: AuthorizationDecision): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        eventType: "AUTHORIZATION_DECISION",
        actorId: decision.actor_id ?? null,
        sessionId: decision.session_id ?? null,
        resourceType: toPrismaAuditResourceType(decision.resource_type),
        resourceId: decision.resource_id,
        decision: toPrismaAuthDecision(decision.decision),
        reasonCode: decision.reason_code,
        correlationId: decision.correlationId,
        payload: decision,
      },
    });
  }
}

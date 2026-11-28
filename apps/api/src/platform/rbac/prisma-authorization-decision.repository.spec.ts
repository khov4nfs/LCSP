import { jest } from "@jest/globals";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { RBAC_DECISIONS, RBAC_REASON_CODES } from "@lcsp/contracts/rbac";

import type { AuditWriterService } from "../audit/audit-writer.service.js";
import type { OutboxRepository } from "../outbox/outbox.repository.js";
import { PrismaAuthorizationDecisionRepository } from "./prisma-authorization-decision.repository.js";

const decision = {
  actor_id: "user-1",
  session_id: "session-1",
  resource_type: AUDIT_RESOURCE_TYPES.httpRoute,
  resource_id: "GET /assessments/assessment-1",
  decision: RBAC_DECISIONS.allow,
  reason_code: RBAC_REASON_CODES.authorized,
  correlationId: "corr-rbac-fallback",
} as const;

describe("PrismaAuthorizationDecisionRepository", () => {
  it("[RED][ASM-RBAC-01] persists an idempotent fallback and exposes degraded telemetry when primary audit fails", async () => {
    const write = jest
      .fn<AuditWriterService["write"]>()
      .mockRejectedValue(new Error("primary unavailable"));
    const enqueue = jest
      .fn<OutboxRepository["enqueue"]>()
      .mockResolvedValue("fallback-1");
    const repository = new PrismaAuthorizationDecisionRepository(
      { write } as unknown as AuditWriterService,
      { enqueue } as unknown as OutboxRepository,
    );

    await expect(repository.append(decision)).resolves.toBeUndefined();
    const persistedFallback = enqueue.mock.calls[0]?.[0];
    expect(persistedFallback?.eventType).toBe(
      "event.authorization.decision-audit-fallback.v1",
    );
    expect(persistedFallback?.payload.correlationId).toBe(
      decision.correlationId,
    );
    expect(write.mock.calls[0]?.[0].idempotencyKey).toBe(
      persistedFallback?.payload.idempotencyKey,
    );
    const health = (
      repository as unknown as {
        healthSnapshot(): { fallbackCount: number; degraded: boolean };
      }
    ).healthSnapshot();
    expect(health).toEqual({ fallbackCount: 1, degraded: true });
  });

  it("propagates failure when primary and durable fallback are both unavailable", async () => {
    const repository = new PrismaAuthorizationDecisionRepository(
      {
        write: jest
          .fn<AuditWriterService["write"]>()
          .mockRejectedValue(new Error("primary unavailable")),
      } as unknown as AuditWriterService,
      {
        enqueue: jest
          .fn<OutboxRepository["enqueue"]>()
          .mockRejectedValue(new Error("fallback unavailable")),
      } as unknown as OutboxRepository,
    );

    await expect(repository.append(decision)).rejects.toThrow(
      "fallback unavailable",
    );
  });

  it("records repeated authorization checks as distinct server-owned occurrences", async () => {
    const enqueue = jest
      .fn<OutboxRepository["enqueue"]>()
      .mockResolvedValue("fallback-1");
    const repository = new PrismaAuthorizationDecisionRepository(
      {
        write: jest
          .fn<AuditWriterService["write"]>()
          .mockRejectedValue(new Error("primary unavailable")),
      } as unknown as AuditWriterService,
      { enqueue } as unknown as OutboxRepository,
    );

    await repository.append(decision);
    await repository.append(decision);

    // Separate calls are separate audit occurrences even when the client
    // reuses one correlation ID; idempotency applies inside each call only.
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      enqueue.mock.calls[1]?.[0].idempotencyKey,
    );
  });

  it("uses distinct decision identities when actors reuse one correlation ID", async () => {
    const enqueue = jest
      .fn<OutboxRepository["enqueue"]>()
      .mockResolvedValue("fallback");
    const repository = new PrismaAuthorizationDecisionRepository(
      {
        write: jest
          .fn<AuditWriterService["write"]>()
          .mockRejectedValue(new Error("primary unavailable")),
      } as unknown as AuditWriterService,
      { enqueue } as unknown as OutboxRepository,
    );

    await repository.append(decision);
    await repository.append({ ...decision, actor_id: "user-2" });

    expect(enqueue.mock.calls[0]?.[0].idempotencyKey).not.toBe(
      enqueue.mock.calls[1]?.[0].idempotencyKey,
    );
  });
});

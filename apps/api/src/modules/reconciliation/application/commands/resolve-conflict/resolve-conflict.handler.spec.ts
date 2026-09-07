/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";
import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ResolveConflictCommand } from "./resolve-conflict.command.js";
import { ResolveConflictHandler } from "./resolve-conflict.handler.js";

describe("ResolveConflictHandler", () => {
  it("resolves a pending conflict and records audit data", async () => {
    const conflictRecord = {
      findFirst: (jest.fn() as any).mockResolvedValue({
        id: "conflict-1",
        assessmentId: "assessment-1",
        status: "PENDING",
      }),
      update: (jest.fn() as any).mockResolvedValue({}),
      count: (jest.fn() as any).mockResolvedValue(0),
    };
    const prisma = {
      conflictRecord,
      $transaction: jest.fn(
        (handler: (tx: { conflictRecord: typeof conflictRecord }) => unknown) =>
          Promise.resolve(handler({ conflictRecord })),
      ),
    } as unknown as jest.Mocked<PrismaService>;
    const auditWriter = {
      writeInTx: (jest.fn() as any).mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditWriterService>;
    const outboxRepository = {
      enqueue: (jest.fn() as any).mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxRepository>;
    const handler = new ResolveConflictHandler(
      prisma,
      auditWriter,
      outboxRepository,
    );

    const result = await handler.execute(
      new ResolveConflictCommand(
        "assessment-1",
        "conflict-1",
        "user-1",
        CONFLICT_RECORD_STATUSES.resolved,
        null,
        "corr-conflict-resolve",
      ),
    );

    expect(result).toEqual({
      conflict_id: "conflict-1",
      status: CONFLICT_RECORD_STATUSES.resolved,
      resolved_at: expect.any(String),
      all_conflicts_resolved: true,
      correlationId: "corr-conflict-resolve",
    });
    expect(conflictRecord.update).toHaveBeenCalledWith({
      where: { id: "conflict-1" },
      data: expect.objectContaining({
        resolvedById: "user-1",
        resolutionNote: null,
      }),
    });
    expect(auditWriter.writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        actorId: "user-1",
        resourceType: AUDIT_RESOURCE_TYPES.conflictRecord,
        resourceId: "conflict-1",
      }),
      expect.anything(),
    );
    expect(outboxRepository.enqueue).toHaveBeenCalled();
  });
});

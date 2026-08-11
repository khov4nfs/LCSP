import { describe, expect, it, jest } from "@jest/globals";
import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_STATUSES,
  CLASSIFICATION_RERUN_STATUSES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { RerunClassificationCommand } from "./rerun-classification.command.js";
import { RerunClassificationHandler } from "./rerun-classification.handler.js";

describe("RerunClassificationHandler", () => {
  const pbacContext = {
    userId: "user-1",
    sessionId: "session-1",
    organizationId: "org-1",
    subjectRole: SUBJECT_ROLES.manager,
    scope: "assessment-1",
    grantedActions: [PBAC_ACTIONS.classificationRun],
    selectedAction: PBAC_ACTIONS.classificationRun,
    policyId: "policy-1",
    policyVersion: "1",
  };

  function createHandler(options?: {
    result?: { id: string; status: string } | null;
  }) {
    const prisma = {
      legalRuleMatch: {
        findFirst: jest.fn().mockResolvedValue({
          id: "match-1",
          guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
          status: LEGAL_RULE_MATCH_STATUSES.accepted,
        }),
      },
      classificationResult: {
        findFirst: jest.fn().mockResolvedValue(options?.result ?? null),
      },
      $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) =>
        callback(prisma),
      ),
    } as unknown as jest.Mocked<PrismaService>;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const outbox = {
      enqueue,
    } as unknown as jest.Mocked<OutboxRepository>;
    const writeInTx = jest.fn().mockResolvedValue(undefined);
    const auditWriter = {
      writeInTx,
    } as unknown as jest.Mocked<AuditWriterService>;

    return {
      handler: new RerunClassificationHandler(prisma, outbox, auditWriter),
      enqueue,
      writeInTx,
      prisma,
    };
  }

  it("queues the accepted legal rule match for classification without rescanning evidence", async () => {
    const { handler, enqueue, writeInTx } = createHandler();

    const result = await handler.execute(
      new RerunClassificationCommand(
        "assessment-1",
        pbacContext,
        "correlation-1",
      ),
    );

    expect(result).toEqual({
      legal_rule_match_id: "match-1",
      status: CLASSIFICATION_RERUN_STATUSES.queued,
      correlation_id: "correlation-1",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "match-1",
        eventType: SCAN_EVENT_TYPES.legalRuleMatchReady,
      }),
      expect.anything(),
    );
    expect(writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
      }),
      expect.anything(),
    );
  });

  it("rejects a retry when no legal match exists", async () => {
    const { handler, prisma } = createHandler();
    (prisma.legalRuleMatch.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          pbacContext,
          "correlation-1",
        ),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects a retry after classification has been accepted", async () => {
    const { handler } = createHandler({
      result: { id: "result-1", status: LEGAL_RULE_MATCH_STATUSES.accepted },
    });

    await expect(
      handler.execute(
        new RerunClassificationCommand(
          "assessment-1",
          pbacContext,
          "correlation-1",
        ),
      ),
    ).rejects.toThrow(ConflictException);
  });
});

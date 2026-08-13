import { ConflictException } from "@nestjs/common";
import { describe, expect, it, jest } from "@jest/globals";
import {
  CONFLICT_RECORD_STATUSES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ReconcileProfileToVerifiedProfileCommand } from "./reconcile-profile-to-verified-profile.command.js";
import { ReconcileProfileToVerifiedProfileHandler } from "./reconcile-profile-to-verified-profile.handler.js";

function buildHandler(pending = false) {
  const create = jest
    .fn()
    .mockImplementation(() => Promise.resolve({ id: "verified-1" }));
  const writeInTx = jest.fn().mockImplementation(() => Promise.resolve());
  const enqueue = jest.fn().mockImplementation(() => Promise.resolve());
  const flow = {
    id: "flow-1",
    schemaVersion: "1.0.0",
    claims: [{ claim_id: "claim-1", evidence_refs: ["evidence:1"] }],
  };
  const tx = {
    wizardProfile: {
      findFirst: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ id: "wizard-1", version: 2, answers: {} }),
        ),
    },
    technicalEvidenceReport: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ id: "report-1" })),
    },
    aIUsageFlow: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(flow)),
    },
    verifiedProfile: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create,
    },
    technicalProfile: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ id: "technical-1" })),
    },
    conflictRecord: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            pending
              ? [{ id: "conflict-1", status: CONFLICT_RECORD_STATUSES.pending }]
              : [],
          ),
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as PrismaService;
  const handler = new ReconcileProfileToVerifiedProfileHandler(
    prisma,
    { writeInTx } as unknown as AuditWriterService,
    { enqueue } as unknown as OutboxRepository,
  );
  const command = new ReconcileProfileToVerifiedProfileCommand(
    {
      assessmentId: "assessment-1",
      wizardProfileId: "wizard-1",
      technicalEvidenceReportId: "report-1",
      aiUsageFlowId: "flow-1",
      reconciliationDecisionRefs: [],
      idempotencyKey: "idempotency-1",
    },
    "org-1",
    "corr-1",
  );
  return { handler, command, create, writeInTx, enqueue, tx };
}

describe("ReconcileProfileToVerifiedProfileHandler", () => {
  it("persists a pinned pending-approval profile with audit and outbox", async () => {
    const { handler, command, create, writeInTx, enqueue } = buildHandler();

    const result = await handler.execute(command);

    expect(result.result.lifecycleStatus).toBe(
      VERIFIED_PROFILE_STATUSES.pendingApproval,
    );
    expect(result.result.sourceArtifactRefs).toEqual([
      "wizard:wizard-1",
      "ter:report-1",
      "flow:flow-1",
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          wizardProfileId: "wizard-1",
          technicalEvidenceReportId: "report-1",
          idempotencyKey: "idempotency-1",
        }),
      }),
    );
    expect(writeInTx).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("does not persist when an open conflict remains", async () => {
    const { handler, command, create } = buildHandler(true);

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("replays the same pinned idempotency key without a second profile", async () => {
    const { handler, command, create, tx } = buildHandler();
    tx.verifiedProfile.findFirst.mockImplementation(() =>
      Promise.resolve({
        id: "verified-existing",
        aiUsageFlowId: "flow-1",
        wizardProfileId: "wizard-1",
        technicalEvidenceReportId: "report-1",
        reconciliationDecisionRefs: [],
      }),
    );

    const result = await handler.execute(command);

    expect(result.result.verifiedProfileId).toBe("verified-existing");
    expect(create).not.toHaveBeenCalled();
  });
});

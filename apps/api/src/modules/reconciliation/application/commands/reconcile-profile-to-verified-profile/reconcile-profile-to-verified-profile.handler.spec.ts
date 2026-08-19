import { describe, expect, it, jest } from "@jest/globals";
import {
  CONFLICT_RECORD_STATUSES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ReconcileProfileToVerifiedProfileCommand } from "./reconcile-profile-to-verified-profile.command.js";
import { ReconcileProfileToVerifiedProfileHandler } from "./reconcile-profile-to-verified-profile.handler.js";

function buildHandler(pending = false) {
  const create = jest
    .fn()
    .mockImplementation(() => Promise.resolve({ id: "verified-1" }));
  const update = jest
    .fn()
    .mockImplementation(() => Promise.resolve({ id: "verified-existing" }));
  const updateMany = jest
    .fn()
    .mockImplementation(() => Promise.resolve({ count: 1 }));
  const writeInTx = jest.fn().mockImplementation(() => Promise.resolve());
  const enqueue = jest.fn().mockImplementation(() => Promise.resolve());
  const flow: {
    id: string;
    schemaVersion: string;
    claims: Record<string, unknown>[];
  } = {
    id: "flow-1",
    schemaVersion: "1.0.0",
    claims: [{ claim_id: "claim-1", evidence_refs: ["evidence:1"] }],
  };
  const tx = {
    $executeRaw: jest.fn().mockImplementation(() => Promise.resolve(0)),
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([])),
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
      update,
      updateMany,
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
  return {
    handler,
    command,
    create,
    update,
    updateMany,
    writeInTx,
    enqueue,
    tx,
    flow,
  };
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
        assessmentId: "assessment-1",
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

  it("accepts domain claim keys that mention prompt references", async () => {
    const { handler, command, create, flow } = buildHandler();
    flow.claims = [
      {
        claim_id: "claim-prompt-reference",
        claim_value: { promptReferenceDetected: true },
        evidence_refs: ["evidence:prompt-reference"],
      },
    ];

    await handler.execute(command);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects raw prompt fields in AI usage flow claims", async () => {
    const { handler, command, create, flow } = buildHandler();
    flow.claims = [
      {
        claim_id: "claim-raw-prompt",
        prompt: "Summarize this personal data record",
        evidence_refs: ["evidence:prompt-reference"],
      },
    ];

    await expect(handler.execute(command)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a new version and marks the old profile STALE when rerun produces a new flow", async () => {
    const { handler, command, create, updateMany, writeInTx, enqueue, tx } =
      buildHandler();
    tx.verifiedProfile.findFirst
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockImplementationOnce(() =>
        Promise.resolve({
          id: "verified-existing",
          aiUsageFlowId: "flow-old",
          wizardProfileId: "wizard-old",
          technicalEvidenceReportId: "report-old",
          reconciliationDecisionRefs: [],
          version: 1,
        }),
      );

    const result = await handler.execute(command);

    // New row created with version 2
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiUsageFlowId: "flow-1",
          wizardProfileId: "wizard-1",
          technicalEvidenceReportId: "report-1",
          version: 2,
        }),
      }),
    );
    // Old row marked STALE (only status changed)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "verified-existing" }),
        data: expect.objectContaining({
          status: expect.anything(),
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    const updateCall = updateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).not.toHaveProperty("aiUsageFlowId");
    expect(updateCall.data).not.toHaveProperty("approvedAt");
    expect(updateCall.data).not.toHaveProperty("version");
    // Two audit events: one STALE, one PERSISTED
    expect(writeInTx).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(result.result.verifiedProfileId).not.toBe("verified-existing");
  });

  it("emits a STALE audit event with supersededBy when marking old profile stale", async () => {
    const { handler, command, writeInTx, tx } = buildHandler();
    tx.verifiedProfile.findFirst
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockImplementationOnce(() =>
        Promise.resolve({
          id: "verified-existing",
          aiUsageFlowId: "flow-old",
          wizardProfileId: "wizard-old",
          technicalEvidenceReportId: "report-old",
          reconciliationDecisionRefs: [],
          version: 1,
        }),
      );

    await handler.execute(command);

    const auditCalls = writeInTx.mock.calls as Array<
      [{ eventType: string; payload: Record<string, unknown> }]
    >;
    const staleCall = auditCalls.find(
      ([arg]) => arg.eventType === "VERIFIED_PROFILE_STALE",
    );
    expect(staleCall).toBeDefined();
    expect(staleCall![0].payload).toMatchObject({
      verifiedProfileId: "verified-existing",
      staleReason: "NEW_EVIDENCE_RERUN",
    });
    expect(staleCall![0].payload.supersededBy).toBeTruthy();
    const persistedCall = auditCalls.find(
      ([arg]) => arg.eventType === "VERIFIED_PROFILE_PERSISTED",
    );
    expect(persistedCall).toBeDefined();
    expect(persistedCall![0].payload).toMatchObject({
      supersededProfileId: "verified-existing",
      supersededProfileVersion: 1,
    });
  });
});

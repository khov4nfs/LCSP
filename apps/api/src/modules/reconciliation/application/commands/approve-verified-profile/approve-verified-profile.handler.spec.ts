import { describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ApproveVerifiedProfileCommand } from "./approve-verified-profile.command.js";
import { ApproveVerifiedProfileHandler } from "./approve-verified-profile.handler.js";

function command() {
  return new ApproveVerifiedProfileCommand(
    "assessment-1",
    "vp-1",
    "org-1",
    "manager-1",
    SUBJECT_ROLES.manager,
    "corr-1",
    {
      selectedAction: PBAC_ACTIONS.verifiedProfileApprove,
      policyId: "policy-manager-workspace",
      policyVersion: "2026-06-26",
    },
  );
}

function buildHandler(input?: { owned?: boolean }) {
  const owned = input?.owned ?? true;
  const findAssessment = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(owned ? { id: "assessment-1" } : null);
  const findProfile = jest
    .fn<
      () => Promise<{
        id: string;
        assessmentId: string;
        organizationId: string;
        status: string;
      }>
    >()
    .mockResolvedValue({
      id: "vp-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      status: VERIFIED_PROFILE_STATUSES.pendingApproval,
    });
  const countConflicts = jest.fn<() => Promise<number>>().mockResolvedValue(0);
  const updateProfile = jest.fn<() => Promise<object>>().mockResolvedValue({});
  const tx = {
    verifiedProfile: {
      findFirst: findProfile,
      update: updateProfile,
    },
    conflictRecord: { count: countConflicts },
  };
  const transaction = jest.fn(
    async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
  );
  const prisma = {
    assessment: { findFirst: findAssessment },
    $transaction: transaction,
  } as unknown as PrismaService;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write, writeInTx } as unknown as AuditWriterService;

  const enqueue = jest
    .fn<OutboxRepository["enqueue"]>()
    .mockResolvedValue(undefined);
  const outbox = { enqueue } as unknown as OutboxRepository;

  return {
    handler: new ApproveVerifiedProfileHandler(prisma, auditWriter, outbox),
    findAssessment,
    transaction,
    updateProfile,
    write,
    writeInTx,
    enqueue,
  };
}

describe("ApproveVerifiedProfileHandler", () => {
  it("requires the approving Manager to own the assessment", async () => {
    const { handler, findAssessment, transaction, write } = buildHandler({
      owned: false,
    });

    try {
      await handler.execute(command());
      throw new Error("Expected ownership rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(404);
      expect(exception.getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: ASSESSMENT_ERROR_CODES.notFound,
          correlationId: "corr-1",
        },
      });
    }

    expect(findAssessment).toHaveBeenCalledWith({
      where: {
        id: "assessment-1",
        organizationId: "org-1",
        ownerId: "manager-1",
      },
      select: { id: true },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("approves an owned pending profile and emits downstream work once", async () => {
    const { handler, transaction, updateProfile, writeInTx, enqueue } =
      buildHandler();

    const result = await handler.execute(command());

    expect(result.status).toBe(VERIFIED_PROFILE_STATUSES.approved);
    expect(result.approved_by_id).toBe("manager-1");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(updateProfile.mock.calls[0][0]).toMatchObject({
      where: { id: "vp-1" },
      data: {
        status: VERIFIED_PROFILE_STATUSES.approved,
        approvedById: "manager-1",
      },
    });
    expect(writeInTx).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      eventType: SCAN_EVENT_TYPES.verifiedProfileReady,
      aggregateId: "vp-1",
    });
  });
});

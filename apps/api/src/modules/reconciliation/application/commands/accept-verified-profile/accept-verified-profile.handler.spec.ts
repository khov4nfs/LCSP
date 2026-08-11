import { describe, expect, it, jest } from "@jest/globals";
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { AcceptVerifiedProfileCommand } from "./accept-verified-profile.command.js";
import { AcceptVerifiedProfileHandler } from "./accept-verified-profile.handler.js";

type FlowRecord = {
  id: string;
  assessmentId: string;
  organizationId: string;
};

function buildHandler(options?: {
  flow?: FlowRecord | null;
  pendingConflicts?: number;
  existingProfile?: { id: string } | null;
}) {
  const flow =
    options?.flow === undefined
      ? {
          id: "ai-flow-1",
          assessmentId: "assessment-1",
          organizationId: "org-1",
        }
      : options.flow;
  const pendingConflicts = options?.pendingConflicts ?? 0;
  const existingProfile = options?.existingProfile ?? null;

  const createVerifiedProfile = jest
    .fn<(args: unknown) => { id: string }>()
    .mockReturnValue({ id: "verified-profile-1" });
  const tx = {
    verifiedProfile: { create: createVerifiedProfile },
  };
  const transaction = jest.fn((cb: (arg: typeof tx) => Promise<void>) =>
    cb(tx),
  );
  const findAcceptedFlow = jest
    .fn<(args: unknown) => FlowRecord | null>()
    .mockReturnValue(flow);
  const countPendingConflicts = jest
    .fn<(args: unknown) => number>()
    .mockReturnValue(pendingConflicts);
  const findExistingProfile = jest
    .fn<(args: unknown) => { id: string } | null>()
    .mockReturnValue(existingProfile);
  const prisma = {
    aIUsageFlow: { findFirst: findAcceptedFlow },
    conflictRecord: { count: countPendingConflicts },
    verifiedProfile: { findUnique: findExistingProfile },
    $transaction: transaction,
  } as unknown as PrismaService;

  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const audit = { writeInTx } as unknown as AuditWriterService;

  const handler = new AcceptVerifiedProfileHandler(prisma, audit);
  const command = new AcceptVerifiedProfileCommand(
    {
      ai_usage_flow_id: "ai-flow-1",
      assessment_id: "assessment-1",
      schema_version: "1.0.0",
      provider_version: "verified-profile-worker@1.0.0",
      profile_data: {
        verified_claims: [{ claim_id: "claim-1", evidence_refs: ["ref-1"] }],
      },
      gates_passed_at: { conflicts_resolved: "2026-07-25T09:30:00.000Z" },
    },
    "corr-1",
  );

  return {
    command,
    countPendingConflicts,
    createVerifiedProfile,
    findAcceptedFlow,
    findExistingProfile,
    handler,
    prisma,
    transaction,
    writeInTx,
  };
}

describe("AcceptVerifiedProfileHandler", () => {
  it("persists a pending-approval VerifiedProfile without emitting downstream work", async () => {
    const { command, createVerifiedProfile, handler, writeInTx } =
      buildHandler();

    const result = await handler.execute(command);

    expect(result.accepted).toBe(true);
    expect(result.status).toBe(VERIFIED_PROFILE_STATUSES.pendingApproval);
    expect(createVerifiedProfile).toHaveBeenCalledTimes(1);
    expect(createVerifiedProfile.mock.calls[0][0]).toMatchObject({
      data: {
        aiUsageFlowId: "ai-flow-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
        schemaVersion: "1.0.0",
        status: VERIFIED_PROFILE_STATUSES.pendingApproval,
      },
    });

    expect(writeInTx).toHaveBeenCalledTimes(1);
    expect(writeInTx.mock.calls[0][0]).toMatchObject({
      eventType: SCAN_EVENT_TYPES.verifiedProfileAcceptedAudit,
      resourceType: AUDIT_RESOURCE_TYPES.verifiedProfile,
      resourceId: result.verified_profile_id,
    });
  });

  it("throws AI_USAGE_FLOW_NOT_FOUND when accepted flow is missing", async () => {
    const { command, handler } = buildHandler({ flow: null });

    try {
      await handler.execute(command);
      throw new Error("Expected NotFoundException");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: SCAN_ERROR_CODES.aiUsageFlowNotFound,
          correlationId: "corr-1",
        },
      });
    }
  });

  it("throws PENDING_CONFLICTS_EXIST before persistence", async () => {
    const { command, createVerifiedProfile, handler } = buildHandler({
      pendingConflicts: 1,
    });

    try {
      await handler.execute(command);
      throw new Error("Expected ConflictException");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: SCAN_ERROR_CODES.pendingConflictsExist,
          correlationId: "corr-1",
        },
      });
      expect(createVerifiedProfile).not.toHaveBeenCalled();
    }
  });

  it("throws PROFILE_ALREADY_EXISTS for duplicate AIUsageFlow", async () => {
    const { command, handler } = buildHandler({
      existingProfile: { id: "verified-profile-1" },
    });

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  it("throws schema invalid for unsupported schema version", async () => {
    const { command, handler } = buildHandler();
    const invalid = new AcceptVerifiedProfileCommand(
      { ...command.payload, schema_version: "0.0.0" },
      command.correlationId,
    );

    try {
      await handler.execute(invalid);
      throw new Error("Expected UnprocessableEntityException");
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        ok: false,
        problem: {
          code: SCAN_ERROR_CODES.verifiedProfileSchemaInvalid,
          correlationId: "corr-1",
        },
      });
    }
  });

  it("queries only accepted AIUsageFlow records", async () => {
    const { command, countPendingConflicts, findAcceptedFlow, handler } =
      buildHandler();

    await handler.execute(command);

    expect(findAcceptedFlow).toHaveBeenCalledWith({
      where: {
        id: "ai-flow-1",
        assessmentId: "assessment-1",
        status: AI_USAGE_FLOW_STATUSES.accepted,
      },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
      },
    });
    expect(countPendingConflicts).toHaveBeenCalledWith({
      where: {
        assessmentId: "assessment-1",
        organizationId: "org-1",
        status: CONFLICT_RECORD_STATUSES.pending,
      },
    });
  });
});

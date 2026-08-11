import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_STATUSES,
  AGENTIC_TOOL_NAMES,
  CLASSIFICATION_REVIEW_REQUEST_STATUSES,
  CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES,
  CLASSIFICATION_REVIEW_SUBMISSION_TOOL,
} from "@lcsp/contracts/evidence";
import { SCAN_EVENT_TYPES } from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { proposalGateRef } from "../../queries/validate-classification-proposal/validate-classification-proposal.handler.js";
import { SubmitClassificationReviewCommand } from "./submit-classification-review.command.js";
import { SubmitClassificationReviewHandler } from "./submit-classification-review.handler.js";

const INPUT = {
  baselineRef: "baseline:match-1",
  candidateLabel: "CLASSIFICATION_CANDIDATE_A",
  citationRefs: ["citation:chunk_allowed1"],
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

function command(input = {}) {
  return new SubmitClassificationReviewCommand(
    "assessment-1",
    "organization-1",
    {
      ...INPUT,
      proposalGateRef: proposalGateRef(INPUT),
      ...input,
    },
    "user-1",
    "policy-1",
    "1",
    "correlation-1",
  );
}

function ruleMatch(input?: {
  citationAllowlist?: unknown;
  overallCoverageStatus?: string;
  guardrailStatus?: string;
}) {
  return {
    id: "match-1",
    verifiedProfileId: "verified-1",
    citationAllowlist: input?.citationAllowlist ?? ["chunk_allowed1"],
    overallCoverageStatus: input?.overallCoverageStatus ?? "COMPLETE_CITATION",
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: null,
  };
}

function createHandler(input?: {
  assessment?: object | null;
  legalRuleMatch?: object | null;
  classificationResult?: object | null;
  reviewRequest?: object | null;
  conflict?: object | null;
}) {
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const enqueue = jest.fn<OutboxRepository["enqueue"]>().mockResolvedValue({});
  const tx = {
    classificationReviewRequest: {
      create: jest.fn<() => Promise<object>>().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest
      .fn<
        (
          callback: (transaction: typeof tx) => Promise<unknown>,
        ) => Promise<unknown>
      >()
      .mockImplementation((callback) => callback(tx)),
    assessment: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.assessment ?? { id: "assessment-1" }),
    },
    legalRuleMatch: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.legalRuleMatch ?? ruleMatch()),
    },
    classificationResult: {
      findUnique: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.classificationResult ?? null),
    },
    classificationReviewRequest: {
      findUnique: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.reviewRequest ?? null),
    },
    verifiedProfile: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue({ aiUsageFlowId: "flow-1" }),
    },
    conflictRecord: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.conflict ?? null),
    },
  } as unknown as PrismaService;
  const audit = { write, writeInTx } as unknown as AuditWriterService;
  const outbox = { enqueue } as unknown as OutboxRepository;

  return {
    handler: new SubmitClassificationReviewHandler(prisma, audit, outbox),
    prisma,
    tx,
    write,
    writeInTx,
    enqueue,
  };
}

describe("SubmitClassificationReviewHandler", () => {
  it("TC-01: creates one pending independent review request from a passing gate", async () => {
    const { handler, tx, writeInTx, enqueue } = createHandler();

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.status).toBe(
      CLASSIFICATION_REVIEW_REQUEST_STATUSES.pendingIndependentReview,
    );
    expect(response.result.reviewRequestRef).toMatch(/^classification-review:/);
    expect(tx.classificationReviewRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposalGateRef: proposalGateRef(INPUT),
          idempotencyKey: INPUT.idempotencyKey,
        }) as object,
      }),
    );
    const [[auditEntry]] = writeInTx.mock.calls;
    expect(auditEntry).toMatchObject({
      eventType: SCAN_EVENT_TYPES.classificationReviewRequestedAudit,
      payload: {
        toolName: AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
      },
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationReviewRequested,
      }) as object,
      expect.anything(),
    );
  });

  it("TC-02: replays an identical idempotent request without a second create", async () => {
    const existing = {
      id: "review-1",
      legalRuleMatchId: "match-1",
      proposalGateRef: proposalGateRef(INPUT),
      baselineRef: INPUT.baselineRef,
      candidateLabel: INPUT.candidateLabel,
      citationRefs: INPUT.citationRefs,
      status: "PENDING_INDEPENDENT_REVIEW",
      expiresAt: new Date("2026-08-20T00:00:00.000Z"),
    };
    const { handler, tx } = createHandler({ reviewRequest: existing });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.reviewRequestRef).toBe(
      "classification-review:review-1",
    );
    expect(tx.classificationReviewRequest.create).not.toHaveBeenCalled();
  });

  it("TC-03: blocks mismatched gate refs and writes a deny audit", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(
      command({ proposalGateRef: "classification-gate:wronggate" }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.gatePayloadMismatch,
    );
    expect(write).toHaveBeenCalled();
  });

  it("TC-04: refuses to submit when the proposal would now fail", async () => {
    const { handler, tx } = createHandler({
      legalRuleMatch: ruleMatch({ overallCoverageStatus: "PARTIAL_CITATION" }),
    });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.citationCoverageLimited,
    );
    expect(tx.classificationReviewRequest.create).not.toHaveBeenCalled();
  });

  it("TC-05: blocks open reconciliation conflicts", async () => {
    const { handler } = createHandler({ conflict: { id: "conflict-1" } });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES.conflictOpen,
    );
  });

  it("TC-06: rejects idempotency key reuse with different payload", async () => {
    const { handler } = createHandler({
      reviewRequest: {
        id: "review-1",
        legalRuleMatchId: "match-1",
        proposalGateRef: proposalGateRef(INPUT),
        baselineRef: INPUT.baselineRef,
        candidateLabel: INPUT.candidateLabel,
        citationRefs: ["citation:chunk_other"],
        status: "PENDING_INDEPENDENT_REVIEW",
        expiresAt: new Date("2026-08-20T00:00:00.000Z"),
      },
    });

    await expect(handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it("TC-07: exposes the configured review expiry budget", () => {
    expect(CLASSIFICATION_REVIEW_SUBMISSION_TOOL.expiresInDays).toBe(8);
  });
});

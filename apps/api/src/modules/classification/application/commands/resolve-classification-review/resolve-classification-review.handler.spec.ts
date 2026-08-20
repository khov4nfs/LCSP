import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { ClassificationReviewRequestStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_REVIEW_DECISION_CODES,
  CLASSIFICATION_REVIEW_DECISIONS,
  CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES,
  CLASSIFICATION_REVIEW_RESOLUTION_STATUSES,
} from "@lcsp/contracts/evidence";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import {
  CLASSIFICATION_RESULT_SCHEMA_VERSIONS,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ResolveClassificationReviewCommand } from "./resolve-classification-review.command.js";
import { ResolveClassificationReviewHandler } from "./resolve-classification-review.handler.js";

const INPUT = {
  reviewRequestRef: "classification-review:review-request-1",
  decision: CLASSIFICATION_REVIEW_DECISIONS.approve,
  decisionCode: CLASSIFICATION_REVIEW_DECISION_CODES.evidenceSufficient,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
} as const;

// Keep the default fixture intentionally unexpired regardless of wall-clock test date.
// Expiry behavior belongs in an explicit expired-request case rather than leaking from
// an absolute date into every unrelated review-resolution scenario.
const ACTIVE_REVIEW_EXPIRES_AT = new Date("2099-12-31T23:59:59.000Z");

function command(
  input: Partial<ResolveClassificationReviewCommand["input"]> = {},
) {
  return new ResolveClassificationReviewCommand(
    "assessment-1",
    "organization-1",
    { ...INPUT, ...input },
    "reviewer-1",
    "policy-1",
    "1",
    "correlation-1",
  );
}

function reviewRequest(input?: Partial<Record<string, unknown>>) {
  return {
    id: "review-request-1",
    legalRuleMatchId: "match-1",
    requestedById: "requester-1",
    citationRefs: ["citation:chunk_allow_1"],
    status: "PENDING_INDEPENDENT_REVIEW",
    expiresAt: ACTIVE_REVIEW_EXPIRES_AT,
    ...input,
  };
}

function ruleMatch(input?: Partial<Record<string, unknown>>) {
  return {
    id: "match-1",
    verifiedProfileId: "verified-1",
    matches: [
      {
        match_id: "m-1",
        rule_id: "rule-1",
        legal_rule_catalog_version_id: "catalog-1",
        article_ref: "art-1",
        clause_ref: "cl-1",
        match_type: "PRIMARY_MATCH",
        citation_chunk_ids: ["chunk_allow_1"],
        confidence: 0.92,
        coverage_status: "COMPLETE_CITATION",
        usage_claim_ref: "claim-1",
      },
    ],
    citationAllowlist: ["chunk_allow_1"],
    overallCoverageStatus: "COMPLETE_CITATION",
    guardrailStatus: "PASSED",
    blockedReason: null,
    ...input,
  };
}

function createHandler(input?: {
  assessment?: object | null;
  reviewRequest?: object | null;
  ruleMatch?: object | null;
  existingResult?: object | null;
  verifiedProfile?: object | null;
  conflict?: object | null;
}) {
  const write = jest.fn().mockImplementation(() => Promise.resolve());
  const writeInTx = jest.fn().mockImplementation(() => Promise.resolve());
  const enqueue = jest.fn().mockImplementation(() => Promise.resolve());
  const tx = {
    classificationReviewRequest: {
      updateMany: jest
        .fn<() => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 1 }),
    },
    classificationResult: {
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
    classificationReviewRequest: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.reviewRequest !== undefined
            ? input.reviewRequest
            : reviewRequest(),
        ),
    },
    legalRuleMatch: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.ruleMatch ?? ruleMatch()),
    },
    classificationResult: {
      findUnique: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.existingResult ?? null),
    },
    verifiedProfile: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.verifiedProfile ?? { aiUsageFlowId: "flow-1" },
        ),
    },
    conflictRecord: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.conflict ?? null),
    },
  } as unknown as PrismaService;

  return {
    handler: new ResolveClassificationReviewHandler(
      prisma,
      { write, writeInTx } as unknown as AuditWriterService,
      { enqueue } as unknown as OutboxRepository,
    ),
    tx,
    write,
    writeInTx,
    enqueue,
  };
}

describe("ResolveClassificationReviewHandler", () => {
  it("TC-01: approves a pending review and creates an immutable classification result", async () => {
    const { handler, tx, writeInTx, enqueue } = createHandler();

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.toolName).toBe(
      AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
    );
    expect(response.result.reviewStatus).toBe(
      CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.approved,
    );
    expect(response.result.classificationRef).toMatch(/^classification:/);
    expect(tx.classificationReviewRequest.updateMany).toHaveBeenCalled();
    expect(tx.classificationResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schemaVersion: CLASSIFICATION_RESULT_SCHEMA_VERSIONS[0],
          classificationData: expect.objectContaining({
            risk_level: "HIGH",
            applicability_assessment: "applicable",
            citation_basis: ["citation:chunk_allow_1"],
            citation_coverage: "COMPLETE_CITATION",
          }) as object,
        }) as object,
      }),
    );
    expect(writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationReviewResolvedAudit,
      }) as object,
      expect.anything(),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: OUTBOX_AGGREGATE_TYPES.classificationReviewRequest,
        eventType: SCAN_EVENT_TYPES.classificationReviewResolved,
      }) as object,
      expect.anything(),
    );
  });

  it("TC-02: rejects a pending review without creating a classification result", async () => {
    const { handler, tx } = createHandler();

    const response = await handler.execute(
      command({
        decision: CLASSIFICATION_REVIEW_DECISIONS.reject,
        decisionCode: CLASSIFICATION_REVIEW_DECISION_CODES.citationsInvalid,
      }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.reviewStatus).toBe(
      CLASSIFICATION_REVIEW_RESOLUTION_STATUSES.rejected,
    );
    expect(response.result.classificationRef).toBeNull();
    expect(tx.classificationReviewRequest.updateMany).toHaveBeenCalled();
    expect(tx.classificationResult.create).not.toHaveBeenCalled();
  });

  it("TC-03: replays the same approved resolution from persisted state", async () => {
    const { handler, tx, write } = createHandler({
      reviewRequest: reviewRequest({
        status: ClassificationReviewRequestStatus.APPROVED,
      }),
      existingResult: { id: "classification-1" },
    });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.classificationRef).toBe(
      "classification:classification-1",
    );
    expect(tx.classificationReviewRequest.updateMany).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.classificationReviewResolvedAudit,
        payload: expect.objectContaining({ replay: true }) as object,
      }),
    );
  });

  it("TC-04: blocks the same requester from resolving the review", async () => {
    const { handler } = createHandler({
      reviewRequest: reviewRequest({ requestedById: "reviewer-1" }),
    });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.reviewerNotIndependent,
    );
  });

  it("TC-05: blocks approval when accepted coverage becomes partial", async () => {
    const { handler, tx } = createHandler({
      ruleMatch: ruleMatch({ overallCoverageStatus: "PARTIAL_CITATION" }),
    });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.coverageLimited,
    );
    expect(tx.classificationResult.create).not.toHaveBeenCalled();
  });

  it("TC-06: blocks approval when an open reconciliation conflict remains", async () => {
    const { handler, tx } = createHandler({
      conflict: { id: "conflict-1" },
    });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES.conflictOpen,
    );
    expect(tx.classificationResult.create).not.toHaveBeenCalled();
  });

  it("TC-07: returns needs-input when the review request no longer exists", async () => {
    const { handler, tx } = createHandler({ reviewRequest: null });

    const response = await handler.execute(command());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(tx.classificationReviewRequest.updateMany).not.toHaveBeenCalled();
  });

  it("TC-08: surfaces a transaction conflict when another reviewer wins first", async () => {
    const tx = {
      classificationReviewRequest: {
        updateMany: jest
          .fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 0 }),
      },
      classificationResult: {
        create: jest.fn<() => Promise<object>>().mockResolvedValue({}),
      },
    };
    const prisma = {
      assessment: {
        findFirst: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue({ id: "assessment-1" }),
      },
      classificationReviewRequest: {
        findFirst: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue(reviewRequest()),
      },
      legalRuleMatch: {
        findFirst: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue(ruleMatch()),
      },
      classificationResult: {
        findUnique: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue(null),
      },
      verifiedProfile: {
        findFirst: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue({ aiUsageFlowId: "flow-1" }),
      },
      conflictRecord: {
        findFirst: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue(null),
      },
      $transaction: jest
        .fn<
          (
            callback: (transaction: typeof tx) => Promise<unknown>,
          ) => Promise<unknown>
        >()
        .mockImplementation((callback) => callback(tx)),
    } as unknown as PrismaService;
    const handler = new ResolveClassificationReviewHandler(
      prisma,
      {
        write: jest.fn().mockImplementation(() => Promise.resolve()),
        writeInTx: jest.fn().mockImplementation(() => Promise.resolve()),
      } as unknown as AuditWriterService,
      {
        enqueue: jest.fn().mockImplementation(() => Promise.resolve()),
      } as unknown as OutboxRepository,
    );

    await expect(handler.execute(command())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

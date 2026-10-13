import { expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AssessmentDetailLoader } from "./assessment-detail.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

const assessmentId = "22222222-2222-4222-8222-222222222222";
const input = {
  assessmentId,
  sessionUserId: "owner",
  subjectRole: AUTH_USER_ROLES.customer,
  correlationId: "test",
};
function fixture() {
  const row = {
    id: assessmentId,
    name: "Synthetic assessment",
    ownerId: input.sessionUserId,
    lifecycleState: null,
    lifecycleRevision: null,
    blockerReason: null,
    blockerReference: null,
    runtime: null,
    domainCase: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const aggregate = jest.fn<() => Promise<unknown>>().mockResolvedValue({
    _sum: { inputTokens: 200001n, outputTokens: 41n, totalTokens: 200042n },
    _count: {
      id: 201,
      inputTokens: 201,
      outputTokens: 201,
      totalTokens: 201,
    },
  });
  const tx = {
    assessment: { findUnique: () => Promise.resolve(row) },
    llmUsageEvent: { aggregate },
  };
  const loader = new AssessmentDetailLoader({
    $transaction: (work: (tx: unknown) => unknown) => Promise.resolve(work(tx)),
  } as unknown as PrismaService);
  return { loader, row, aggregate };
}
it("returns all invocation totals without depending on bounded event history", async () => {
  const { loader, aggregate } = fixture();
  expect((await loader.load(input)).usage).toEqual({
    invocationCount: 201,
    inputTokens: 200001,
    outputTokens: 41,
    totalTokens: 200042,
    partial: false,
  });
  expect(aggregate.mock.calls[0]).toEqual([
    expect.objectContaining({
      where: { assessmentId, userId: input.sessionUserId },
    }),
  ]);
});
it("omits missing provider counters and marks incomplete totals", async () => {
  const { loader, aggregate } = fixture();
  aggregate.mockResolvedValue({
    _sum: { inputTokens: 5n, outputTokens: null, totalTokens: null },
    _count: { id: 2, inputTokens: 1, outputTokens: 0, totalTokens: 0 },
  });
  expect((await loader.load(input)).usage).toEqual({
    invocationCount: 2,
    inputTokens: 5,
    partial: true,
  });
});
it("does not read usage for a foreign assessment", async () => {
  const { loader, row, aggregate } = fixture();
  row.ownerId = "foreign-owner";
  await expect(loader.load(input)).rejects.toThrow();
  expect(aggregate).not.toHaveBeenCalled();
});

it("projects decision customer-visible rationales to VI while preserving technical invariants", async () => {
  const { loader, row } = fixture();
  const decisionData = {
    assessmentRuleId: "RULE-SEC-01",
    assessmentRuleVersion: "v1",
    scopeId: "GLOBAL_SCOPE",
    ruleSetVersionId: "44444444-4444-4444-8444-444444444444",
    repositorySnapshotId: "55555555-5555-4555-8555-555555555555",
    repositoryCommit: "a".repeat(40),
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "LC-1" }],
    applicability: "APPLICABLE",
    rationale: "All access controls are properly implemented in the service.",
    compliance: "COMPLIANT",
    references: [
      {
        type: "CONFIRMED_FACT",
        factId: "77777777-7777-4777-8777-777777777777",
        caseRevision: 1,
      },
    ],
    criteria: [
      {
        criterionId: "CRIT-AUTH-01",
        outcome: "MET",
        rationale: "Token authentication satisfies requirement.",
        references: [
          {
            type: "CONFIRMED_FACT",
            factId: "77777777-7777-4777-8777-777777777777",
            caseRevision: 1,
          },
        ],
      },
    ],
  };

  row.domainCase = {
    caseRevision: 1,
    ruleSetVersionId: null,
    repositorySnapshotId: null,
    repositoryScanJobId: null,
    repositoryCommit: null,
    coverage: [
      {
        assessmentRuleId: "RULE-SEC-01",
        assessmentRuleVersion: "v1",
        resolutionState: "RESOLVED",
        currentDecisionId: "66666666-6666-4666-8666-666666666666",
        decisionRevision: 1,
        currentDecision: {
          decisionId: "66666666-6666-4666-8666-666666666666",
          assessmentId,
          assessmentRuleId: "RULE-SEC-01",
          scopeId: "GLOBAL_SCOPE",
          decisionRevision: 1,
          state: "ACCEPTED",
          decision: decisionData,
          createdAt: new Date(),
        },
      },
    ],
    facts: [],
    artifacts: [],
  } as never;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        projected: {
          "All access controls are properly implemented in the service.":
            "Tất cả kiểm soát truy cập đều được triển khai đúng cách trong dịch vụ.",
          "Token authentication satisfies requirement.":
            "Xác thực mã thông báo đáp ứng yêu cầu.",
        },
      }),
  }) as never;

  process.env.LCSP_AGENT_SERVER_URL = "http://127.0.0.1:2024";
  process.env.WORKER_API_KEY = "test-worker-key";

  try {
    // 1. Read with VI locale
    const resultVi = await loader.load({ ...input, locale: "vi" });
    const decisionVi = resultVi.case?.decisions[0]?.decision;
    expect(decisionVi?.rationale).toBe(
      "Tất cả kiểm soát truy cập đều được triển khai đúng cách trong dịch vụ.",
    );
    expect(decisionVi?.criteria[0]?.rationale).toBe(
      "Xác thực mã thông báo đáp ứng yêu cầu.",
    );
    // Invariants preserved
    expect(decisionVi?.applicability).toBe("APPLICABLE");
    expect(decisionVi?.compliance).toBe("COMPLIANT");
    expect(decisionVi?.criteria[0]?.criterionId).toBe("CRIT-AUTH-01");
    expect(decisionVi?.criteria[0]?.outcome).toBe("MET");

    // 2. Read with EN locale - preserves canonical English
    const resultEn = await loader.load({ ...input, locale: "en" });
    const decisionEn = resultEn.case?.decisions[0]?.decision;
    expect(decisionEn?.rationale).toBe(
      "All access controls are properly implemented in the service.",
    );
    expect(decisionEn?.criteria[0]?.rationale).toBe(
      "Token authentication satisfies requirement.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LCSP_AGENT_SERVER_URL;
    delete process.env.WORKER_API_KEY;
  }
});

import { expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_FACT_AUTHORITIES } from "@lcsp/contracts/assessment-domain";
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
    facts: [
      {
        factId: "77777777-7777-4777-8777-777777777777",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
        state: "ACCEPTED",
        statement:
          "Data retention policy is enforced across all customer records.",
        evidenceLinks: [{ evidenceId: "88888888-8888-4888-8888-888888888888" }],
        createdAt: new Date(),
      },
      {
        factId: "99999999-9999-4999-8999-999999999999",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: "ACCEPTED",
        statement:
          "Deployment region: whether production is EU-hosted: Singapore",
        evidenceLinks: [{ evidenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
        createdAt: new Date(),
      },
      {
        factId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: "ACCEPTED",
        statement: "Legacy unlinked fact: custom user answer",
        evidenceLinks: [],
        createdAt: new Date(),
      },
      {
        factId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: "ACCEPTED",
        statement: "Corrupt statement does not match prefix: user answer",
        evidenceLinks: [],
        createdAt: new Date(),
      },
      {
        factId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: "ACCEPTED",
        statement: "Disaster recovery location: Tokyo",
        evidenceLinks: [],
        createdAt: new Date(),
      },
      {
        factId: "11111111-1111-4111-8111-111111111111",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: "ACCEPTED",
        statement: "Backup retention period: 30 days",
        evidenceLinks: [],
        createdAt: new Date(),
      },
      {
        factId: "22222222-2222-4222-8222-222222222222",
        assessmentId,
        caseRevision: 1,
        kind: "FACT",
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        state: "ACCEPTED",
        statement: "Encryption at rest: AES-256",
        evidenceLinks: [],
        createdAt: new Date(),
      },
    ],
    humanRequests: [
      {
        requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        resolvedFactId: "99999999-9999-4999-8999-999999999999",
        unresolvedFact: "Deployment region: whether production is EU-hosted",
        answers: [
          {
            idempotencyKey: "12345678",
            requestDigest:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            actorId: "test-user-id",
            answeredAt: new Date().toISOString(),
            caseRevision: 1,
            requestRevision: 1,
            doesNotKnow: false,
            answer: "Singapore",
          },
        ],
      },
      {
        requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        resolvedFactId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        unresolvedFact: "Expected prefix that statement does not match",
        answers: [],
      },
      {
        requestId: "33333333-3333-4333-8333-333333333333",
        resolvedFactId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        unresolvedFact: "Disaster recovery location",
        answers: [],
      },
      {
        requestId: "44444444-4444-4444-8444-444444444444",
        resolvedFactId: "11111111-1111-4111-8111-111111111111",
        unresolvedFact: "Backup retention period",
        answers: [
          {
            doesNotKnow: true,
            answer: null,
          },
        ],
      },
      {
        requestId: "55555555-5555-4555-8555-555555555555",
        resolvedFactId: "22222222-2222-4222-8222-222222222222",
        unresolvedFact: "Encryption at rest",
        answers: [
          {
            doesNotKnow: false,
            answer: 12345,
          },
        ],
      },
    ],
    artifacts: [],
  } as never;

  const originalFetch = globalThis.fetch;
  const requestedTexts: string[] = [];
  globalThis.fetch = jest
    .fn()
    .mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.body) {
        try {
          const parsed = JSON.parse(init.body as string) as {
            texts?: string[];
          };
          if (Array.isArray(parsed.texts)) {
            requestedTexts.push(...parsed.texts);
          }
        } catch {
          // ignore parse error in test spy
        }
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            projected: {
              "All access controls are properly implemented in the service.":
                "Tất cả kiểm soát truy cập đều được triển khai đúng cách trong dịch vụ.",
              "Token authentication satisfies requirement.":
                "Xác thực mã thông báo đáp ứng yêu cầu.",
              "Data retention policy is enforced across all customer records.":
                "Chính sách lưu giữ dữ liệu được thực thi trên tất cả hồ sơ khách hàng.",
              "Deployment region: whether production is EU-hosted":
                "Khu vực triển khai: liệu môi trường production có được lưu trữ tại EU không",
            },
          }),
      } as Response);
    }) as typeof fetch;

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

    // Case fact statement: agent-authored EVIDENCE_CITED is projected to VI
    const factVi = resultVi.case?.facts[0];
    expect(factVi?.statement).toBe(
      "Chính sách lưu giữ dữ liệu được thực thi trên tất cả hồ sơ khách hàng.",
    );
    // Fact technical invariants preserved
    expect(factVi?.factId).toBe("77777777-7777-4777-8777-777777777777");
    expect(factVi?.kind).toBe("FACT");
    expect(factVi?.authority).toBe(ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED);
    expect(factVi?.state).toBe("ACCEPTED");
    expect(factVi?.evidenceIds).toEqual([
      "88888888-8888-4888-8888-888888888888",
    ]);

    // HUMAN_PROVIDED fact: unresolvedFact contains ": " but is resolved structurally from humanRequests;
    // all generated text re-projects while exact customer answer remains byte-for-byte unchanged
    const humanFactVi = resultVi.case?.facts[1];
    expect(humanFactVi?.statement).toBe(
      "Khu vực triển khai: liệu môi trường production có được lưu trữ tại EU không: Singapore",
    );
    expect(humanFactVi?.authority).toBe(
      ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
    );
    // Legacy/corrupt HUMAN_PROVIDED facts fail closed: canonical statement unchanged and absent from projection
    const legacyFactVi = resultVi.case?.facts[2];
    expect(legacyFactVi?.statement).toBe(
      "Legacy unlinked fact: custom user answer",
    );
    expect(legacyFactVi?.authority).toBe(
      ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
    );

    const corruptFactVi = resultVi.case?.facts[3];
    expect(corruptFactVi?.statement).toBe(
      "Corrupt statement does not match prefix: user answer",
    );
    expect(corruptFactVi?.authority).toBe(
      ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
    );

    const emptyAnswersFactVi = resultVi.case?.facts[4];
    expect(emptyAnswersFactVi?.statement).toBe(
      "Disaster recovery location: Tokyo",
    );
    expect(emptyAnswersFactVi?.authority).toBe(
      ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
    );

    const doesNotKnowFactVi = resultVi.case?.facts[5];
    expect(doesNotKnowFactVi?.statement).toBe(
      "Backup retention period: 30 days",
    );
    expect(doesNotKnowFactVi?.authority).toBe(
      ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
    );

    const malformedAnswerFactVi = resultVi.case?.facts[6];
    expect(malformedAnswerFactVi?.statement).toBe(
      "Encryption at rest: AES-256",
    );
    expect(malformedAnswerFactVi?.authority).toBe(
      ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
    );

    // User answer is absent from projection requests; all generated text was requested
    expect(requestedTexts).toContain(
      "Deployment region: whether production is EU-hosted",
    );
    expect(requestedTexts).not.toContain("Singapore");
    expect(requestedTexts).not.toContain(
      "whether production is EU-hosted: Singapore",
    );
    expect(requestedTexts).not.toContain(
      "Deployment region: whether production is EU-hosted: Singapore",
    );
    expect(requestedTexts).not.toContain(
      "Legacy unlinked fact: custom user answer",
    );
    expect(requestedTexts).not.toContain("Legacy unlinked fact");
    expect(requestedTexts).not.toContain("custom user answer");
    expect(requestedTexts).not.toContain(
      "Corrupt statement does not match prefix: user answer",
    );
    expect(requestedTexts).not.toContain(
      "Corrupt statement does not match prefix",
    );
    expect(requestedTexts).not.toContain(
      "Expected prefix that statement does not match",
    );
    expect(requestedTexts).not.toContain("Disaster recovery location: Tokyo");
    expect(requestedTexts).not.toContain("Disaster recovery location");
    expect(requestedTexts).not.toContain("Tokyo");
    expect(requestedTexts).not.toContain("Backup retention period: 30 days");
    expect(requestedTexts).not.toContain("Backup retention period");
    expect(requestedTexts).not.toContain("30 days");
    expect(requestedTexts).not.toContain("Encryption at rest: AES-256");
    expect(requestedTexts).not.toContain("Encryption at rest");
    expect(requestedTexts).not.toContain("AES-256");

    // 2. Read with EN locale - preserves canonical English
    const resultEn = await loader.load({ ...input, locale: "en" });
    const decisionEn = resultEn.case?.decisions[0]?.decision;
    expect(decisionEn?.rationale).toBe(
      "All access controls are properly implemented in the service.",
    );
    expect(decisionEn?.criteria[0]?.rationale).toBe(
      "Token authentication satisfies requirement.",
    );
    const factEn = resultEn.case?.facts[0];
    expect(factEn?.statement).toBe(
      "Data retention policy is enforced across all customer records.",
    );
    const humanFactEn = resultEn.case?.facts[1];
    expect(humanFactEn?.statement).toBe(
      "Deployment region: whether production is EU-hosted: Singapore",
    );
    const legacyFactEn = resultEn.case?.facts[2];
    expect(legacyFactEn?.statement).toBe(
      "Legacy unlinked fact: custom user answer",
    );
    const corruptFactEn = resultEn.case?.facts[3];
    expect(corruptFactEn?.statement).toBe(
      "Corrupt statement does not match prefix: user answer",
    );
    const emptyAnswersFactEn = resultEn.case?.facts[4];
    expect(emptyAnswersFactEn?.statement).toBe(
      "Disaster recovery location: Tokyo",
    );
    const doesNotKnowFactEn = resultEn.case?.facts[5];
    expect(doesNotKnowFactEn?.statement).toBe(
      "Backup retention period: 30 days",
    );
    const malformedAnswerFactEn = resultEn.case?.facts[6];
    expect(malformedAnswerFactEn?.statement).toBe(
      "Encryption at rest: AES-256",
    );

    // 3. Switch back to VI locale on same persisted fact row
    const resultVi2 = await loader.load({ ...input, locale: "vi" });
    const factVi2 = resultVi2.case?.facts[0];
    expect(factVi2?.statement).toBe(
      "Chính sách lưu giữ dữ liệu được thực thi trên tất cả hồ sơ khách hàng.",
    );
    const humanFactVi2 = resultVi2.case?.facts[1];
    expect(humanFactVi2?.statement).toBe(
      "Khu vực triển khai: liệu môi trường production có được lưu trữ tại EU không: Singapore",
    );
    const legacyFactVi2 = resultVi2.case?.facts[2];
    expect(legacyFactVi2?.statement).toBe(
      "Legacy unlinked fact: custom user answer",
    );
    const corruptFactVi2 = resultVi2.case?.facts[3];
    expect(corruptFactVi2?.statement).toBe(
      "Corrupt statement does not match prefix: user answer",
    );
    const emptyAnswersFactVi2 = resultVi2.case?.facts[4];
    expect(emptyAnswersFactVi2?.statement).toBe(
      "Disaster recovery location: Tokyo",
    );
    const doesNotKnowFactVi2 = resultVi2.case?.facts[5];
    expect(doesNotKnowFactVi2?.statement).toBe(
      "Backup retention period: 30 days",
    );
    const malformedAnswerFactVi2 = resultVi2.case?.facts[6];
    expect(malformedAnswerFactVi2?.statement).toBe(
      "Encryption at rest: AES-256",
    );

    // Canonical persisted fact rows remain unchanged
    const storedFacts = (
      row.domainCase as unknown as { facts: Array<{ statement: string }> }
    ).facts;
    expect(storedFacts[0]?.statement).toBe(
      "Data retention policy is enforced across all customer records.",
    );
    expect(storedFacts[1]?.statement).toBe(
      "Deployment region: whether production is EU-hosted: Singapore",
    );
    expect(storedFacts[2]?.statement).toBe(
      "Legacy unlinked fact: custom user answer",
    );
    expect(storedFacts[3]?.statement).toBe(
      "Corrupt statement does not match prefix: user answer",
    );
    expect(storedFacts[4]?.statement).toBe("Disaster recovery location: Tokyo");
    expect(storedFacts[5]?.statement).toBe("Backup retention period: 30 days");
    expect(storedFacts[6]?.statement).toBe("Encryption at rest: AES-256");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LCSP_AGENT_SERVER_URL;
    delete process.env.WORKER_API_KEY;
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ASSESSMENT_DISCOVERY_RUN_STATUSES,
  DISCOVERY_DETAIL_COLLECTIONS,
  DISCOVERY_EVIDENCE_STRENGTHS,
  DISCOVERY_INTERVIEW_PROPOSAL_STATUSES,
  DISCOVERY_OBSERVATION_STATUSES,
  DISCOVERY_REACHABILITY_STATES,
  DISCOVERY_RULE_CANDIDATE_STATES,
  DISCOVERY_SIGNAL_TYPES,
  DISCOVERY_SOURCE_CLASSIFICATIONS,
  REPOSITORY_DISCOVERY_VERSIONS,
  REPOSITORY_SCANNER_VERSIONS,
} from "@lcsp/contracts/assessment-domain";
import { render, settle, click, byText } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { RuleAuditPicker } from "../src/features/assessment-runtime/components/organisms/rule-audit-picker.tsx";
import { copy } from "../src/features/assessment-runtime/utils/conversation-copy.ts";

const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/selected-rule-audit-catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const ASSESSMENT_ID = catalog.assessmentId as string;
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_ID = "22222222-2222-4222-8222-222222222222";
const FACT_NEED_ID = "33333333-3333-4333-8333-333333333333";
const FACT_ID = "44444444-4444-4444-8444-444444444444";
const USE_CASE_ID = `sha256:${"a".repeat(64)}`;
const RANGE_ID = `sha256:${"b".repeat(64)}`;
const DIGEST = `sha256:${"c".repeat(64)}`;
const COMMIT = "d".repeat(40);
const QUESTION = "Does the service retain account access logs?";

function makeRunView(overrides?: {
  status?: (typeof ASSESSMENT_DISCOVERY_RUN_STATUSES)[keyof typeof ASSESSMENT_DISCOVERY_RUN_STATUSES];
  aiUseCaseCount?: number;
  ruleCandidateCount?: number;
  knownGapCount?: number;
  truncated?: boolean;
  includeRange?: boolean;
  includeQuestion?: boolean;
}) {
  const status =
    overrides?.status ?? ASSESSMENT_DISCOVERY_RUN_STATUSES.completed;
  const aiUseCaseCount = overrides?.aiUseCaseCount ?? 1;
  const ruleCandidateCount = overrides?.ruleCandidateCount ?? 1;
  const knownGapCount = overrides?.knownGapCount ?? 0;
  const truncated = overrides?.truncated ?? false;
  const includeRange = overrides?.includeRange ?? true;
  const includeQuestion = overrides?.includeQuestion ?? true;

  return {
    runId: RUN_ID,
    assessmentId: ASSESSMENT_ID,
    status,
    attempt: 1,
    repositorySnapshotId: catalog.repositorySnapshotId,
    repositoryCommit: COMMIT,
    sourcePathPrefix: null,
    requestedAt: "2026-11-28T10:00:00.000Z",
    startedAt: "2026-11-28T10:00:01.000Z",
    completedAt:
      status === ASSESSMENT_DISCOVERY_RUN_STATUSES.completed
        ? "2026-11-28T10:00:05.000Z"
        : null,
    failedAt:
      status === ASSESSMENT_DISCOVERY_RUN_STATUSES.failed
        ? "2026-11-28T10:00:05.000Z"
        : null,
    errorCode: status === ASSESSMENT_DISCOVERY_RUN_STATUSES.failed ? "SCAN_FAILED" : null,
    discovery:
      status === ASSESSMENT_DISCOVERY_RUN_STATUSES.completed
        ? {
            available: true as const,
            discovery: {
              recordId: "55555555-5555-4555-8555-555555555555",
              repositorySnapshotId: catalog.repositorySnapshotId,
              repositoryId: "acme/checkout-service",
              repositoryCommit: COMMIT,
              sourcePathPrefix: null,
              scannerVersion: REPOSITORY_SCANNER_VERSIONS.v1,
              discoveryVersion: REPOSITORY_DISCOVERY_VERSIONS.v1,
              scannerSignature: DIGEST,
              graphIndexVersion: "1",
              cacheIdentity: DIGEST,
              contentDigest: DIGEST,
              sourceRangeCount: includeRange ? 1 : 0,
              aiUseCaseCount,
              ruleCandidateCount,
              knownGapCount,
              unsupportedLanguageCount: 0,
              unresolvedCallCount: 0,
              resourceBudget: { maxFiles: 100, maxBytes: 100000, maxRanges: 100 },
              resourceUsage: { filesScanned: 10, bytesInspected: 2048, rangesProduced: 1 },
              remainingBudget: { files: 90, bytes: 97952, ranges: 99 },
              coverageImpact: {
                knownGapCount,
                unresolvedCallCount: 0,
                unsupportedLanguageCount: 0,
                truncated,
              },
              expansionCount: 0,
              preview: {
                ranges: includeRange
                  ? [
                      {
                        rangeId: RANGE_ID,
                        path: "src/auth/access-log.ts",
                        startLine: 12,
                        endLine: 28,
                        symbol: "writeAccessLog",
                        signalType: DISCOVERY_SIGNAL_TYPES.control,
                        sourceClassification:
                          DISCOVERY_SOURCE_CLASSIFICATIONS.reachableProduction,
                        reachability: DISCOVERY_REACHABILITY_STATES.confirmed,
                        observationStatus:
                          DISCOVERY_OBSERVATION_STATUSES.observedSourceFact,
                        evidenceStrength:
                          DISCOVERY_EVIDENCE_STRENGTHS.directSource,
                        explanation: "Writes user access logs to audit store.",
                        snippet:
                          "export async function writeAccessLog(event: AccessLogEvent): Promise<void> {\n  await auditStore.insert(\"access_logs\", event);\n}",
                        useCaseIds: [USE_CASE_ID],
                      },
                    ]
                  : [],
                aiUseCases:
                  aiUseCaseCount > 0
                    ? [
                        {
                          useCaseId: USE_CASE_ID,
                          name: "Checkout Fraud Scorer",
                          observationStatus:
                            DISCOVERY_OBSERVATION_STATUSES.observedSourceFact,
                          providerOrFramework: "openai",
                          invocationRangeIds: includeRange ? [RANGE_ID] : [],
                          unresolvedQuestions: includeQuestion ? [QUESTION] : [],
                        },
                      ]
                    : [],
                ruleCandidates:
                  ruleCandidateCount > 0
                    ? [
                        {
                          assessmentRuleId: "Rule-3",
                          assessmentRuleVersion: "v1",
                          state: DISCOVERY_RULE_CANDIDATE_STATES.candidate,
                          supportingUseCaseIds: [USE_CASE_ID],
                          supportingRangeIds: includeRange ? [RANGE_ID] : [],
                          supportingFactIds: [],
                          matchedTerms: ["access log"],
                          applicabilityElements: ["Account access logs"],
                          unresolvedConditions: [],
                          rationale: "Access logging module detected.",
                          limitations: [],
                          authorizesAssessment: false as const,
                        },
                      ]
                    : [],
                knownGaps: [],
                unsupportedLanguages: [],
                unresolvedCalls: [],
              },
              createdAt: "2026-11-28T10:00:05.000Z",
            },
          }
        : { available: false as const, discovery: null },
  };
}

function makeProposal(
  status: (typeof DISCOVERY_INTERVIEW_PROPOSAL_STATUSES)[keyof typeof DISCOVERY_INTERVIEW_PROPOSAL_STATUSES],
  answer = "Yes, logs are retained for 12 months.",
) {
  return {
    proposalId: PROPOSAL_ID,
    assessmentId: ASSESSMENT_ID,
    discoveryRunId: RUN_ID,
    factNeedId: FACT_NEED_ID,
    useCaseId: USE_CASE_ID,
    question: QUESTION,
    answer,
    status,
    guardFailure: null,
    caseRevision: 1,
    acceptedFactId:
      status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.accepted ? FACT_ID : null,
    createdAt: "2026-11-28T10:01:00.000Z",
    reviewedAt:
      status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview
        ? null
        : "2026-11-28T10:02:00.000Z",
  };
}

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
}

for (const locale of ["en", "vi"] as const) {
  test(`${locale}: confirm answer gates continuation and keeps suggested rules distinct from selected rules`, async () => {
    setAppLocale(locale);
    let currentProposal = makeProposal(
      DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview,
    );
    const run = makeRunView();
    const originalFetch = globalThis.fetch;
    const postCalls: Array<{ path: string; body: string }> = [];

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.pathname === `/api/assessments/${ASSESSMENT_ID}/rules`) {
        return Response.json({ ok: true, data: catalog });
      }
      if (url.pathname.endsWith("/discovery-runs/latest")) {
        return Response.json({ ok: true, data: { available: true, run } });
      }
      if (url.pathname.endsWith("/details")) {
        const collection = url.searchParams.get("collection");
        const items =
          collection === DISCOVERY_DETAIL_COLLECTIONS.aiUseCases
            ? run.discovery.available
              ? run.discovery.discovery.preview.aiUseCases
              : []
            : run.discovery.available
              ? run.discovery.discovery.preview.ruleCandidates
              : [];
        return Response.json({
          ok: true,
          data: {
            recordId: "55555555-5555-4555-8555-555555555555",
            contentDigest: DIGEST,
            collection,
            total: items.length,
            offset: 0,
            limit: 100,
            nextOffset: null,
            items,
          },
        });
      }
      if (url.pathname.endsWith("/context-answers")) {
        return Response.json({
          ok: true,
          data: {
            caseRevision: 1,
            total: 1,
            offset: 0,
            limit: 50,
            nextOffset: null,
            items: [currentProposal],
          },
        });
      }
      if (url.pathname.endsWith(`/context-answers/${PROPOSAL_ID}/review`)) {
        postCalls.push({
          path: url.pathname,
          body: String(init?.body ?? ""),
        });
        currentProposal = makeProposal(
          DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.accepted,
        );
        return Response.json({ ok: true, data: currentProposal });
      }
      throw new Error(`Unexpected fetch: ${method} ${url.pathname}`);
    };

    const client = createClient();
    try {
      const view = render(
        <QueryClientProvider client={client}>
          <RuleAuditPicker assessmentId={ASSESSMENT_ID} />
        </QueryClientProvider>,
      );
      await settle();

      assert.ok(view.textContent?.includes("src/auth/access-log.ts:12-28"));
      assert.ok(
        view.textContent?.includes("export async function writeAccessLog"),
      );
      assert.match(view.textContent ?? "", /Selected 0\/20|Đã chọn 0\/20/);

      const continueButton = byText<HTMLButtonElement>(
        view,
        "button",
        copy("ruleAudit.discovery.continueToRuleSelection"),
      );
      assert.equal(continueButton?.disabled, true);

      click(
        byText<HTMLButtonElement>(
          view,
          "button",
          copy("ruleAudit.discovery.interviewConfirm"),
        ),
      );
      await settle();

      assert.equal(postCalls.length, 1);
      assert.equal(
        JSON.parse(postCalls[0]!.body).action,
        "ACCEPT",
      );
      assert.ok(
        view.textContent?.includes(
          copy("ruleAudit.discovery.contextConfirmedTitle"),
        ),
      );
      assert.equal(
        byText<HTMLButtonElement>(
          view,
          "button",
          copy("ruleAudit.discovery.continueToRuleSelection"),
        )?.disabled,
        false,
      );
      // Suggested rule must never be auto-selected or auto-audited.
      assert.match(view.textContent ?? "", /Selected 0\/20|Đã chọn 0\/20/);
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
      act(() => setAppLocale("en"));
    }
  });
}

test("reject and correct answer flow preserves block until corrected answer is submitted", async () => {
  setAppLocale("en");
  let currentProposal = makeProposal(
    DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview,
  );
  const run = makeRunView();
  const originalFetch = globalThis.fetch;
  const submittedAnswers: Array<{ answer: string; idempotencyKey: string }> =
    [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname === `/api/assessments/${ASSESSMENT_ID}/rules`) {
      return Response.json({ ok: true, data: catalog });
    }
    if (url.pathname.endsWith("/discovery-runs/latest")) {
      return Response.json({ ok: true, data: { available: true, run } });
    }
    if (url.pathname.endsWith("/details")) {
      const collection = url.searchParams.get("collection");
      const items =
        collection === DISCOVERY_DETAIL_COLLECTIONS.aiUseCases
          ? run.discovery.available
            ? run.discovery.discovery.preview.aiUseCases
            : []
          : run.discovery.available
            ? run.discovery.discovery.preview.ruleCandidates
            : [];
      return Response.json({
        ok: true,
        data: {
          recordId: "55555555-5555-4555-8555-555555555555",
          contentDigest: DIGEST,
          collection,
          total: items.length,
          offset: 0,
          limit: 100,
          nextOffset: null,
          items,
        },
      });
    }
    if (url.pathname.endsWith("/context-answers") && method === "GET") {
      return Response.json({
        ok: true,
        data: {
          caseRevision: 1,
          total: 1,
          offset: 0,
          limit: 50,
          nextOffset: null,
          items: [currentProposal],
        },
      });
    }
    if (url.pathname.endsWith(`/context-answers/${PROPOSAL_ID}/review`)) {
      currentProposal = makeProposal(
        DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.rejected,
      );
      return Response.json({ ok: true, data: currentProposal });
    }
    if (url.pathname.endsWith("/context-answers") && method === "POST") {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as {
        answer: string;
        idempotencyKey: string;
      };
      submittedAnswers.push(parsed);
      currentProposal = makeProposal(
        DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview,
        parsed.answer,
      );
      return Response.json({ ok: true, data: currentProposal });
    }
    throw new Error(`Unexpected fetch: ${method} ${url.pathname}`);
  };

  const client = createClient();
  try {
    const view = render(
      <QueryClientProvider client={client}>
        <RuleAuditPicker assessmentId={ASSESSMENT_ID} />
      </QueryClientProvider>,
    );
    await settle();

    click(
      byText<HTMLButtonElement>(
        view,
        "button",
        copy("ruleAudit.discovery.interviewReject"),
      ),
    );
    await settle();

    assert.ok(
      view.textContent?.includes(
        copy("ruleAudit.discovery.contextRejectedTitle"),
      ),
    );
    assert.equal(
      byText<HTMLButtonElement>(
        view,
        "button",
        copy("ruleAudit.discovery.continueToRuleSelection"),
      )?.disabled,
      true,
    );
    assert.ok(
      byText<HTMLButtonElement>(
        view,
        "button",
        copy("ruleAudit.discovery.confirmCorrectedAnswer"),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test("no-AI, interrupted coverage, and missing evidence render explicit states without blocking manual selection", async () => {
  setAppLocale("en");
  const run = makeRunView({
    aiUseCaseCount: 0,
    ruleCandidateCount: 0,
    knownGapCount: 2,
    truncated: true,
    includeRange: false,
    includeQuestion: false,
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === `/api/assessments/${ASSESSMENT_ID}/rules`) {
      return Response.json({ ok: true, data: catalog });
    }
    if (url.pathname.endsWith("/discovery-runs/latest")) {
      return Response.json({ ok: true, data: { available: true, run } });
    }
    if (url.pathname.endsWith("/details")) {
      return Response.json({
        ok: true,
        data: {
          recordId: "55555555-5555-4555-8555-555555555555",
          contentDigest: DIGEST,
          collection: url.searchParams.get("collection"),
          total: 0,
          offset: 0,
          limit: 100,
          nextOffset: null,
          items: [],
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url.pathname}`);
  };

  const client = createClient();
  try {
    const view = render(
      <QueryClientProvider client={client}>
        <RuleAuditPicker assessmentId={ASSESSMENT_ID} />
      </QueryClientProvider>,
    );
    await settle();

    assert.ok(view.textContent?.includes(copy("ruleAudit.discovery.noAiTitle")));
    assert.ok(
      view.textContent?.includes(
        copy("ruleAudit.discovery.interruptedWarning", { gaps: 2 }),
      ),
    );
    assert.ok(
      view.textContent?.includes(copy("ruleAudit.discovery.noCandidates")),
    );
    assert.equal(
      byText<HTMLButtonElement>(
        view,
        "button",
        copy("ruleAudit.discovery.continueToRuleSelection"),
      )?.disabled,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test("failed discovery run allows explicit retry", async () => {
  setAppLocale("en");
  let run = makeRunView({ status: ASSESSMENT_DISCOVERY_RUN_STATUSES.failed });
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname === `/api/assessments/${ASSESSMENT_ID}/rules`) {
      return Response.json({ ok: true, data: catalog });
    }
    if (url.pathname.endsWith("/discovery-runs/latest")) {
      return Response.json({ ok: true, data: { available: true, run } });
    }
    if (url.pathname.endsWith("/discovery-runs") && method === "POST") {
      postCount += 1;
      run = makeRunView({
        status: ASSESSMENT_DISCOVERY_RUN_STATUSES.completed,
        includeQuestion: false,
      });
      return Response.json({ ok: true, data: run });
    }
    if (url.pathname.endsWith("/details")) {
      return Response.json({
        ok: true,
        data: {
          recordId: "55555555-5555-4555-8555-555555555555",
          contentDigest: DIGEST,
          collection: url.searchParams.get("collection"),
          total: 0,
          offset: 0,
          limit: 100,
          nextOffset: null,
          items: [],
        },
      });
    }
    throw new Error(`Unexpected fetch: ${method} ${url.pathname}`);
  };

  const client = createClient();
  try {
    const view = render(
      <QueryClientProvider client={client}>
        <RuleAuditPicker assessmentId={ASSESSMENT_ID} />
      </QueryClientProvider>,
    );
    await settle();

    assert.ok(view.textContent?.includes(copy("ruleAudit.discovery.failed")));
    const retryBtn = byText<HTMLButtonElement>(
      view,
      "button",
      copy("ruleAudit.discovery.retry"),
    );
    assert.ok(retryBtn);
    click(retryBtn);
    await settle();

    assert.equal(postCount, 1);
    assert.ok(view.textContent?.includes(copy("ruleAudit.discovery.progressTitle")));
  } finally {
    await client.cancelQueries();
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

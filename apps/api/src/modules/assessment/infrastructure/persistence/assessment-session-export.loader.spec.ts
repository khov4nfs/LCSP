import { describe, expect, it, jest } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import { CredentialProvider, type Prisma } from "@prisma/client";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import { ASSESSMENT_AGENT_STREAM_EVENT_TYPES } from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_SESSION_REPORT_STATES,
} from "@lcsp/contracts/assessment-domain";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  AssessmentSessionExportLoader,
  SESSION_EXPORT_SCHEMA_VERSION,
} from "./assessment-session-export.loader.js";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const commit = "a".repeat(40);

function fixture() {
  const source = {
    assessmentId,
    name: "Test Assessment",
    ownerId: "owner",
    checksumSha256: "prov-sha-256",
    contentFingerprintSha256: "prov-fingerprint",
    lifecycle: { state: ASSESSMENT_LIFECYCLE_STATES.COMPLETE },
    auditScope: {
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      totalPinned: 243,
      requested: 1,
      ready: 1,
      notRequested: 242,
    },
    pins: {
      ruleSet: { ruleSetVersionId: "rs1", version: "v1" },
      repositorySnapshotId: "pinned-snapshot",
      repositoryCommit: commit,
    },
    runtime: { startedAt: "2026-11-01T00:00:00.000Z" },
    acceptedFacts: [],
    acceptedEvidence: [
      {
        id: "ev1",
        payload: {
          path: "source/app.ts",
          commitSha: commit,
          lineStart: 1,
          lineEnd: 10,
          excerptSha256: "excerpt-hash",
        },
      },
    ],
    humanResolutions: [
      {
        requestId: "req-1",
        assessmentRuleId: "rule-1",
        dependencies: [
          { assessmentRuleId: "rule-1", criterionIds: ["criterion-1"] },
        ],
        status: HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
        answer: "Confirmed no incident",
        answeredAt: "2026-11-01T01:00:00.000Z",
      },
    ],
    decisions: [
      {
        assessmentRuleId: "rule-1",
        decisionId: "dec-1",
        decisionRevision: 1,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
      },
    ],
    coverage: [],
    events: [],
    artifacts: [] as Array<{
      artifactId: string;
      kind: string;
      lifecycleState: string;
    }>,
  };
  const snapshot = {
    id: "pinned-snapshot",
    assessmentId,
    repositoryFullName: "org/pinned-repo",
    commitSha: commit,
    branch: "main",
    sourcePathPrefix: "source",
    connection: { provider: CredentialProvider.GITHUB },
  };
  const provenance = {
    load: jest.fn(() => Promise.resolve(source)),
  };
  const reports = { load: jest.fn(() => Promise.resolve(null)) };
  const prisma = {
    assessment: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id: assessmentId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
          updatedAt: new Date("2026-11-01T02:00:00.000Z"),
          // A newer snapshot must never label an earlier pinned assessment.
          repositorySnapshots: [
            {
              id: "newer-snapshot",
              repositoryFullName: "org/newer-repo",
              commitSha: "b".repeat(40),
              branch: "next",
            },
          ],
        }),
      ),
    },
    repositorySnapshot: {
      findFirst: jest
        .fn<
          (
            args: Prisma.RepositorySnapshotFindFirstArgs,
          ) => Promise<typeof snapshot | null>
        >()
        .mockResolvedValue(snapshot),
    },
    assessmentRuntimeTurn: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: "turn-1",
            logicalRunId: "run-1",
            threadId: "thread-1",
            state: "COMPLETED",
            createdAt: new Date("2026-11-01T00:00:00.000Z"),
            updatedAt: new Date("2026-11-01T00:30:00.000Z"),
          },
        ]),
      ),
    },
    assessmentRuntimeEvent: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            runId: "run-1",
            sequence: 1,
            toolName: "agent_stream_semantic",
            durationMs: 100,
            outputSummaryJson: {
              agentStreamEvent: {
                eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult,
                toolName: "read_file",
                toolCallId: "call-1",
              },
            },
          },
        ]),
      ),
    },
    llmUsageEvent: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            status: LLM_USAGE_STATUSES.SETTLED,
            provider: "anthropic",
            model: "fixture-model",
            inputTokens: 1000n,
            outputTokens: 500n,
            totalTokens: 1500n,
          },
        ]),
      ),
    },
    assessmentEvent: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            eventType:
              AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
            payload: { toState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE },
            timestamp: new Date("2026-11-01T02:00:00.000Z"),
          },
        ]),
      ),
    },
    assessmentRule: { findMany: jest.fn(() => Promise.resolve([])) },
  };
  const loader = new AssessmentSessionExportLoader(
    prisma as never,
    provenance as never,
    reports as never,
  );
  const input = {
    assessmentId,
    sessionUserId: "owner",
    subjectRole: AUTH_USER_ROLES.customer,
    correlationId: "correlation",
  };
  return { source, snapshot, provenance, reports, prisma, loader, input };
}

describe("AssessmentSessionExportLoader", () => {
  it("preserves measured telemetry, selected audit scope and the exact pinned repository", async () => {
    const f = fixture();
    const result = await f.loader.load(f.input);
    expect(result.schemaVersion).toBe(SESSION_EXPORT_SCHEMA_VERSION);
    expect(result.session.assessmentId).toBe(assessmentId);
    expect(result.auditScope).toEqual(f.source.auditScope);
    expect(result.pins).toEqual(f.source.pins);
    expect(result.repository).toEqual({
      provider: CredentialProvider.GITHUB,
      snapshotId: "pinned-snapshot",
      fullName: "org/pinned-repo",
      commitSha: commit,
      sourcePathPrefix: "source",
      defaultBranch: "main",
    });
    expect(f.prisma.repositorySnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: "pinned-snapshot", assessmentId, commitSha: commit },
      include: { connection: { select: { provider: true } } },
    });
    expect(result.assessmentResults.finalReportStatus).toBe(
      ASSESSMENT_SESSION_REPORT_STATES.UNAVAILABLE,
    );
    expect(result.assessmentResults.decisions).toHaveLength(1);
    expect(result.humanInteraction.resolvedCount).toBe(1);
    expect(result.inputSnapshot.humanAnswerHistory[0].dependencies).toEqual(
      f.source.humanResolutions[0].dependencies,
    );
    expect(result.executionMetrics.toolCalls).toBe(1);
    expect(result.executionMetrics.observedUniqueFilesExamined).toBeNull();
    expect(result.executionMetrics.observedUniqueFilesExaminedCoverage).toBe(
      "UNAVAILABLE",
    );
    expect(result.executionMetrics.citedUniqueFilesCount).toBe(1);
    expect(result.executionHistory.fileAccessObservations).toEqual({
      coverage: "UNAVAILABLE",
      files: [],
    });
    expect(result.executionHistory.citedFileObservations.files).toEqual([
      { path: "source/app.ts" },
    ]);
    expect(result.assessmentResults.legalEvidence.coverageKind).toBe(
      "PINNED_RULE_SET_CATALOG",
    );
    expect(result.assessmentResults.legalEvidence.catalogRulesCount).toBe(0);
    expect(result.assessmentResults.legalEvidence.selectedAuditRuleCount).toBe(
      1,
    );
    expect(result.tokenUsage.totalTokens).toBe(1500);
    expect(result.tokenUsage.cachedTokens).toBeNull();
    expect(result.executionMetrics.activeDurationMs).toBeNull();
    expect(result.executionHistory.modelUsageEvents[0].totalTokens).toBe(
      "1500",
    );
    expect(result.integrity.provenanceSha256).toBe("prov-sha-256");
  });

  it.each([
    ["different snapshot", { id: "another-snapshot" }],
    ["foreign assessment", { assessmentId: "another-assessment" }],
    ["different commit", { commitSha: "b".repeat(40) }],
    ["invalid source prefix", { sourcePathPrefix: "source/../outside" }],
  ])(
    "rejects %s without substituting newer repository metadata",
    async (_label, change) => {
      const f = fixture();
      Object.assign(f.snapshot, change);
      await expect(f.loader.load(f.input)).rejects.toThrow();
    },
  );

  it("fails closed when the provenance-pinned snapshot is missing", async () => {
    const f = fixture();
    f.prisma.repositorySnapshot.findFirst.mockResolvedValueOnce(null);
    await expect(f.loader.load(f.input)).rejects.toThrow();
  });

  it("includes audit scope in the exported content fingerprint", async () => {
    const f = fixture();
    const before = await f.loader.load(f.input);
    f.source.auditScope.requested = 2;
    f.source.auditScope.notRequested = 241;
    const after = await f.loader.load(f.input);
    expect(after.integrity.contentSha256).not.toBe(
      before.integrity.contentSha256,
    );
  });

  it("authorizes canonical provenance before reading session telemetry", async () => {
    const f = fixture();
    f.provenance.load.mockRejectedValueOnce(new Error("owner denied"));
    await expect(f.loader.load(f.input)).rejects.toThrow("owner denied");
    expect(f.prisma.assessment.findUnique).not.toHaveBeenCalled();
    expect(f.prisma.repositorySnapshot.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.llmUsageEvent.findMany).not.toHaveBeenCalled();
  });

  it("exports independently persisted telemetry when only the final report is invalid", async () => {
    const f = fixture();
    f.source.artifacts.push({
      artifactId: "report",
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    });
    f.reports.load.mockRejectedValueOnce(
      problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
        "correlation",
        { status: HttpStatus.CONFLICT },
      ),
    );
    const result = await f.loader.load(f.input);
    expect(result.assessmentResults.finalReport).toBeNull();
    expect(result.assessmentResults.finalReportStatus).toBe(
      ASSESSMENT_SESSION_REPORT_STATES.UNAVAILABLE,
    );
    expect(result.tokenUsage.totalTokens).toBe(1500);
  });

  it("does not convert unrelated report failures into an incomplete success", async () => {
    const f = fixture();
    f.source.artifacts.push({
      artifactId: "report",
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    });
    f.reports.load.mockRejectedValueOnce(
      new Error("storage authorization denied"),
    );
    await expect(f.loader.load(f.input)).rejects.toThrow(
      "storage authorization denied",
    );
  });
});

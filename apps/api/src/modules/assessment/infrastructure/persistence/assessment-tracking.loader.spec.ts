import { describe, expect, it } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  TRACKING_ANOMALY_TYPES,
  TRACKING_CHANGE_TYPES,
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_TRUST_STATUSES,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentTrackingLoader } from "./assessment-tracking.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

interface MockDecision {
  id?: string;
  state?: string;
  supersededAt?: Date | null;
  invalidatedAt?: Date | null;
  [key: string]: unknown;
}

interface MockEvidence {
  id?: string;
  state?: string;
  [key: string]: unknown;
}

interface MockFact {
  id?: string;
  state?: string;
  [key: string]: unknown;
}

interface MockSnapshot {
  id?: string;
  repositoryFullName?: string;
  ref?: string;
  branch?: string;
  status?: string;
  createdAt?: string | Date;
  [key: string]: unknown;
}

interface FixtureTypes {
  assessments?: Record<string, unknown>[];
  coverage?: Record<string, unknown>[];
  decisions?: MockDecision[];
  evidence?: MockEvidence[];
  facts?: MockFact[];
  snapshots?: MockSnapshot[];
  runtimes?: Record<string, unknown>[];
  usageEvents?: Record<string, unknown>[];
  ruleCounts?: Record<string, number>;
  counts?: {
    active?: number;
    failed?: number;
    blocked?: number;
    anomalies?: number;
    unreconciled?: number;
    untrusted?: number;
  };
}

function buildLoader(fixtures: FixtureTypes) {
  const prisma = {
    assessment: {
      findMany: (args?: { skip?: number; take?: number }) => {
        const list = fixtures.assessments ?? [];
        if (args?.skip !== undefined && args?.take !== undefined) {
          return Promise.resolve(list.slice(args.skip, args.skip + args.take));
        }
        return Promise.resolve(list);
      },
      count: (args?: {
        where?: { lifecycleState?: string; OR?: unknown[] };
      }) => {
        if (args?.where?.lifecycleState === "ACTIVE") {
          return Promise.resolve(fixtures.counts?.active ?? 0);
        }
        if (args?.where?.lifecycleState === "FAILED") {
          return Promise.resolve(fixtures.counts?.failed ?? 0);
        }
        if (args?.where?.lifecycleState === "BLOCKED") {
          return Promise.resolve(fixtures.counts?.blocked ?? 0);
        }
        if (args?.where?.OR) {
          return Promise.resolve(fixtures.counts?.untrusted ?? 0);
        }
        return Promise.resolve(fixtures.assessments?.length ?? 0);
      },
    },
    assessmentDecisionCoverage: {
      findMany: () => Promise.resolve(fixtures.coverage ?? []),
    },
    assessmentRuleDecision: {
      findMany: (args?: { where?: { state?: string } }) => {
        const all = fixtures.decisions ?? [];
        if (args?.where?.state === "INVALIDATED") {
          return Promise.resolve(all.filter((d) => d.state === "INVALIDATED"));
        }
        if (args?.where?.state === "ACCEPTED") {
          return Promise.resolve(
            all.filter(
              (d) =>
                d.state === "ACCEPTED" &&
                d.supersededAt == null &&
                d.invalidatedAt == null,
            ),
          );
        }
        return Promise.resolve(all);
      },
    },
    assessmentEvidence: {
      findMany: (args?: { where?: { state?: string } }) => {
        const all = fixtures.evidence ?? [];
        if (args?.where?.state === "INVALIDATED") {
          return Promise.resolve(all.filter((e) => e.state === "INVALIDATED"));
        }
        return Promise.resolve(all);
      },
    },
    assessmentCaseFact: {
      findMany: (args?: { where?: { state?: string } }) => {
        const all = fixtures.facts ?? [];
        if (args?.where?.state === "INVALIDATED") {
          return Promise.resolve(all.filter((f) => f.state === "INVALIDATED"));
        }
        return Promise.resolve(all);
      },
    },
    repositorySnapshot: {
      findMany: (args?: { where?: { id?: { in?: string[] } } }) => {
        const all = fixtures.snapshots ?? [];
        if (args?.where?.id?.in) {
          const inIds = args.where.id.in;
          return Promise.resolve(
            all.filter((s) => typeof s.id === "string" && inIds.includes(s.id)),
          );
        }
        return Promise.resolve(all);
      },
      findFirst: (args?: {
        where?: { repositoryFullName?: string; ref?: string; status?: string };
      }) => {
        const all = fixtures.snapshots ?? [];
        const match = all
          .filter(
            (s) =>
              s.repositoryFullName === args?.where?.repositoryFullName &&
              (!args?.where?.ref ||
                s.ref === args.where.ref ||
                s.branch === args.where.ref) &&
              (!args?.where?.status || s.status === args.where.status),
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt ?? 0).getTime() -
              new Date(a.createdAt ?? 0).getTime(),
          )[0];
        return Promise.resolve(match ?? null);
      },
    },
    assessmentRule: {
      count: (args?: { where?: { ruleSetVersionId?: string } }) => {
        const vId = args?.where?.ruleSetVersionId ?? "";
        return Promise.resolve(fixtures.ruleCounts?.[vId] ?? 1);
      },
    },
    assessmentRuntime: {
      findMany: () => Promise.resolve(fixtures.runtimes ?? []),
      count: () => Promise.resolve(fixtures.counts?.anomalies ?? 0),
    },
    llmUsageEvent: {
      findMany: () => Promise.resolve(fixtures.usageEvents ?? []),
      count: () => Promise.resolve(fixtures.counts?.unreconciled ?? 0),
    },
  } as unknown as PrismaService;

  return new AssessmentTrackingLoader(prisma);
}

describe("AssessmentTrackingLoader", () => {
  describe("loadCustomerOverview", () => {
    it("returns empty overview when user role is not CUSTOMER", async () => {
      const loader = buildLoader({});
      const result = await loader.loadCustomerOverview({
        sessionUserId: "admin-1",
        subjectRole: AUTH_USER_ROLES.admin,
        correlationId: "corr-admin",
      });

      expect(result.actions).toEqual([]);
      expect(result.changes).toEqual([]);
      expect(result.assessments).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.complianceSummary.totalRulesEvaluated).toBe(0);
    });

    it("ensures accepted-but-not-current decisions cannot be counted as compliant", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Payments Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        runtime: { executionState: "SUCCEEDED", currentExecutionId: null },
        domainCase: {
          caseRevision: 1,
          pinnedAt: now,
          ruleSetVersionId: "rule-v1",
          repositorySnapshotId: "snap-1",
          repositoryScanJobId: "job-1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              createdAt: now,
              activatedAt: now,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      // Coverage row points to currentDecisionId 'dec-1' with revision 2
      const coverage = [
        {
          assessmentId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "rule-v1",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-1",
          decisionRevision: 2,
        },
      ];

      // Stale decision has revision 1 instead of 2 (revision mismatch)
      const decisions = [
        {
          decisionId: "dec-1",
          assessmentId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "rule-v1",
          decisionRevision: 1, // Mismatched revision!
          repositoryCommit: "abc1234",
          caseRevision: 1,
          state: "ACCEPTED",
          supersededAt: null,
          invalidatedAt: null,
          decision: {
            applicability: "APPLICABLE",
            compliance: "COMPLIANT",
          },
        },
      ];

      const snapshots = [
        {
          id: "snap-1",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "abc1234",
          createdAt: now,
          status: "READY",
        },
      ];

      const loader = buildLoader({
        assessments: [mockAssessment],
        coverage,
        decisions,
        snapshots,
        ruleCounts: { "rule-v1": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-inconsistent",
      });

      // Mismatched decision must not be counted as compliant; must fail closed to unresolved
      expect(result.complianceSummary.compliantCount).toBe(0);
      expect(result.complianceSummary.unresolvedCount).toBe(1);
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(result.assessments[0].trust.reason).toBe("INTEGRITY_MISMATCH");
      expect(result.assessments[0].trust.isTrustworthy).toBe(false);
    });

    it("ensures incomplete or stale pins/evidence cannot be TRUSTED", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      // Case A: Missing pinnedScanJobId
      const unpinnedAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Unpinned Assessment",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        runtime: null,
        domainCase: {
          caseRevision: 1,
          pinnedAt: now,
          ruleSetVersionId: "rule-v1",
          repositorySnapshotId: "snap-1",
          repositoryScanJobId: null, // Missing scan job pin!
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [],
        },
      };

      const loaderA = buildLoader({
        assessments: [unpinnedAssessment],
      });

      const resultA = await loaderA.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-unpinned",
      });

      expect(resultA.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(resultA.assessments[0].trust.reason).toBe("PINS_MISSING");
      expect(resultA.assessments[0].trust.isTrustworthy).toBe(false);

      // Case B: Pinned but has invalidated evidence
      const pinnedAssessment = {
        ...unpinnedAssessment,
        domainCase: {
          ...unpinnedAssessment.domainCase,
          repositoryScanJobId: "job-1",
          artifacts: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              createdAt: now,
              activatedAt: now,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      const loaderB = buildLoader({
        assessments: [pinnedAssessment],
        coverage: [
          {
            assessmentId,
            assessmentRuleId: "RULE-1",
            ruleSetVersionId: "rule-v1",
            assessmentRuleVersion: "1.0.0",
            resolutionState: "RESOLVED",
            currentDecisionId: "dec-1",
            decisionRevision: 1,
          },
        ],
        decisions: [
          {
            decisionId: "dec-1",
            assessmentId,
            assessmentRuleId: "RULE-1",
            assessmentRuleVersion: "1.0.0",
            scopeId: "ASSESSMENT",
            ruleSetVersionId: "rule-v1",
            decisionRevision: 1,
            repositoryCommit: "abc1234",
            caseRevision: 1,
            state: "ACCEPTED",
            supersededAt: null,
            invalidatedAt: null,
            decision: { applicability: "APPLICABLE", compliance: "COMPLIANT" },
          },
        ],
        evidence: [
          {
            assessmentId,
            evidenceId: "ev-1",
            state: "INVALIDATED", // Invalidated evidence!
          },
        ],
        snapshots: [
          {
            id: "snap-1",
            repositoryFullName: "acme/payments",
            ref: "main",
            commitSha: "abc1234",
            createdAt: now,
            status: "READY",
          },
        ],
      });

      const resultB = await loaderB.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-invalid-evidence",
      });

      expect(resultB.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(resultB.assessments[0].trust.reason).toBe("INTEGRITY_MISMATCH");
      expect(resultB.assessments[0].trust.isTrustworthy).toBe(false);
    });

    it("ensures newer independent repo snapshot cannot spuriously flag a different repo as stale", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");
      const later = new Date("2026-10-18T11:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Payments Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        runtime: { executionState: "SUCCEEDED", currentExecutionId: null },
        domainCase: {
          caseRevision: 1,
          pinnedAt: now,
          ruleSetVersionId: "rule-v1",
          repositorySnapshotId: "snap-payments-1",
          repositoryScanJobId: "job-1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              createdAt: now,
              activatedAt: now,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      // Snapshots: snap-payments-1 is pinned. An unrelated snapshot for 'acme/auth' was created later.
      const snapshots = [
        {
          id: "snap-payments-1",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "abc1234",
          createdAt: now,
          status: "READY",
        },
        {
          id: "snap-auth-2",
          repositoryFullName: "acme/auth", // DIFFERENT REPO!
          ref: "main",
          commitSha: "xyz9999",
          createdAt: later,
          status: "READY",
        },
      ];

      const loader = buildLoader({
        assessments: [mockAssessment],
        snapshots,
        coverage: [
          {
            assessmentId,
            assessmentRuleId: "RULE-1",
            ruleSetVersionId: "rule-v1",
            assessmentRuleVersion: "1.0.0",
            resolutionState: "RESOLVED",
            currentDecisionId: "dec-1",
            decisionRevision: 1,
          },
        ],
        decisions: [
          {
            decisionId: "dec-1",
            assessmentId,
            assessmentRuleId: "RULE-1",
            assessmentRuleVersion: "1.0.0",
            scopeId: "ASSESSMENT",
            ruleSetVersionId: "rule-v1",
            decisionRevision: 1,
            repositoryCommit: "abc1234",
            caseRevision: 1,
            state: "ACCEPTED",
            supersededAt: null,
            invalidatedAt: null,
            decision: { applicability: "APPLICABLE", compliance: "COMPLIANT" },
          },
        ],
        ruleCounts: { "rule-v1": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-multi-repo",
      });

      // Pinned repo 'acme/payments' must remain CURRENT and NOT stale!
      expect(result.assessments[0].repository.name).toBe("payments");
      expect(result.assessments[0].repository.owner).toBe("acme");
      expect(result.assessments[0].repository.pinnedCommit).toBe("abc1234");
      expect(result.assessments[0].repository.latestCommit).toBe("abc1234");
      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.CURRENT,
      );
      expect(result.assessments[0].repository.isStale).toBe(false);

      // No REASSESSMENT_REQUIRED should be emitted for payments
      expect(
        result.changes.some(
          (c) => c.changeType === TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
        ),
      ).toBe(false);
    });

    it("marks missing live ref / unpinned repository as UNKNOWN freshness", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "No Repo Assessment",
        lifecycleState: "CREATED",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        runtime: null,
        domainCase: null, // No domain case or snapshot
      };

      const loader = buildLoader({
        assessments: [mockAssessment],
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-unknown-freshness",
      });

      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.UNKNOWN,
      );
      expect(result.assessments[0].repository.isStale).toBe(false);
      expect(result.assessments[0].repository.latestCommit).toBeNull();
    });

    it("verifies user actions lead to correct UI screens and preserve request/artifact identity", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const requestId = "22222222-2222-4222-8222-222222222222";
      const artifactId = "33333333-3333-4333-8333-333333333333";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Payments Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        runtime: { executionState: "SUCCEEDED", currentExecutionId: null },
        domainCase: {
          caseRevision: 1,
          pinnedAt: now,
          ruleSetVersionId: "rule-v1",
          repositorySnapshotId: "snap-1",
          repositoryScanJobId: "job-1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [
            {
              requestId,
              assessmentRuleId: "RULE-MFA",
              question: "Is MFA enabled?",
              unresolvedFact: "MFA enforcement",
              createdAt: now,
            },
          ],
          artifacts: [
            {
              artifactId,
              createdAt: now,
              activatedAt: now,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      const loader = buildLoader({
        assessments: [mockAssessment],
        snapshots: [
          {
            id: "snap-1",
            repositoryFullName: "acme/payments",
            ref: "main",
            commitSha: "abc1234",
            createdAt: now,
            status: "READY",
          },
        ],
        ruleCounts: { "rule-v1": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-destinations",
      });

      // Human request must preserve requestId and point to assessment conversation
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].requestId).toBe(requestId);
      expect(result.actions[0].destinationUrl).toBe(
        `/assessments/${assessmentId}?requestId=${requestId}`,
      );

      // Report ready change must preserve artifactId and point to report viewer
      const reportReady = result.changes.find(
        (c) => c.changeType === TRACKING_CHANGE_TYPES.REPORT_READY,
      );
      expect(reportReady).toBeDefined();
      expect(reportReady?.destinationUrl).toBe(
        `/assessments/${assessmentId}/report?artifactId=${artifactId}`,
      );
      expect(reportReady?.titleKey).toBe(
        "assessment.tracking.reportReadyTitle",
      );
      expect(reportReady?.descriptionKey).toBe(
        "assessment.tracking.reportReadyDescription",
      );
    });

    it("ensures material changes and report readiness are lifecycle-gated and baseline-scoped", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const artifactId = "33333333-3333-4333-8333-333333333333";
      const t1 = new Date("2026-10-18T09:00:00.000Z");
      const t2 = new Date("2026-10-18T10:00:00.000Z");

      // Active report exists, but lifecycleState is ACTIVE (not COMPLETE)
      const inProgressAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "In-Progress Assessment",
        lifecycleState: "ACTIVE", // NOT complete!
        blockerReason: null,
        createdAt: t1,
        updatedAt: t1,
        runtime: { executionState: "RUNNING", currentExecutionId: null },
        domainCase: {
          caseRevision: 1,
          pinnedAt: t1,
          ruleSetVersionId: "rule-v1",
          repositorySnapshotId: "snap-1",
          repositoryScanJobId: "job-1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [
            {
              artifactId,
              createdAt: t1,
              activatedAt: t1,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      const loader = buildLoader({
        assessments: [inProgressAssessment],
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-lifecycle-gated",
      });

      // REPORT_READY must NOT be emitted because lifecycleState is not COMPLETE
      expect(
        result.changes.some(
          (c) => c.changeType === TRACKING_CHANGE_TYPES.REPORT_READY,
        ),
      ).toBe(false);
      expect(result.assessments[0].report.isReady).toBe(false);

      // Now complete the assessment, but test baseline filtering with `since`
      const completedAssessment = {
        ...inProgressAssessment,
        lifecycleState: "COMPLETE",
      };

      const loaderCompleted = buildLoader({
        assessments: [completedAssessment],
      });

      // If `since` is t2 (later than t1 report creation), report change is filtered out
      const resultWithSince = await loaderCompleted.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-since",
        since: t2.toISOString(),
      });

      expect(resultWithSince.changes).toHaveLength(0);
    });
  });

  describe("loadAdminOperational", () => {
    it("throws 403 Forbidden when called by non-admin role", async () => {
      const loader = buildLoader({});
      await expect(
        loader.loadAdminOperational({
          sessionUserId: "customer-1",
          subjectRole: AUTH_USER_ROLES.customer,
          correlationId: "corr-forbidden",
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });

    it("preserves missing token measurements as null and computes truthful durations/counts for admin", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const eventId = "44444444-4444-4444-8444-444444444444";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockImpacted = [
        {
          id: assessmentId,
          ownerId: "customer-1",
          name: "Failed Pipeline Assessment",
          lifecycleState: "FAILED",
          blockerReason: null,
          updatedAt: now,
          runtime: { executionState: "FAILED" },
          domainCase: null,
        },
      ];

      const mockRuntimes = [
        {
          assessmentId,
          currentExecutionId: "55555555-5555-4555-8555-555555555555",
          executionState: "INTERRUPTED", // Interrupted runtime!
          rootAgentVersion: "v1.2",
          assessment: { updatedAt: now },
        },
      ];

      const mockUsageEvents = [
        {
          id: eventId,
          assessmentId,
          model: "claude-3-5-sonnet",
          inputTokens: null, // Null tokens must be preserved as null!
          outputTokens: null,
          totalTokens: BigInt(200),
          status: "SETTLED",
          createdAt: now,
        },
      ];

      const loader = buildLoader({
        assessments: mockImpacted,
        runtimes: mockRuntimes,
        usageEvents: mockUsageEvents,
        counts: {
          active: 12,
          failed: 3,
          blocked: 1,
          anomalies: 8,
          unreconciled: 4,
          untrusted: 6,
        },
      });

      const result = await loader.loadAdminOperational({
        sessionUserId: "admin-1",
        subjectRole: AUTH_USER_ROLES.admin,
        correlationId: "corr-admin-op",
      });

      // Health summary uses full counts from DB, not sample lengths
      expect(result.platformHealth).toEqual({
        totalActiveAssessments: 12,
        totalFailedAssessments: 3,
        totalBlockedAssessments: 1,
        totalExecutionAnomalies: 8,
        totalUnreconciledUsageEvents: 4,
        totalUntrustedProjections: 6,
      });

      // Execution anomalies: INTERRUPTED is distinguished and has null durationSeconds
      expect(result.executionAnomalies[0].anomalyType).toBe(
        TRACKING_ANOMALY_TYPES.EXECUTION_INTERRUPTED,
      );
      expect(result.executionAnomalies[0].durationSeconds).toBeNull();

      // Unreconciled usage: missing tokens remain null (not fabricated 0)
      expect(result.unreconciledUsage[0].promptTokens).toBeNull();
      expect(result.unreconciledUsage[0].completionTokens).toBeNull();
      expect(result.unreconciledUsage[0].totalTokens).toBe(200);
      expect(result.unreconciledUsage[0].reconciled).toBe(true);
    });
  });
});

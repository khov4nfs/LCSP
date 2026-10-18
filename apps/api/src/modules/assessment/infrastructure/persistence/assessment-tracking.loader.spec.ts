import { describe, expect, it } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  TRACKING_ACTION_REASONS,
  TRACKING_ANOMALY_TYPES,
  TRACKING_CHANGE_TYPES,
  TRACKING_IMPACT_REASONS,
  TRACKING_TRUST_STATUSES,
  TRACKING_UNTRUSTED_REASONS,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentTrackingLoader } from "./assessment-tracking.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

function buildLoader(fixtures: {
  assessments?: unknown[];
  runtimes?: unknown[];
  usageEvents?: unknown[];
  counts?: { active?: number; failed?: number; blocked?: number };
}) {
  const prisma = {
    assessment: {
      findMany: () => Promise.resolve(fixtures.assessments ?? []),
      count: (args?: { where?: { lifecycleState?: string } }) => {
        if (args?.where?.lifecycleState === "ACTIVE") {
          return Promise.resolve(fixtures.counts?.active ?? 0);
        }
        if (args?.where?.lifecycleState === "FAILED") {
          return Promise.resolve(fixtures.counts?.failed ?? 0);
        }
        return Promise.resolve(fixtures.counts?.blocked ?? 0);
      },
    },
    assessmentRuntime: {
      findMany: () => Promise.resolve(fixtures.runtimes ?? []),
    },
    llmUsageEvent: {
      findMany: () => Promise.resolve(fixtures.usageEvents ?? []),
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
      expect(result.complianceSummary.totalRulesEvaluated).toBe(0);
    });

    it("aggregates actions, material changes, rule compliance, and freshness for customer", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const requestId = "22222222-2222-4222-8222-222222222222";
      const artifactId = "33333333-3333-4333-8333-333333333333";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Payments Service Assessment",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: new Date("2026-10-10T00:00:00.000Z"),
        updatedAt: now,
        runtime: {
          executionState: "SUCCEEDED",
        },
        repositorySnapshots: [
          {
            commitSha: "abc1234",
            repositoryFullName: "acme/payments",
            createdAt: now,
          },
        ],
        domainCase: {
          assessmentId,
          ruleSetVersionId: "rule-v1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
          },
          decisions: [
            {
              assessmentRuleId: "RULE-1",
              applicability: "APPLICABLE",
              compliance: "COMPLIANT",
              state: "ACCEPTED",
              supersededAt: null,
              invalidatedAt: null,
            },
            {
              assessmentRuleId: "RULE-2",
              applicability: "APPLICABLE",
              compliance: "NON_COMPLIANT",
              state: "ACCEPTED",
              supersededAt: null,
              invalidatedAt: null,
            },
            {
              assessmentRuleId: "RULE-3",
              applicability: "NOT_APPLICABLE",
              compliance: null,
              state: "ACCEPTED",
              supersededAt: null,
              invalidatedAt: null,
            },
          ],
          coverage: [
            {
              assessmentRuleId: "RULE-1",
              resolutionState: "RESOLVED",
              currentDecisionId: "dec-1",
            },
            {
              assessmentRuleId: "RULE-2",
              resolutionState: "RESOLVED",
              currentDecisionId: "dec-2",
            },
            {
              assessmentRuleId: "RULE-3",
              resolutionState: "RESOLVED",
              currentDecisionId: "dec-3",
            },
            {
              assessmentRuleId: "RULE-4",
              resolutionState: "PENDING",
              currentDecisionId: null,
            },
          ],
          humanRequests: [
            {
              requestId,
              assessmentId,
              assessmentRuleId: "RULE-4",
              question: "Does the service store CVV?",
              unresolvedFact: "CVV storage policy",
              status: "OPEN",
              createdAt: now,
            },
          ],
          artifacts: [
            {
              artifactId,
              kind: "FINAL_REPORT",
              lifecycleState: "ACTIVE",
              activatedAt: now,
              createdAt: now,
            },
          ],
        },
      };

      const loader = buildLoader({ assessments: [mockAssessment] });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-123",
      });

      // 1. Actions
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({
        requestId,
        assessmentId,
        assessmentName: "Payments Service Assessment",
        assessmentRuleId: "RULE-4",
        question: "Does the service store CVV?",
        actionReason: TRACKING_ACTION_REASONS.HUMAN_FACT_REQUIRED,
        destinationUrl: `/assessments/${assessmentId}/provenance`,
      });

      // 2. Material changes: Final Report is ready
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        assessmentId,
        changeType: TRACKING_CHANGE_TYPES.REPORT_READY,
        destinationUrl: `/assessments/${assessmentId}/provenance`,
      });

      // 3. Compliance Summary (raw rule decision counts, distinct unresolved, no synthetic score)
      expect(result.complianceSummary).toEqual({
        compliantCount: 1,
        nonCompliantCount: 1,
        notApplicableCount: 1,
        unresolvedCount: 1,
        totalRulesEvaluated: 3,
      });

      // 4. Assessment details
      expect(result.assessments).toHaveLength(1);
      const asmt = result.assessments[0];
      expect(asmt.assessmentId).toBe(assessmentId);
      expect(asmt.repository.pinnedCommit).toBe("abc1234");
      expect(asmt.repository.isStale).toBe(false);
      expect(asmt.report.hasFinalReport).toBe(true);
      expect(asmt.report.isReady).toBe(true);
      expect(asmt.pendingActionCount).toBe(1);

      // Trust status: UNRESOLVED_RULES keeps it in progress
      expect(asmt.trust.trustStatus).toBe(TRACKING_TRUST_STATUSES.IN_PROGRESS);
      expect(asmt.trust.reason).toBe("UNRESOLVED_RULES");
      expect(asmt.trust.isTrustworthy).toBe(false);
    });

    it("marks result as STALE and creates REASSESSMENT_REQUIRED change when newer snapshot commit exists", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Auth Service Assessment",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: new Date("2026-10-10T00:00:00.000Z"),
        updatedAt: now,
        runtime: { executionState: "SUCCEEDED" },
        repositorySnapshots: [
          {
            commitSha: "def5678",
            repositoryFullName: "acme/auth",
            createdAt: now,
          },
        ],
        domainCase: {
          assessmentId,
          ruleSetVersionId: "rule-v1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
          },
          decisions: [
            {
              assessmentRuleId: "RULE-1",
              applicability: "APPLICABLE",
              compliance: "COMPLIANT",
              state: "ACCEPTED",
              supersededAt: null,
              invalidatedAt: null,
            },
          ],
          coverage: [
            {
              assessmentRuleId: "RULE-1",
              resolutionState: "RESOLVED",
              currentDecisionId: "dec-1",
            },
          ],
          humanRequests: [],
          artifacts: [],
        },
      };

      const loader = buildLoader({ assessments: [mockAssessment] });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-stale",
      });

      expect(result.assessments[0].repository.isStale).toBe(true);
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.STALE,
      );
      expect(result.assessments[0].trust.reason).toBe("SOURCE_SNAPSHOT_STALE");
      expect(result.assessments[0].trust.isTrustworthy).toBe(false);

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          changeType: TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
          assessmentId,
        }),
      );
    });

    it("marks result as TRUSTED when complete, rule set active, no staleness, and coverage fully resolved", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Catalog Assessment",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: new Date("2026-10-10T00:00:00.000Z"),
        updatedAt: now,
        runtime: { executionState: "SUCCEEDED" },
        repositorySnapshots: [
          {
            commitSha: "abc1234",
            repositoryFullName: "acme/catalog",
            createdAt: now,
          },
        ],
        domainCase: {
          assessmentId,
          ruleSetVersionId: "rule-v1",
          repositoryCommit: "abc1234",
          ruleSet: {
            id: "rule-v1",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
          },
          decisions: [
            {
              assessmentRuleId: "RULE-1",
              applicability: "APPLICABLE",
              compliance: "COMPLIANT",
              state: "ACCEPTED",
              supersededAt: null,
              invalidatedAt: null,
            },
          ],
          coverage: [
            {
              assessmentRuleId: "RULE-1",
              resolutionState: "RESOLVED",
              currentDecisionId: "dec-1",
            },
          ],
          humanRequests: [],
          artifacts: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              kind: "FINAL_REPORT",
              lifecycleState: "ACTIVE",
              activatedAt: now,
              createdAt: now,
            },
          ],
        },
      };

      const loader = buildLoader({ assessments: [mockAssessment] });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-trusted",
      });

      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.TRUSTED,
      );
      expect(result.assessments[0].trust.reason).toBeNull();
      expect(result.assessments[0].trust.isTrustworthy).toBe(true);
      expect(result.assessments[0].report.isReady).toBe(true);
    });

    it("marks result as DATA_UNAVAILABLE when pins or domainCase are missing", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Empty Assessment",
        lifecycleState: "CREATED",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        runtime: null,
        repositorySnapshots: [],
        domainCase: null,
      };

      const loader = buildLoader({ assessments: [mockAssessment] });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-empty",
      });

      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(result.assessments[0].trust.reason).toBe("PINS_MISSING");
      expect(result.assessments[0].trust.isTrustworthy).toBe(false);
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

    it("aggregates platform health, impacted assessments, anomalies, and unreconciled usage for admin", async () => {
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
          executionState: "FAILED",
          rootAgentVersion: "v1.2",
        },
      ];

      const mockUsageEvents = [
        {
          id: eventId,
          assessmentId,
          model: "claude-3-5-sonnet",
          inputTokens: BigInt(500),
          outputTokens: BigInt(100),
          status: "UNAVAILABLE",
          createdAt: now,
        },
      ];

      const loader = buildLoader({
        assessments: mockImpacted,
        runtimes: mockRuntimes,
        usageEvents: mockUsageEvents,
        counts: { active: 5, failed: 1, blocked: 0 },
      });

      const result = await loader.loadAdminOperational({
        sessionUserId: "admin-1",
        subjectRole: AUTH_USER_ROLES.admin,
        correlationId: "corr-admin-op",
      });

      // Health summary
      expect(result.platformHealth).toEqual({
        totalActiveAssessments: 5,
        totalFailedAssessments: 1,
        totalBlockedAssessments: 0,
        totalExecutionAnomalies: 1,
        totalUnreconciledUsageEvents: 1,
        totalUntrustedProjections: 1,
      });

      // Impacted assessments
      expect(result.impactedAssessments).toHaveLength(1);
      expect(result.impactedAssessments[0]).toMatchObject({
        assessmentId,
        impactReason: TRACKING_IMPACT_REASONS.PLATFORM_FAILURE,
      });

      // Execution anomalies
      expect(result.executionAnomalies).toHaveLength(1);
      expect(result.executionAnomalies[0]).toMatchObject({
        assessmentId,
        anomalyType: TRACKING_ANOMALY_TYPES.EXECUTION_FAILED,
      });

      // Unreconciled usage
      expect(result.unreconciledUsage).toHaveLength(1);
      expect(result.unreconciledUsage[0]).toMatchObject({
        eventId,
        model: "claude-3-5-sonnet",
        promptTokens: 500,
        completionTokens: 100,
        reconciled: false,
      });

      // Untrusted projections
      expect(result.untrustedProjections).toHaveLength(1);
      expect(result.untrustedProjections[0]).toMatchObject({
        assessmentId,
        untrustedReason: TRACKING_UNTRUSTED_REASONS.RULE_SET_UNAVAILABLE,
      });
    });
  });
});

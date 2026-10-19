import { describe, expect, it } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ruleDecisionSchema } from "@lcsp/contracts/assessment";
import {
  TRACKING_ANOMALY_TYPES,
  TRACKING_CHANGE_TYPES,
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_TRUST_STATUSES,
  TRACKING_UNTRUSTED_REASONS,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentTrackingLoader } from "./assessment-tracking.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

interface MockDecision {
  decisionId?: string;
  assessmentId?: string;
  assessmentRuleId?: string;
  assessmentRuleVersion?: string;
  scopeId?: string;
  ruleSetVersionId?: string;
  decisionRevision?: number;
  repositoryCommit?: string;
  caseRevision?: number;
  state?: string;
  supersededAt?: Date | null;
  invalidatedAt?: Date | null;
  decision?: unknown;
  [key: string]: unknown;
}

interface MockEvidence {
  evidenceId?: string;
  assessmentId?: string;
  repositoryCommit?: string;
  state?: string;
  [key: string]: unknown;
}

interface MockFact {
  factId?: string;
  assessmentId?: string;
  caseRevision?: number;
  state?: string;
  [key: string]: unknown;
}

interface MockSnapshot {
  id?: string;
  repositoryFullName?: string;
  ref?: string;
  branch?: string;
  commitSha?: string;
  status?: string;
  createdAt?: string | Date;
  ownerId?: string;
  connectionUserId?: string;
  connectionStatus?: string;
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
  queryRawSummary?: {
    compliantCount: number;
    nonCompliantCount: number;
    notApplicableCount: number;
    unresolvedCount: number;
  };
  onFindManyDecision?: (where?: unknown) => void;
  counts?: {
    active?: number;
    failed?: number;
    blocked?: number;
    anomalies?: number;
    unreconciled?: number;
    untrusted?: number;
  };
}

function createValidCompliantDecision(overrides: Record<string, unknown> = {}) {
  const evidenceId =
    typeof overrides.evidenceId === "string"
      ? overrides.evidenceId
      : "00000000-0000-4000-8000-000000000003";
  const rest = { ...overrides };
  delete rest.evidenceId;
  return {
    assessmentRuleId: "RULE-1",
    assessmentRuleVersion: "1.0.0",
    scopeId: "ASSESSMENT",
    ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
    repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
    repositoryCommit: "a000000000000000000000000000000000000001",
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "legal-1" }],
    applicability: "APPLICABLE",
    compliance: "COMPLIANT",
    rationale: "Rule fully satisfied.",
    references: [
      {
        type: "ASSESSMENT_EVIDENCE",
        evidenceId,
      },
    ],
    criteria: [
      {
        criterionId: "crit-1",
        outcome: "MET",
        rationale: "Criterion met",
        references: [
          {
            type: "ASSESSMENT_EVIDENCE",
            evidenceId,
          },
        ],
      },
    ],
    ...rest,
  };
}

function buildLoader(fixtures: FixtureTypes) {
  const prisma = {
    $queryRaw: () => {
      if (fixtures.queryRawSummary) {
        return Promise.resolve([fixtures.queryRawSummary]);
      }
      let compliant = 0;
      let nonCompliant = 0;
      let notApplicable = 0;
      let unresolved = 0;
      const coverageList = fixtures.coverage ?? [];
      const decisionsList = fixtures.decisions ?? [];
      const decisionsMap = new Map(decisionsList.map((d) => [d.decisionId, d]));
      const assessmentsMap = new Map(
        (fixtures.assessments ?? []).map((a) => [a.id, a]),
      );

      for (const cov of coverageList) {
        const asmt = assessmentsMap.get(cov.assessmentId) as
          | {
              domainCase?: {
                repositoryCommit?: string;
                caseRevision?: number;
                ruleSetVersionId?: string;
                repositorySnapshotId?: string;
              };
            }
          | undefined;
        if (!asmt) continue;
        const d =
          typeof cov.currentDecisionId === "string"
            ? decisionsMap.get(cov.currentDecisionId)
            : null;
        if (
          !d ||
          cov.resolutionState !== "RESOLVED" ||
          d.state !== "ACCEPTED" ||
          d.supersededAt != null ||
          d.invalidatedAt != null ||
          d.caseRevision !== asmt?.domainCase?.caseRevision ||
          d.repositoryCommit?.toLowerCase() !==
            asmt?.domainCase?.repositoryCommit?.toLowerCase() ||
          d.ruleSetVersionId !== asmt?.domainCase?.ruleSetVersionId ||
          d.scopeId !== "ASSESSMENT" ||
          d.assessmentRuleVersion !== cov.assessmentRuleVersion
        ) {
          unresolved++;
          continue;
        }
        const parsed = ruleDecisionSchema.safeParse(d.decision);
        if (!parsed.success) {
          unresolved++;
          continue;
        }
        const decData = parsed.data;
        if (
          decData.assessmentRuleId !== cov.assessmentRuleId ||
          decData.assessmentRuleVersion !== cov.assessmentRuleVersion ||
          decData.scopeId !== "ASSESSMENT" ||
          decData.ruleSetVersionId !== asmt.domainCase?.ruleSetVersionId ||
          (asmt.domainCase?.repositorySnapshotId &&
            decData.repositorySnapshotId !==
              asmt.domainCase.repositorySnapshotId) ||
          decData.repositoryCommit.toLowerCase() !==
            asmt.domainCase?.repositoryCommit?.toLowerCase() ||
          decData.caseRevision !== asmt.domainCase?.caseRevision ||
          (d.applicability !== undefined &&
            decData.applicability !== (d.applicability as unknown)) ||
          (d.compliance !== undefined &&
            decData.compliance !== (d.compliance as unknown))
        ) {
          unresolved++;
          continue;
        }

        const evidenceMap = new Map(
          (fixtures.evidence ?? []).map((e) => [e.evidenceId, e]),
        );
        const factsMap = new Map(
          (fixtures.facts ?? []).map((f) => [f.factId, f]),
        );
        const allRefs = [
          ...decData.references,
          ...decData.criteria.flatMap((c) => c.references),
        ];
        let refsValid = true;
        for (const ref of allRefs) {
          if (ref.type === "ASSESSMENT_EVIDENCE") {
            const ev = evidenceMap.get(ref.evidenceId);
            if (
              !ev ||
              ev.assessmentId !== cov.assessmentId ||
              ev.state !== "ACCEPTED" ||
              ev.invalidatedAt != null ||
              ev.repositoryCommit?.toLowerCase() !==
                asmt.domainCase?.repositoryCommit?.toLowerCase()
            ) {
              refsValid = false;
              break;
            }
          } else if (ref.type === "CONFIRMED_FACT") {
            const fact = factsMap.get(ref.factId);
            if (
              !fact ||
              fact.assessmentId !== cov.assessmentId ||
              fact.state !== "ACCEPTED" ||
              fact.invalidatedAt != null ||
              fact.caseRevision !== asmt.domainCase?.caseRevision
            ) {
              refsValid = false;
              break;
            }
          }
        }
        if (!refsValid) {
          unresolved++;
          continue;
        }

        if (decData.applicability === "NOT_APPLICABLE") {
          notApplicable++;
        } else if (decData.compliance === "COMPLIANT") {
          compliant++;
        } else if (decData.compliance === "NON_COMPLIANT") {
          nonCompliant++;
        } else {
          unresolved++;
        }
      }
      return Promise.resolve([
        {
          compliantCount: compliant,
          nonCompliantCount: nonCompliant,
          notApplicableCount: notApplicable,
          unresolvedCount: unresolved,
        },
      ]);
    },
    assessment: {
      findMany: (args?: {
        skip?: number;
        take?: number;
        where?: {
          ownerId?: string;
          lifecycleState?: string;
          updatedAt?: { gte?: Date };
          domainCase?: { artifacts?: { none?: unknown } };
        };
      }) => {
        let list = fixtures.assessments ?? [];
        if (args?.where?.lifecycleState) {
          list = list.filter(
            (a) => a.lifecycleState === args.where?.lifecycleState,
          );
        }
        if (args?.where?.domainCase?.artifacts?.none) {
          list = list.filter((a) => {
            const dc = a.domainCase as
              { artifacts?: Array<Record<string, unknown>> } | undefined;
            const hasReport = dc?.artifacts?.some(
              (art) =>
                (art.kind === undefined || art.kind === "FINAL_REPORT") &&
                (art.lifecycleState === undefined ||
                  art.lifecycleState === "ACTIVE"),
            );
            return !hasReport;
          });
        }
        if (args?.skip !== undefined && args?.take !== undefined) {
          return Promise.resolve(list.slice(args.skip, args.skip + args.take));
        }
        if (args?.take !== undefined) {
          return Promise.resolve(list.slice(0, args.take));
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
    assessmentHumanRequest: {
      count: (args?: { where?: { status?: string } }) => {
        let count = 0;
        for (const a of fixtures.assessments ?? []) {
          const dc = a.domainCase as
            { humanRequests?: Array<Record<string, unknown>> } | undefined;
          if (dc?.humanRequests) {
            for (const hr of dc.humanRequests) {
              if (
                !args?.where?.status ||
                hr.status === args.where.status ||
                (!hr.status && args.where.status === "OPEN")
              ) {
                count++;
              }
            }
          }
        }
        return Promise.resolve(count);
      },
      findMany: (args?: {
        where?: { status?: string };
        skip?: number;
        take?: number;
      }) => {
        let requests: Array<Record<string, unknown>> = [];
        for (const a of fixtures.assessments ?? []) {
          const dc = a.domainCase as
            { humanRequests?: Array<Record<string, unknown>> } | undefined;
          if (dc?.humanRequests) {
            for (const hr of dc.humanRequests) {
              if (
                !args?.where?.status ||
                hr.status === args.where.status ||
                (!hr.status && args.where.status === "OPEN")
              ) {
                requests.push({
                  ...hr,
                  assessmentId: a.id,
                  assessmentCase: {
                    assessment: {
                      id: a.id,
                      name: a.name,
                    },
                  },
                });
              }
            }
          }
        }
        if (args?.skip !== undefined || args?.take !== undefined) {
          const start = args.skip ?? 0;
          const end = args.take !== undefined ? start + args.take : undefined;
          requests = requests.slice(start, end);
        }
        return Promise.resolve(requests);
      },
    },
    assessmentArtifact: {
      findMany: () => {
        const artifacts: Array<Record<string, unknown>> = [];
        for (const a of fixtures.assessments ?? []) {
          if (a.lifecycleState !== "COMPLETE") continue;
          const dc = a.domainCase as
            { artifacts?: Array<Record<string, unknown>> } | undefined;
          if (dc?.artifacts) {
            for (const art of dc.artifacts) {
              if (
                (art.kind === undefined || art.kind === "FINAL_REPORT") &&
                (art.lifecycleState === undefined ||
                  art.lifecycleState === "ACTIVE")
              ) {
                artifacts.push({
                  ...art,
                  assessmentCase: {
                    assessment: {
                      id: a.id,
                      name: a.name,
                    },
                  },
                });
              }
            }
          }
        }
        return Promise.resolve(artifacts);
      },
    },
    assessmentCase: {
      findMany: () => {
        const cases: Array<Record<string, unknown>> = [];
        for (const a of fixtures.assessments ?? []) {
          const dc = a.domainCase as Record<string, unknown> | undefined;
          if (dc && dc.repositorySnapshotId) {
            cases.push({
              assessmentId: a.id,
              repositorySnapshotId: dc.repositorySnapshotId,
              repositoryCommit: dc.repositoryCommit,
              assessment: {
                id: a.id,
                name: a.name,
                updatedAt: a.updatedAt ?? new Date(),
              },
            });
          }
        }
        return Promise.resolve(cases);
      },
    },
    assessmentDecisionCoverage: {
      findMany: () => Promise.resolve(fixtures.coverage ?? []),
    },
    assessmentRuleDecision: {
      findMany: (args?: { where?: { state?: string } }) => {
        fixtures.onFindManyDecision?.(args?.where);
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
        if (args?.where?.state === "ACCEPTED") {
          return Promise.resolve(all.filter((e) => e.state !== "INVALIDATED"));
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
        if (args?.where?.state === "ACCEPTED") {
          return Promise.resolve(all.filter((f) => f.state !== "INVALIDATED"));
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
        where?: {
          repositoryFullName?: string;
          ref?: string;
          status?: string;
          AND?: Array<Record<string, unknown>>;
          OR?: Array<{
            assessment?: { ownerId?: string };
            connection?: { userId?: string; status?: string };
          }>;
        };
      }) => {
        const where = args?.where;
        const all = fixtures.snapshots ?? [];
        const match = all
          .filter((s) => {
            if (
              where?.repositoryFullName &&
              s.repositoryFullName !== where.repositoryFullName
            )
              return false;
            if (where?.status && s.status !== where.status) return false;

            const orList: Array<{
              assessment?: { ownerId?: string };
              connection?: { userId?: string; status?: string };
            }> = [];
            let refFilter: string | undefined = undefined;

            if (where?.AND) {
              for (const cond of where.AND) {
                if (cond.OR && Array.isArray(cond.OR)) {
                  const first = cond.OR[0] as
                    { ref?: string; branch?: string } | undefined;
                  if (first && ("ref" in first || "branch" in first)) {
                    refFilter = first.ref ?? first.branch;
                  } else {
                    orList.push(
                      ...(cond.OR as Array<{
                        assessment?: { ownerId?: string };
                        connection?: { userId?: string; status?: string };
                      }>),
                    );
                  }
                }
              }
            }
            if (where?.OR) {
              orList.push(...where.OR);
            }
            if (where?.ref) {
              refFilter = where.ref;
            }

            if (refFilter && s.ref !== refFilter && s.branch !== refFilter) {
              return false;
            }

            if (orList.length > 0) {
              const matchesOr = orList.some((cond) => {
                if (s.ownerId !== undefined && cond.assessment?.ownerId) {
                  return s.ownerId === cond.assessment.ownerId;
                }
                if (
                  s.connectionUserId !== undefined &&
                  cond.connection?.userId
                ) {
                  return (
                    s.connectionUserId === cond.connection.userId &&
                    (!cond.connection.status ||
                      s.connectionStatus === cond.connection.status)
                  );
                }
                return (
                  s.ownerId === undefined && s.connectionUserId === undefined
                );
              });
              if (!matchesOr) return false;
            }
            return true;
          })
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

    it("ensures accepted-but-not-current decisions cannot be counted as compliant (revision mismatch, older case revision, malformed JSON)", async () => {
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
          caseRevision: 2, // Case is at revision 2!
          pinnedAt: now,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          repositoryCommit: "a000000000000000000000000000000000000001",
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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

      const coverage = [
        {
          assessmentId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-older-case",
          decisionRevision: 1,
        },
      ];

      // Decision is from older caseRevision 1 (whereas case is at revision 2)
      const decisions = [
        {
          decisionId: "dec-older-case",
          assessmentId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1, // Older case revision! Must be rejected by strict equality
          state: "ACCEPTED",
          supersededAt: null,
          invalidatedAt: null,
          decision: createValidCompliantDecision({ caseRevision: 1 }),
        },
      ];

      const snapshots = [
        {
          id: "00000000-0000-4000-8000-000000000002",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: now,
          status: "READY",
        },
      ];

      const loader = buildLoader({
        assessments: [mockAssessment],
        coverage,
        decisions,
        snapshots,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-older-case",
      });

      // Older case decision must fail closed to unresolved
      expect(result.complianceSummary.compliantCount).toBe(0);
      expect(result.complianceSummary.unresolvedCount).toBe(1);
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(result.assessments[0].trust.reason).toBe(
        TRACKING_UNTRUSTED_REASONS.DECISION_INCONSISTENCY,
      );
      expect(result.assessments[0].trust.isTrustworthy).toBe(false);

      // Now test malformed JSON decision
      const loaderMalformed = buildLoader({
        assessments: [
          {
            ...mockAssessment,
            domainCase: { ...mockAssessment.domainCase, caseRevision: 1 },
          },
        ],
        coverage,
        decisions: [
          {
            ...decisions[0],
            decision: { arbitrary: "invalid" }, // Malformed JSON failing ruleDecisionSchema!
          },
        ],
        snapshots,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const resultMalformed = await loaderMalformed.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-malformed-json",
      });

      expect(resultMalformed.complianceSummary.compliantCount).toBe(0);
      expect(resultMalformed.complianceSummary.unresolvedCount).toBe(1);
      expect(resultMalformed.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(resultMalformed.assessments[0].trust.reason).toBe(
        TRACKING_UNTRUSTED_REASONS.DECISION_INCONSISTENCY,
      );
    });

    it("ensures incomplete or stale pins/evidence/freshness cannot be TRUSTED", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      // Incomplete pins: repositorySnapshotId is null
      const incompleteAssessment = {
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
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: null, // MISSING PIN!
          repositoryScanJobId: "job-1",
          repositoryCommit: "a000000000000000000000000000000000000001",
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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

      const loaderA = buildLoader({
        assessments: [incompleteAssessment],
      });

      const resultA = await loaderA.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-missing-pins",
      });

      expect(resultA.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(resultA.assessments[0].trust.reason).toBe("PINS_MISSING");
      expect(resultA.assessments[0].trust.isTrustworthy).toBe(false);

      // Invalidated evidence test
      const completeAssessment = {
        ...incompleteAssessment,
        domainCase: {
          ...incompleteAssessment.domainCase,
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
        },
      };

      const loaderB = buildLoader({
        assessments: [completeAssessment],
        evidence: [
          {
            assessmentId,
            evidenceId: "00000000-0000-4000-8000-000000000003",
            state: "INVALIDATED", // Invalidated evidence!
          },
        ],
        snapshots: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            repositoryFullName: "acme/payments",
            ref: "main",
            commitSha: "a000000000000000000000000000000000000001",
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
      expect(resultB.assessments[0].trust.reason).toBe(
        TRACKING_UNTRUSTED_REASONS.DECISIONS_INVALIDATED,
      );
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
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: "snap-payments-1",
          repositoryScanJobId: "job-1",
          repositoryCommit: "a000000000000000000000000000000000000001",
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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

      // Snapshots: snap-payments-1 is pinned.
      // snap-payments-2 confirms the repo is verified at commit a000000000000000000000000000000000000001.
      // snap-auth-2 is an unrelated snapshot for 'acme/auth' with a different commit.
      const snapshots = [
        {
          id: "snap-payments-1",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: now,
          status: "READY",
        },
        {
          id: "snap-payments-2",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: later,
          status: "READY",
        },
        {
          id: "snap-auth-2",
          repositoryFullName: "acme/auth", // DIFFERENT REPO!
          ref: "main",
          commitSha: "b000000000000000000000000000000000000002",
          createdAt: later,
          status: "READY",
        },
      ];

      const loader = buildLoader({
        assessments: [mockAssessment],
        snapshots,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-multi-repo",
      });

      // Pinned repo 'acme/payments' must report UNKNOWN freshness (cached snapshot does not claim live HEAD) and NOT stale!
      expect(result.assessments[0].repository.name).toBe("payments");
      expect(result.assessments[0].repository.owner).toBe("acme");
      expect(result.assessments[0].repository.pinnedCommit).toBe(
        "a000000000000000000000000000000000000001",
      );
      expect(result.assessments[0].repository.latestCommit).toBeNull();
      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.UNKNOWN,
      );
      expect(result.assessments[0].repository.isStale).toBe(false);

      // No REASSESSMENT_REQUIRED should be emitted for payments
      expect(
        result.changes.some(
          (c) => c.changeType === TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
        ),
      ).toBe(false);
    });

    it("marks unchanged cached repository snapshot with unknown live HEAD as UNKNOWN freshness while evaluating pinned result as TRUSTED", async () => {
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
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          repositoryCommit: "a000000000000000000000000000000000000001",
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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

      // Only the pinned snapshot itself is in the DB; live remote HEAD has not been verified!
      const snapshots = [
        {
          id: "00000000-0000-4000-8000-000000000002",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: now,
          status: "READY",
        },
      ];

      const coverage = [
        {
          assessmentId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-1",
          decisionRevision: 1,
        },
      ];
      const decisions = [
        {
          decisionId: "dec-1",
          assessmentId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          decision: createValidCompliantDecision({
            repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          }),
        },
      ];
      const evidence = [
        {
          assessmentId,
          evidenceId: "00000000-0000-4000-8000-000000000003",
          repositoryCommit: "a000000000000000000000000000000000000001",
          state: "ACCEPTED",
        },
      ];

      const loader = buildLoader({
        assessments: [mockAssessment],
        coverage,
        decisions,
        evidence,
        snapshots,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
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
      // Historical result validity evaluated at pinned commit remains TRUSTED despite remote freshness UNKNOWN
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.TRUSTED,
      );
      expect(result.assessments[0].trust.reason).toBeNull();
      expect(result.assessments[0].trust.isTrustworthy).toBe(true);
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
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: "snap-1",
          repositoryScanJobId: "job-1",
          repositoryCommit: "a000000000000000000000000000000000000001",
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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
            commitSha: "a000000000000000000000000000000000000001",
            createdAt: now,
            status: "READY",
          },
        ],
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
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

    it("ensures source-change timestamp is based on observed snapshot and respects since filter", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const asmtUpdatedDate = new Date("2026-10-10T10:00:00.000Z"); // Assessment was last updated Oct 10
      const sourceObservedDate = new Date("2026-10-18T10:00:00.000Z"); // New snapshot observed Oct 18
      const sinceDate = "2026-10-17T00:00:00.000Z"; // User asks since Oct 17

      const mockAssessment = {
        id: assessmentId,
        ownerId: "customer-1",
        name: "Payments Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: asmtUpdatedDate,
        updatedAt: asmtUpdatedDate, // Assessment was not edited recently
        runtime: { executionState: "SUCCEEDED", currentExecutionId: null },
        domainCase: {
          caseRevision: 1,
          pinnedAt: asmtUpdatedDate,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: "snap-old",
          repositoryScanJobId: "job-1",
          repositoryCommit: "a000000000000000000000000000000000000001",
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [],
        },
      };

      const snapshots = [
        {
          id: "snap-old",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: asmtUpdatedDate,
          status: "READY",
        },
        {
          id: "snap-new",
          repositoryFullName: "acme/payments",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000002", // Newer commit!
          createdAt: sourceObservedDate, // Observed Oct 18
          status: "READY",
        },
      ];

      const loader = buildLoader({
        assessments: [mockAssessment],
        snapshots,
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-source-since",
        since: sinceDate,
      });

      // Even though assessment.updatedAt was Oct 10, the new commit was observed Oct 18 (> since Oct 17)
      // REASSESSMENT_REQUIRED must NOT disappear!
      const change = result.changes.find(
        (c) => c.changeType === TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
      );
      expect(change).toBeDefined();
      expect(change?.occurredAt).toBe(sourceObservedDate.toISOString());
    });

    it("computes owner-wide compliance summary consistently across paginated pages (page 2 vs owner-wide summary)", async () => {
      const now = new Date("2026-10-18T10:00:00.000Z");
      const id1 = "11111111-1111-4111-8111-111111111111";
      const id2 = "22222222-2222-4222-8222-222222222222";

      const assessment1 = {
        id: id1,
        ownerId: "customer-1",
        name: "Payments Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000011",
          repositoryScanJobId: "job-1",
          pinnedAt: now,
          humanRequests: [],
          artifacts: [],
        },
      };

      const assessment2 = {
        id: id2,
        ownerId: "customer-1",
        name: "Auth Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000012",
          repositoryScanJobId: "job-2",
          pinnedAt: now,
          humanRequests: [],
          artifacts: [],
        },
      };

      const coverage = [
        {
          assessmentId: id1,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-1",
          decisionRevision: 1,
        },
        {
          assessmentId: id2,
          assessmentRuleId: "RULE-2",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-2",
          decisionRevision: 1,
        },
      ];

      const decisions = [
        {
          decisionId: "dec-1",
          assessmentId: id1,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          decision: createValidCompliantDecision({
            assessmentRuleId: "RULE-1",
            repositorySnapshotId: "00000000-0000-4000-8000-000000000011",
          }),
        },
        {
          decisionId: "dec-2",
          assessmentId: id2,
          assessmentRuleId: "RULE-2",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          decision: createValidCompliantDecision({
            assessmentRuleId: "RULE-2",
            repositorySnapshotId: "00000000-0000-4000-8000-000000000012",
            evidenceId: "00000000-0000-4000-8000-000000000004",
          }),
        },
      ];

      const evidence = [
        {
          assessmentId: id1,
          evidenceId: "00000000-0000-4000-8000-000000000003",
          repositoryCommit: "a000000000000000000000000000000000000001",
          state: "ACCEPTED",
        },
        {
          assessmentId: id2,
          evidenceId: "00000000-0000-4000-8000-000000000004",
          repositoryCommit: "a000000000000000000000000000000000000001",
          state: "ACCEPTED",
        },
      ];

      const loader = buildLoader({
        assessments: [assessment1, assessment2],
        coverage,
        decisions,
        evidence,
      });

      // Page 1: limit 1, offset 0 -> returns assessment 1
      const page1 = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-p1",
        limit: 1,
        offset: 0,
      });

      expect(page1.assessments).toHaveLength(1);
      expect(page1.assessments[0].assessmentId).toBe(id1);
      expect(page1.pagination.total).toBe(2);
      expect(page1.complianceSummary.compliantCount).toBe(2); // Owner-wide count: 2 compliant rules

      // Page 2: limit 1, offset 1 -> returns assessment 2
      const page2 = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-p2",
        limit: 1,
        offset: 1,
      });

      expect(page2.assessments).toHaveLength(1);
      expect(page2.assessments[0].assessmentId).toBe(id2);
      expect(page2.pagination.total).toBe(2);
      // Even on page 2, complianceSummary remains identical and owner-wide!
      expect(page2.complianceSummary.compliantCount).toBe(2);
      expect(page2.complianceSummary.totalRulesEvaluated).toBe(2);
    });

    it("bounds collection read so limit=1 queries decision rows only for page assessments and relies on queryRaw for owner-wide aggregates", async () => {
      const now = new Date("2026-10-18T10:00:00.000Z");
      const assessmentsList = Array.from({ length: 25 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        ownerId: "customer-large",
        name: `Service ${i + 1}`,
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          pinnedAt: now,
          humanRequests: [],
          artifacts: [],
        },
      }));

      const findManyDecisionCalls: unknown[] = [];
      const loader = buildLoader({
        assessments: assessmentsList,
        queryRawSummary: {
          compliantCount: 25,
          nonCompliantCount: 0,
          notApplicableCount: 0,
          unresolvedCount: 0,
        },
        onFindManyDecision: (where) => {
          findManyDecisionCalls.push(where);
        },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-large",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-large-collection",
        limit: 1,
        offset: 0,
      });

      expect(result.assessments).toHaveLength(1);
      expect(result.pagination.total).toBe(25);
      expect(result.complianceSummary.compliantCount).toBe(25);
      expect(result.complianceSummary.totalRulesEvaluated).toBe(25);

      // Verify that all decision queries were bounded strictly to the 1 item on the requested page
      expect(findManyDecisionCalls).toEqual([
        {
          assessmentId: { in: [assessmentsList[0].id] },
          state: "ACCEPTED",
          supersededAt: null,
          invalidatedAt: null,
        },
        {
          assessmentId: { in: [assessmentsList[0].id] },
          state: "INVALIDATED",
        },
      ]);
    });

    it("scopes repository freshness query to customer provenance and avoids leaking other tenant's snapshots or spurious staleness", async () => {
      const now = new Date("2026-10-18T10:00:00.000Z");
      const customerAId = "customer-tenant-a";
      const customerBId = "customer-tenant-b";
      const asmtId = "11111111-1111-4111-8111-111111111111";

      const assessmentA = {
        id: asmtId,
        ownerId: customerAId,
        name: "Tenant A Repo",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          pinnedAt: now,
          humanRequests: [],
          artifacts: [],
        },
      };

      const snapshots = [
        {
          id: "00000000-0000-4000-8000-000000000002",
          repositoryFullName: "acme/shared-private-repo",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: now,
          status: "READY",
          ownerId: customerAId,
        },
        // Tenant B scans the same repo name/ref with a newer commit
        {
          id: "00000000-0000-4000-8000-000000000009",
          repositoryFullName: "acme/shared-private-repo",
          ref: "main",
          commitSha: "b999999999999999999999999999999999999999",
          createdAt: new Date("2026-10-18T10:05:00.000Z"),
          status: "READY",
          ownerId: customerBId,
        },
      ];

      const loader = buildLoader({
        assessments: [assessmentA],
        snapshots,
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: customerAId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-tenant-isolation",
      });

      // Tenant A must NOT observe or leak Tenant B's newer snapshot or commit
      expect(result.assessments[0].repository.latestCommit).toBeNull();
      expect(result.assessments[0].repository.isStale).toBe(false);
      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.UNKNOWN,
      );
      expect(
        result.changes.some(
          (c) => c.changeType === TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
        ),
      ).toBe(false);
    });

    it("distinguishes cached snapshot older than recency window from live HEAD (reporting UNKNOWN freshness) while maintaining TRUSTED result validity", async () => {
      const asmtId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");
      // Snapshot created 30 minutes ago (> 15 minutes REMOTE_FRESHNESS_RECENCY_MS)
      const olderTime = new Date(now.getTime() - 30 * 60 * 1000);

      const assessment = {
        id: asmtId,
        ownerId: "customer-1",
        name: "Repo Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: olderTime,
        updatedAt: olderTime,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          pinnedAt: olderTime,
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              createdAt: olderTime,
              activatedAt: olderTime,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      const snapshots = [
        {
          id: "00000000-0000-4000-8000-000000000002",
          repositoryFullName: "acme/repo",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: olderTime,
          status: "READY",
          ownerId: "customer-1",
        },
        // Subsequent snapshot with same commit, but created 30 minutes ago
        {
          id: "00000000-0000-4000-8000-000000000003",
          repositoryFullName: "acme/repo",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: olderTime,
          status: "READY",
          ownerId: "customer-1",
        },
      ];

      const coverage = [
        {
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-1",
          decisionRevision: 1,
        },
      ];
      const decisions = [
        {
          decisionId: "dec-1",
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          decision: createValidCompliantDecision({
            repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          }),
        },
      ];
      const evidence = [
        {
          assessmentId: asmtId,
          evidenceId: "00000000-0000-4000-8000-000000000003",
          repositoryCommit: "a000000000000000000000000000000000000001",
          state: "ACCEPTED",
        },
      ];

      const loader = buildLoader({
        assessments: [assessment],
        snapshots,
        coverage,
        decisions,
        evidence,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-recency-window",
      });

      // Older stored snapshot does NOT qualify as live HEAD: reported as UNKNOWN
      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.UNKNOWN,
      );
      expect(result.assessments[0].repository.latestCommit).toBeNull();
      expect(result.assessments[0].repository.isStale).toBe(false);

      // Pinned result remains fully TRUSTED
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.TRUSTED,
      );
      expect(result.assessments[0].trust.isTrustworthy).toBe(true);
    });

    it("fails closed when decision JSON pins mismatch domain case or coverage invariants despite matching DB columns", async () => {
      const asmtId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const assessment = {
        id: asmtId,
        ownerId: "customer-1",
        name: "Tamper Test Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          pinnedAt: now,
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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

      const coverage = [
        {
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-tampered",
          decisionRevision: 1,
        },
      ];

      // DB record columns match assessment case and coverage perfectly
      const decisions = [
        {
          decisionId: "dec-tampered",
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          // BUT decision JSON contains mismatched ruleSetVersionId and repositorySnapshotId
          decision: createValidCompliantDecision({
            ruleSetVersionId: "00000000-0000-4000-8000-000000000099",
            repositorySnapshotId: "00000000-0000-4000-8000-000000000099",
          }),
        },
      ];

      const loader = buildLoader({
        assessments: [assessment],
        coverage,
        decisions,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-tamper-json",
      });

      // Mismatched JSON pins must fail closed to unresolved on BOTH summary and detail
      expect(result.assessments[0].compliance.compliantCount).toBe(0);
      expect(result.assessments[0].compliance.unresolvedCount).toBe(1);
      expect(result.complianceSummary.compliantCount).toBe(0);
      expect(result.complianceSummary.unresolvedCount).toBe(1);

      // Trust status must be untrusted with DECISION_INCONSISTENCY
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE,
      );
      expect(result.assessments[0].trust.reason).toBe(
        TRACKING_UNTRUSTED_REASONS.DECISION_INCONSISTENCY,
      );
      expect(result.assessments[0].trust.isTrustworthy).toBe(false);
    });

    it("ensures branch and tenant predicates are both applied and newest commit on another branch does not produce false stale", async () => {
      const asmtId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");
      const later = new Date("2026-10-18T10:30:00.000Z");

      const assessment = {
        id: asmtId,
        ownerId: "customer-1",
        name: "Branch Isolation Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          pinnedAt: now,
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
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

      // Two snapshots of the same repo 'acme/repo':
      // 1. snap-main: branch 'main', matching commit a0001
      // 2. snap-feat: branch 'feature/experimental', newer commit b0002, created later
      const snapshots = [
        {
          id: "00000000-0000-4000-8000-000000000002",
          repositoryFullName: "acme/repo",
          ref: "main",
          branch: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: now,
          status: "READY",
          ownerId: "customer-1",
        },
        {
          id: "00000000-0000-4000-8000-000000000009",
          repositoryFullName: "acme/repo",
          ref: "feature/experimental",
          branch: "feature/experimental",
          commitSha: "b0000000000000000000000000000000000000002",
          createdAt: later,
          status: "READY",
          ownerId: "customer-1",
        },
      ];

      const coverage = [
        {
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-1",
          decisionRevision: 1,
        },
      ];
      const decisions = [
        {
          decisionId: "dec-1",
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          decision: createValidCompliantDecision({
            repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          }),
        },
      ];

      const evidence = [
        {
          assessmentId: asmtId,
          evidenceId: "00000000-0000-4000-8000-000000000003",
          repositoryCommit: "a000000000000000000000000000000000000001",
          state: "ACCEPTED",
        },
      ];

      const loader = buildLoader({
        assessments: [assessment],
        snapshots,
        coverage,
        decisions,
        evidence,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-branch-isolation",
      });

      // The assessment on branch 'main' must NOT be flagged stale due to the newer 'feature/experimental' snapshot!
      expect(result.assessments[0].repository.isStale).toBe(false);
      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.UNKNOWN,
      );
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.TRUSTED,
      );
      expect(
        result.changes.some(
          (c) => c.changeType === TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
        ),
      ).toBe(false);
    });

    it("ensures cached snapshot within 15 minutes cannot be asserted as live HEAD without verification", async () => {
      const asmtId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");
      // Snapshot created 2 minutes ago (< 15 minutes)
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      const assessment = {
        id: asmtId,
        ownerId: "customer-1",
        name: "Recent Snapshot Service",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: twoMinutesAgo,
        updatedAt: twoMinutesAgo,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryScanJobId: "job-1",
          pinnedAt: twoMinutesAgo,
          ruleSet: {
            id: "00000000-0000-4000-8000-000000000001",
            version: "1.0.0",
            supersededAt: null,
            lifecycleState: "ACTIVE",
            validationOutcome: "PASSED",
          },
          humanRequests: [],
          artifacts: [
            {
              artifactId: "33333333-3333-4333-8333-333333333333",
              createdAt: twoMinutesAgo,
              activatedAt: twoMinutesAgo,
              lifecycleState: "ACTIVE",
            },
          ],
        },
      };

      const snapshots = [
        {
          id: "00000000-0000-4000-8000-000000000002",
          repositoryFullName: "acme/repo",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: twoMinutesAgo,
          status: "READY",
          ownerId: "customer-1",
        },
        // Subsequent snapshot matching pinned commit, also recent (2 minutes ago)
        {
          id: "00000000-0000-4000-8000-000000000003",
          repositoryFullName: "acme/repo",
          ref: "main",
          commitSha: "a000000000000000000000000000000000000001",
          createdAt: twoMinutesAgo,
          status: "READY",
          ownerId: "customer-1",
        },
      ];

      const coverage = [
        {
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-1",
          decisionRevision: 1,
        },
      ];
      const decisions = [
        {
          decisionId: "dec-1",
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          decision: createValidCompliantDecision({
            repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          }),
        },
      ];
      const evidence = [
        {
          assessmentId: asmtId,
          evidenceId: "00000000-0000-4000-8000-000000000003",
          repositoryCommit: "a000000000000000000000000000000000000001",
          state: "ACCEPTED",
        },
      ];

      const loader = buildLoader({
        assessments: [assessment],
        snapshots,
        coverage,
        decisions,
        evidence,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-cached-snap-recent",
      });

      // Recent snapshot cannot assert live HEAD without active verification: reports UNKNOWN
      expect(result.assessments[0].repository.freshnessStatus).toBe(
        TRACKING_FRESHNESS_STATUSES.UNKNOWN,
      );
      expect(result.assessments[0].repository.latestCommit).toBeNull();
      expect(result.assessments[0].repository.isStale).toBe(false);

      // Pinned result remains TRUSTED
      expect(result.assessments[0].trust.trustStatus).toBe(
        TRACKING_TRUST_STATUSES.TRUSTED,
      );
      expect(result.assessments[0].trust.isTrustworthy).toBe(true);
    });

    it("ensures genuine zero SQL compliance aggregates never turn into page-local reductions", async () => {
      const asmtId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const assessment = {
        id: asmtId,
        ownerId: "customer-1",
        name: "Zero Aggregate Service",
        lifecycleState: "ACTIVE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          pinnedAt: now,
          humanRequests: [],
          artifacts: [],
        },
      };

      const loader = buildLoader({
        assessments: [assessment],
        queryRawSummary: {
          compliantCount: 0,
          nonCompliantCount: 0,
          notApplicableCount: 0,
          unresolvedCount: 0,
        },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-genuine-zero",
      });

      // The genuine zero counts from SQL must be preserved and not replaced
      expect(result.complianceSummary.compliantCount).toBe(0);
      expect(result.complianceSummary.nonCompliantCount).toBe(0);
      expect(result.complianceSummary.notApplicableCount).toBe(0);
      expect(result.complianceSummary.unresolvedCount).toBe(0);
      expect(result.complianceSummary.totalRulesEvaluated).toBe(0);
    });

    it("ensures owner-wide action and change queues surface pending items from assessments beyond the first page", async () => {
      const now = new Date("2026-10-18T10:00:00.000Z");
      const assessmentsList: Array<Record<string, unknown>> = [];

      // Create 50 newer assessments without requests or changes
      for (let i = 0; i < 50; i++) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        assessmentsList.push({
          id,
          ownerId: "customer-1",
          name: `Assessment ${i}`,
          lifecycleState: "ACTIVE",
          blockerReason: null,
          createdAt: new Date(now.getTime() - i * 1000),
          updatedAt: new Date(now.getTime() - i * 1000),
          domainCase: {
            caseRevision: 1,
            ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
            repositoryCommit: "a000000000000000000000000000000000000001",
            pinnedAt: now,
            humanRequests: [],
            artifacts: [],
          },
        });
      }

      // 51st assessment (oldest, pushed off page 1 when limit=50) has an OPEN human request and a ready report
      const id51 = "00000000-0000-4000-8000-000000000051";
      const reqId51 = "00000000-0000-4000-8000-000000000099";
      const artId51 = "00000000-0000-4000-8000-000000000088";
      assessmentsList.push({
        id: id51,
        ownerId: "customer-1",
        name: "Assessment 51 (Off-Page)",
        lifecycleState: "COMPLETE",
        blockerReason: null,
        createdAt: new Date(now.getTime() - 60000),
        updatedAt: new Date(now.getTime() - 60000),
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositoryCommit: "a000000000000000000000000000000000000001",
          pinnedAt: now,
          humanRequests: [
            {
              requestId: reqId51,
              assessmentRuleId: "RULE-1",
              question: "Confirm architecture boundary",
              unresolvedFact: "boundary-fact",
              status: "OPEN",
              createdAt: now,
            },
          ],
          artifacts: [
            {
              artifactId: artId51,
              kind: "FINAL_REPORT",
              lifecycleState: "ACTIVE",
              createdAt: now,
              activatedAt: now,
            },
          ],
        },
      });

      const loader = buildLoader({
        assessments: assessmentsList,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      // Request page 1 with limit=50: assessment #51 is NOT on page 1 of assessments
      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-off-page-queues",
        limit: 50,
        offset: 0,
      });

      expect(result.pagination.total).toBe(51);
      expect(result.assessments).toHaveLength(50);
      expect(result.assessments.some((a) => a.assessmentId === id51)).toBe(
        false,
      );

      // BUT the global actions queue MUST contain the open request from assessment #51!
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].requestId).toBe(reqId51);
      expect(result.actions[0].assessmentId).toBe(id51);
      expect(result.actions[0].destinationUrl).toBe(
        `/assessments/${id51}?requestId=${reqId51}`,
      );

      // AND the global changes queue MUST contain the REPORT_READY change from assessment #51!
      const reportReady = result.changes.find(
        (c) => c.changeType === TRACKING_CHANGE_TYPES.REPORT_READY,
      );
      expect(reportReady).toBeDefined();
      expect(reportReady?.assessmentId).toBe(id51);
      expect(reportReady?.destinationUrl).toBe(
        `/assessments/${id51}/report?artifactId=${artId51}`,
      );
    });

    it("ensures decisions with empty criteria or references fail closed to unresolved in both summary and per-assessment evaluation", async () => {
      const asmtId = "11111111-1111-4111-8111-111111111111";
      const now = new Date("2026-10-18T10:00:00.000Z");

      const assessment = {
        id: asmtId,
        ownerId: "customer-1",
        name: "Empty Criteria Service",
        lifecycleState: "ACTIVE",
        blockerReason: null,
        createdAt: now,
        updatedAt: now,
        domainCase: {
          caseRevision: 1,
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
          repositoryCommit: "a000000000000000000000000000000000000001",
          pinnedAt: now,
          humanRequests: [],
          artifacts: [],
        },
      };

      const coverage = [
        {
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          assessmentRuleVersion: "1.0.0",
          resolutionState: "RESOLVED",
          currentDecisionId: "dec-empty-crit",
          decisionRevision: 1,
        },
      ];

      // Stored decision JSON has APPLICABLE and COMPLIANT, but empty criteria: [] and references: []
      const decisions = [
        {
          decisionId: "dec-empty-crit",
          assessmentId: asmtId,
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "1.0.0",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
          decisionRevision: 1,
          repositoryCommit: "a000000000000000000000000000000000000001",
          caseRevision: 1,
          state: "ACCEPTED",
          applicability: "APPLICABLE",
          compliance: "COMPLIANT",
          decision: {
            assessmentRuleId: "RULE-1",
            assessmentRuleVersion: "1.0.0",
            scopeId: "ASSESSMENT",
            ruleSetVersionId: "00000000-0000-4000-8000-000000000001",
            repositorySnapshotId: "00000000-0000-4000-8000-000000000002",
            repositoryCommit: "a000000000000000000000000000000000000001",
            caseRevision: 1,
            legalContextRefs: [{ legalContextId: "legal-1" }],
            applicability: "APPLICABLE",
            compliance: "COMPLIANT",
            rationale: "Rule satisfied but criteria empty",
            references: [], // VIOLATION: requires .min(1)
            criteria: [], // VIOLATION: APPLICABLE requires .min(1)
          },
        },
      ];

      const loader = buildLoader({
        assessments: [assessment],
        coverage,
        decisions,
        ruleCounts: { "00000000-0000-4000-8000-000000000001": 1 },
      });

      const result = await loader.loadCustomerOverview({
        sessionUserId: "customer-1",
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "corr-empty-criteria",
      });

      // Both per-assessment evaluation and summary MUST fail closed to UNRESOLVED!
      expect(result.assessments[0].compliance.compliantCount).toBe(0);
      expect(result.assessments[0].compliance.unresolvedCount).toBe(1);
      expect(result.complianceSummary.compliantCount).toBe(0);
      expect(result.complianceSummary.unresolvedCount).toBe(1);
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

    it("preserves missing token measurements as null and computes truthful durations from runtime timing independent of assessment.updatedAt", async () => {
      const assessmentId = "11111111-1111-4111-8111-111111111111";
      const eventId = "44444444-4444-4444-8444-444444444444";
      const now = new Date();
      const runtimeStartedAt = new Date(Date.now() - 1200 * 1000); // 20 minutes ago (1200 seconds)
      const asmtRecentlyUpdated = new Date(Date.now() - 60 * 1000); // 1 minute ago

      const mockImpacted = [
        {
          id: assessmentId,
          ownerId: "customer-1",
          name: "Failed Pipeline Assessment",
          lifecycleState: "FAILED",
          blockerReason: null,
          updatedAt: asmtRecentlyUpdated,
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
          startedAt: runtimeStartedAt,
          lastResumedAt: null,
          assessment: { updatedAt: asmtRecentlyUpdated },
        },
        {
          assessmentId: "66666666-6666-4666-8666-666666666666",
          currentExecutionId: "77777777-7777-4777-8777-777777777777",
          executionState: "RUNNING", // Running long-duration runtime
          rootAgentVersion: "v1.2",
          startedAt: runtimeStartedAt, // Started 1200 seconds ago
          lastResumedAt: null,
          assessment: { updatedAt: asmtRecentlyUpdated },
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

      // Long-running anomaly duration is derived from runtime.startedAt (~1200s), NOT assessment.updatedAt (~60s)!
      expect(result.executionAnomalies[1].anomalyType).toBe(
        TRACKING_ANOMALY_TYPES.ABNORMAL_RUNTIME_DURATION,
      );
      expect(
        result.executionAnomalies[1].durationSeconds,
      ).toBeGreaterThanOrEqual(1200);

      // Unreconciled usage: missing tokens remain null (not fabricated 0)
      expect(result.unreconciledUsage[0].promptTokens).toBeNull();
      expect(result.unreconciledUsage[0].completionTokens).toBeNull();
      expect(result.unreconciledUsage[0].totalTokens).toBe(200);
      expect(result.unreconciledUsage[0].reconciled).toBe(true);
    });
  });
});

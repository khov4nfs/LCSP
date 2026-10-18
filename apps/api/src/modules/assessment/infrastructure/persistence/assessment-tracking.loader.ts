import { Injectable, HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  AGENT_EXECUTION_STATES,
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_RECORD_STATES,
  ASSESSMENT_DECISION_RECORD_STATES,
  TRACKING_ACTION_REASONS,
  TRACKING_ANOMALY_TYPES,
  TRACKING_CHANGE_TYPES,
  TRACKING_IMPACT_REASONS,
  TRACKING_TRUST_STATUSES,
  TRACKING_UNTRUSTED_REASONS,
  customerTrackingPortfolioSchema,
  adminTrackingOperationalSchema,
  type CustomerTrackingPortfolio,
  type AdminTrackingOperational,
  type CustomerTrackingActionItem,
  type CustomerTrackingChangeItem,
  type CustomerTrackingAssessmentItem,
  type AdminTrackingImpactedAssessment,
  type AdminTrackingExecutionAnomaly,
  type AdminTrackingUnreconciledUsage,
  type AdminTrackingUntrustedProjection,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";

/**
 * Authoritative read-model loader for LCSP Tracking Dashboard.
 *
 * Provides portfolio projections for customers (actions, material changes, rule decisions,
 * report readiness, and result freshness) and operational health projections for platform admins.
 */
@Injectable()
export class AssessmentTrackingLoader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads customer portfolio tracking data with strict tenant isolation.
   *
   * @param input.sessionUserId - Authenticated user ID (must match assessment ownerId).
   * @param input.subjectRole - Requesting role.
   * @param input.correlationId - Request correlation identifier.
   */
  async loadCustomerPortfolio(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
  }): Promise<CustomerTrackingPortfolio> {
    const now = new Date();

    if (input.subjectRole !== AUTH_USER_ROLES.customer) {
      return customerTrackingPortfolioSchema.parse({
        actions: [],
        changes: [],
        complianceSummary: {
          compliantCount: 0,
          nonCompliantCount: 0,
          notApplicableCount: 0,
          unresolvedCount: 0,
          totalRulesEvaluated: 0,
        },
        assessments: [],
        correlationId: input.correlationId,
        generatedAt: now.toISOString(),
      });
    }

    // Fetch all assessments owned by the authenticated customer with related domain records
    const assessments = await this.prisma.assessment.findMany({
      where: {
        ownerId: input.sessionUserId,
      },
      include: {
        runtime: true,
        repositorySnapshots: {
          orderBy: { createdAt: "desc" },
          take: 2,
        },
        domainCase: {
          include: {
            ruleSet: {
              include: {
                legalSourceVersion: true,
              },
            },
            decisions: {
              where: {
                state: ASSESSMENT_RECORD_STATES.ACCEPTED,
                supersededAt: null,
                invalidatedAt: null,
              },
              orderBy: { createdAt: "asc" },
            },
            coverage: {
              orderBy: { assessmentRuleId: "asc" },
            },
            humanRequests: {
              where: {
                status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
              },
              orderBy: { createdAt: "desc" },
            },
            artifacts: {
              where: {
                kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
                lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });

    const actions: CustomerTrackingActionItem[] = [];
    const changes: CustomerTrackingChangeItem[] = [];
    const assessmentItems: CustomerTrackingAssessmentItem[] = [];

    let totalCompliant = 0;
    let totalNonCompliant = 0;
    let totalNotApplicable = 0;
    let totalUnresolved = 0;

    for (const assessment of assessments) {
      const domainCase = assessment.domainCase;
      const latestSnapshot = assessment.repositorySnapshots[0] ?? null;

      // 1. Actions: open human requests requiring customer input
      if (domainCase && domainCase.humanRequests.length > 0) {
        for (const hr of domainCase.humanRequests) {
          actions.push({
            requestId: hr.requestId,
            assessmentId: assessment.id,
            assessmentName: assessment.name,
            assessmentRuleId: hr.assessmentRuleId,
            question: hr.question,
            unresolvedFact: hr.unresolvedFact,
            actionReason: TRACKING_ACTION_REASONS.HUMAN_FACT_REQUIRED,
            createdAt: hr.createdAt.toISOString(),
            destinationUrl: `/assessments/${assessment.id}/provenance`,
          });
        }
      }

      // 2. Freshness & Staleness calculations
      const pinnedCommit = domainCase?.repositoryCommit ?? null;
      const latestCommit = latestSnapshot?.commitSha ?? pinnedCommit;
      const isStale = Boolean(
        pinnedCommit && latestCommit && pinnedCommit !== latestCommit,
      );

      // Rule set status
      const ruleSetVersionId = domainCase?.ruleSetVersionId ?? null;
      const ruleSetName = domainCase?.ruleSet?.version ?? null;
      const ruleSetVersion = domainCase?.ruleSet?.version ?? null;
      const isRuleSetCurrent = Boolean(
        domainCase?.ruleSet &&
        domainCase.ruleSet.supersededAt === null &&
        domainCase.ruleSet.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );

      // 3. Compliance evaluation from accepted rule decisions & coverage
      let asmtCompliant = 0;
      let asmtNonCompliant = 0;
      let asmtNotApplicable = 0;
      let asmtUnresolved = 0;

      if (domainCase) {
        for (const decision of domainCase.decisions) {
          if (decision.applicability === "NOT_APPLICABLE") {
            asmtNotApplicable++;
          } else if (decision.compliance === "COMPLIANT") {
            asmtCompliant++;
          } else if (decision.compliance === "NON_COMPLIANT") {
            asmtNonCompliant++;
          }
        }

        // Coverage items without a valid accepted decision are unresolved
        const acceptedRuleIds = new Set(
          domainCase.decisions.map((d) => d.assessmentRuleId),
        );
        for (const cov of domainCase.coverage) {
          if (
            cov.resolutionState === DECISION_RESOLUTION_STATES.PENDING ||
            !cov.currentDecisionId ||
            !acceptedRuleIds.has(cov.assessmentRuleId)
          ) {
            asmtUnresolved++;
          }
        }
      }

      totalCompliant += asmtCompliant;
      totalNonCompliant += asmtNonCompliant;
      totalNotApplicable += asmtNotApplicable;
      totalUnresolved += asmtUnresolved;

      // 4. Report readiness from canonical Artifact boundary
      const activeReport = domainCase?.artifacts[0] ?? null;
      const hasFinalReport = activeReport !== null;
      const finalReportArtifactId = activeReport?.artifactId ?? null;
      const finalReportCreatedAt = activeReport?.createdAt
        ? activeReport.createdAt.toISOString()
        : null;
      const isReportReady =
        hasFinalReport &&
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE;

      // 5. Material changes
      if (activeReport) {
        changes.push({
          assessmentId: assessment.id,
          assessmentName: assessment.name,
          changeType: TRACKING_CHANGE_TYPES.REPORT_READY,
          title: `Final Report available for ${assessment.name}`,
          description: "Canonical compliance report is ready for download.",
          occurredAt: (
            activeReport.activatedAt ?? activeReport.createdAt
          ).toISOString(),
          destinationUrl: `/assessments/${assessment.id}/provenance`,
        });
      }

      if (isStale && latestSnapshot) {
        changes.push({
          assessmentId: assessment.id,
          assessmentName: assessment.name,
          changeType: TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
          title: `New commit detected for ${assessment.name}`,
          description: `Repository has newer commit (${latestCommit?.slice(0, 7)}) than assessed snapshot. Reassessment required.`,
          occurredAt: latestSnapshot.createdAt.toISOString(),
          destinationUrl: `/assessments/${assessment.id}`,
        });
      } else if (
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE &&
        !activeReport
      ) {
        changes.push({
          assessmentId: assessment.id,
          assessmentName: assessment.name,
          changeType: TRACKING_CHANGE_TYPES.OUTCOME_COMPLETED,
          title: `Assessment completed for ${assessment.name}`,
          description: "Evaluation completed across canonical rules.",
          occurredAt: assessment.updatedAt.toISOString(),
          destinationUrl: `/assessments/${assessment.id}`,
        });
      }

      // 6. Trust status determination
      let trustStatus: import("@lcsp/contracts/assessment-domain").TrackingTrustStatus;
      let trustReason: string | null;
      let isTrustworthy = false;

      if (!domainCase || !pinnedCommit || !ruleSetVersionId) {
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
        trustReason = "PINS_MISSING";
      } else if (
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED ||
        assessment.blockerReason !== null
      ) {
        trustStatus = TRACKING_TRUST_STATUSES.BLOCKED;
        trustReason = assessment.blockerReason ?? "ASSESSMENT_BLOCKED";
      } else if (isStale) {
        trustStatus = TRACKING_TRUST_STATUSES.STALE;
        trustReason = TRACKING_UNTRUSTED_REASONS.SOURCE_SNAPSHOT_STALE;
      } else if (!isRuleSetCurrent) {
        trustStatus = TRACKING_TRUST_STATUSES.STALE;
        trustReason = "RULE_SET_SUPERSEDED";
      } else if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.COMPLETE
      ) {
        trustStatus = TRACKING_TRUST_STATUSES.IN_PROGRESS;
        trustReason = "ASSESSMENT_IN_PROGRESS";
      } else if (asmtUnresolved > 0) {
        trustStatus = TRACKING_TRUST_STATUSES.IN_PROGRESS;
        trustReason = "UNRESOLVED_RULES";
      } else {
        trustStatus = TRACKING_TRUST_STATUSES.TRUSTED;
        trustReason = null;
        isTrustworthy = true;
      }

      assessmentItems.push({
        assessmentId: assessment.id,
        name: assessment.name,
        lifecycleState: assessment.lifecycleState,
        executionState: assessment.runtime?.executionState ?? null,
        repository: {
          name: latestSnapshot?.repositoryFullName ?? null,
          owner: latestSnapshot?.repositoryFullName?.split("/")[0] ?? null,
          pinnedCommit,
          latestCommit,
          isStale,
        },
        ruleSet: {
          ruleSetVersionId,
          ruleSetName,
          ruleSetVersion,
          isCurrent: isRuleSetCurrent,
        },
        trust: {
          isTrustworthy,
          trustStatus,
          reason: trustReason,
        },
        compliance: {
          compliantCount: asmtCompliant,
          nonCompliantCount: asmtNonCompliant,
          notApplicableCount: asmtNotApplicable,
          unresolvedCount: asmtUnresolved,
        },
        report: {
          hasFinalReport,
          finalReportArtifactId,
          finalReportCreatedAt,
          isReady: isReportReady,
        },
        pendingActionCount: domainCase ? domainCase.humanRequests.length : 0,
        updatedAt: assessment.updatedAt.toISOString(),
      });
    }

    // Sort actions and changes by chronological order
    actions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    changes.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return customerTrackingPortfolioSchema.parse({
      actions,
      changes,
      complianceSummary: {
        compliantCount: totalCompliant,
        nonCompliantCount: totalNonCompliant,
        notApplicableCount: totalNotApplicable,
        unresolvedCount: totalUnresolved,
        totalRulesEvaluated:
          totalCompliant + totalNonCompliant + totalNotApplicable,
      },
      assessments: assessmentItems,
      correlationId: input.correlationId,
      generatedAt: now.toISOString(),
    });
  }

  /**
   * Loads operational tracking data for platform administrators.
   *
   * @param input.sessionUserId - Requesting admin user ID.
   * @param input.subjectRole - Must be ADMIN.
   * @param input.correlationId - Request correlation identifier.
   */
  async loadAdminOperational(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
  }): Promise<AdminTrackingOperational> {
    const now = new Date();

    if (input.subjectRole !== AUTH_USER_ROLES.admin) {
      throw problemException(RBAC_REASON_CODES.denied, input.correlationId, {
        status: HttpStatus.FORBIDDEN,
      });
    }

    // 1. Impacted assessments: failed, blocked, waiting for required input, or runtime execution failure
    const impactedRows = await this.prisma.assessment.findMany({
      where: {
        OR: [
          {
            lifecycleState: {
              in: [
                ASSESSMENT_LIFECYCLE_STATES.FAILED,
                ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
                ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
              ],
            },
          },
          { blockerReason: { not: null } },
          { runtime: { executionState: AGENT_EXECUTION_STATES.FAILED } },
        ],
      },
      include: {
        runtime: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    const impactedAssessments: AdminTrackingImpactedAssessment[] =
      impactedRows.map((row) => {
        let impactReason: import("@lcsp/contracts/assessment-domain").TrackingImpactReason;
        if (
          row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED ||
          row.runtime?.executionState === AGENT_EXECUTION_STATES.FAILED
        ) {
          impactReason = TRACKING_IMPACT_REASONS.PLATFORM_FAILURE;
        } else if (
          row.lifecycleState ===
          ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT
        ) {
          impactReason = TRACKING_IMPACT_REASONS.BLOCKED_ON_INPUT;
        } else if (row.blockerReason === "HUMAN_FACT_UNRESOLVABLE") {
          impactReason = TRACKING_IMPACT_REASONS.UNRESOLVABLE_FACT;
        } else {
          impactReason = TRACKING_IMPACT_REASONS.RESOURCE_UNAVAILABLE;
        }

        return {
          assessmentId: row.id,
          ownerId: row.ownerId,
          name: row.name,
          lifecycleState: row.lifecycleState,
          executionState: row.runtime?.executionState ?? null,
          blockerReason: row.blockerReason,
          impactReason,
          lastActivityAt: row.updatedAt.toISOString(),
        };
      });

    // 2. Execution anomalies: failed, paused, interrupted runtimes
    const anomalyRuntimes = await this.prisma.assessmentRuntime.findMany({
      where: {
        executionState: {
          in: [
            AGENT_EXECUTION_STATES.FAILED,
            AGENT_EXECUTION_STATES.PAUSED,
            AGENT_EXECUTION_STATES.INTERRUPTED,
          ],
        },
      },
      take: 100,
    });

    const executionAnomalies: AdminTrackingExecutionAnomaly[] =
      anomalyRuntimes.map((rt) => {
        let anomalyType: import("@lcsp/contracts/assessment-domain").TrackingAnomalyType =
          TRACKING_ANOMALY_TYPES.EXECUTION_FAILED;
        if (rt.executionState === AGENT_EXECUTION_STATES.PAUSED) {
          anomalyType = TRACKING_ANOMALY_TYPES.EXECUTION_PAUSED;
        } else if (rt.executionState === AGENT_EXECUTION_STATES.INTERRUPTED) {
          anomalyType = TRACKING_ANOMALY_TYPES.ABNORMAL_RUNTIME_DURATION;
        }

        return {
          assessmentId: rt.assessmentId,
          executionId: rt.currentExecutionId ?? null,
          executionState: rt.executionState,
          rootAgentVersion: rt.rootAgentVersion,
          anomalyType,
          durationSeconds: 0,
          detectedAt: now.toISOString(),
        };
      });

    // 3. Unreconciled usage: token usage events not settled or missing token counts
    const unreconciledRows = await this.prisma.llmUsageEvent.findMany({
      where: {
        OR: [{ status: { not: "SETTLED" } }, { totalTokens: null }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const unreconciledUsage: AdminTrackingUnreconciledUsage[] =
      unreconciledRows.map((u) => ({
        eventId: u.id,
        assessmentId: u.assessmentId,
        model: u.model,
        promptTokens: Number(u.inputTokens ?? 0),
        completionTokens: Number(u.outputTokens ?? 0),
        reconciled: u.status === "SETTLED",
        createdAt: u.createdAt.toISOString(),
      }));

    // 4. Untrusted projections: assessments missing pins or having invalidated decisions/evidence
    const untrustedRows = await this.prisma.assessment.findMany({
      where: {
        OR: [
          { domainCase: null },
          { domainCase: { ruleSetVersionId: null } },
          { domainCase: { repositoryCommit: null } },
          {
            domainCase: {
              decisions: {
                some: { state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED },
              },
            },
          },
          {
            domainCase: {
              evidence: {
                some: { state: ASSESSMENT_RECORD_STATES.INVALIDATED },
              },
            },
          },
        ],
      },
      include: {
        domainCase: {
          include: {
            decisions: {
              where: { state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED },
              take: 1,
            },
            evidence: {
              where: { state: ASSESSMENT_RECORD_STATES.INVALIDATED },
              take: 1,
            },
          },
        },
      },
      take: 100,
    });

    const untrustedProjections: AdminTrackingUntrustedProjection[] =
      untrustedRows.map((row) => {
        let untrustedReason: import("@lcsp/contracts/assessment-domain").TrackingUntrustedReason =
          TRACKING_UNTRUSTED_REASONS.MISSING_PINS;
        let detail = "Assessment domain case is missing pins";

        if (!row.domainCase || !row.domainCase.ruleSetVersionId) {
          untrustedReason = TRACKING_UNTRUSTED_REASONS.RULE_SET_UNAVAILABLE;
          detail = "Assessment has no pinned compliance rule set version";
        } else if (!row.domainCase.repositoryCommit) {
          untrustedReason = TRACKING_UNTRUSTED_REASONS.MISSING_PINS;
          detail = "Assessment has no pinned repository commit";
        } else if (
          row.domainCase.decisions &&
          row.domainCase.decisions.length > 0
        ) {
          untrustedReason = TRACKING_UNTRUSTED_REASONS.DECISIONS_INVALIDATED;
          detail = "Assessment contains invalidated rule decisions";
        } else if (
          row.domainCase.evidence &&
          row.domainCase.evidence.length > 0
        ) {
          untrustedReason = TRACKING_UNTRUSTED_REASONS.EVIDENCE_INVALIDATED;
          detail = "Assessment contains invalidated evidence";
        }

        return {
          assessmentId: row.id,
          name: row.name,
          untrustedReason,
          detail,
          detectedAt: row.updatedAt.toISOString(),
        };
      });

    // 5. Aggregate platform health counts
    const [activeCount, failedCount, blockedCount] = await Promise.all([
      this.prisma.assessment.count({
        where: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE },
      }),
      this.prisma.assessment.count({
        where: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FAILED },
      }),
      this.prisma.assessment.count({
        where: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.BLOCKED },
      }),
    ]);

    return adminTrackingOperationalSchema.parse({
      platformHealth: {
        totalActiveAssessments: activeCount,
        totalFailedAssessments: failedCount,
        totalBlockedAssessments: blockedCount,
        totalExecutionAnomalies: executionAnomalies.length,
        totalUnreconciledUsageEvents: unreconciledUsage.length,
        totalUntrustedProjections: untrustedProjections.length,
      },
      impactedAssessments,
      executionAnomalies,
      unreconciledUsage,
      untrustedProjections,
      correlationId: input.correlationId,
      generatedAt: now.toISOString(),
    });
  }
}

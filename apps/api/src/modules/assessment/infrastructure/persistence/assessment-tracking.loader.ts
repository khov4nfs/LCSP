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
  ASSESSMENT_DECISION_SCOPE,
  TRACKING_ACTION_REASONS,
  TRACKING_ANOMALY_TYPES,
  TRACKING_CHANGE_TYPES,
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_IMPACT_REASONS,
  TRACKING_TRUST_STATUSES,
  TRACKING_UNTRUSTED_REASONS,
  customerTrackingOverviewSchema,
  adminTrackingOperationalSchema,
  type CustomerTrackingOverview,
  type AdminTrackingOperational,
  type CustomerTrackingActionItem,
  type CustomerTrackingChangeItem,
  type CustomerTrackingAssessmentItem,
  type AdminTrackingImpactedAssessment,
  type AdminTrackingExecutionAnomaly,
  type AdminTrackingUnreconciledUsage,
  type AdminTrackingUntrustedProjection,
  type TrackingAnomalyType,
  type TrackingFreshnessStatus,
  type TrackingTrustStatus,
} from "@lcsp/contracts/assessment-domain";
import { REPOSITORY_SNAPSHOT_STATUSES } from "@lcsp/contracts/github-integration";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";

/**
 * Authoritative read-model loader for LCSP Tracking Dashboard.
 *
 * Implements bounded, authoritative read projections with strict tenant isolation,
 * canonical current-decision pointer verification, exact pinned repository freshness,
 * fail-closed trust evaluation, actionable UI destinations, and bilingual support.
 */
@Injectable()
export class AssessmentTrackingLoader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads customer tracking overview data with strict tenant isolation and bounded projection.
   *
   * @param input.sessionUserId - Authenticated user ID (must match assessment ownerId).
   * @param input.subjectRole - Requesting role.
   * @param input.correlationId - Request correlation identifier.
   * @param input.limit - Max assessments to return (1-100, default 50).
   * @param input.offset - Assessments offset (default 0).
   * @param input.since - Baseline ISO datetime for material changes.
   * @param input.locale - Response locale ("en" | "vi", default "en").
   */
  async loadCustomerOverview(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    limit?: number;
    offset?: number;
    since?: string;
    locale?: string;
  }): Promise<CustomerTrackingOverview> {
    const now = new Date();
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const offset = Math.max(Number(input.offset) || 0, 0);
    const isVi = input.locale === "vi";
    const sinceTime = input.since ? new Date(input.since).getTime() : 0;

    if (input.subjectRole !== AUTH_USER_ROLES.customer) {
      return customerTrackingOverviewSchema.parse({
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
        pagination: {
          total: 0,
          limit,
          offset,
          hasMore: false,
        },
        correlationId: input.correlationId,
        generatedAt: now.toISOString(),
      });
    }

    const total = await this.prisma.assessment.count({
      where: { ownerId: input.sessionUserId },
    });

    const assessments = await this.prisma.assessment.findMany({
      where: { ownerId: input.sessionUserId },
      select: {
        id: true,
        name: true,
        lifecycleState: true,
        blockerReason: true,
        createdAt: true,
        updatedAt: true,
        runtime: {
          select: {
            executionState: true,
            currentExecutionId: true,
          },
        },
        domainCase: {
          select: {
            caseRevision: true,
            pinnedAt: true,
            ruleSetVersionId: true,
            repositorySnapshotId: true,
            repositoryScanJobId: true,
            repositoryCommit: true,
            ruleSet: {
              select: {
                id: true,
                version: true,
                supersededAt: true,
                lifecycleState: true,
                validationOutcome: true,
              },
            },
            humanRequests: {
              where: { status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN },
              orderBy: { createdAt: "desc" },
              select: {
                requestId: true,
                assessmentRuleId: true,
                question: true,
                unresolvedFact: true,
                createdAt: true,
              },
            },
            artifacts: {
              where: {
                kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
                lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                artifactId: true,
                createdAt: true,
                activatedAt: true,
                lifecycleState: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    });

    const assessmentIds = assessments.map((a) => a.id);

    // Fetch related records safely and boundedly for the retrieved page of assessments
    const [
      coverageRows,
      decisionRows,
      invalidatedDecisions,
      invalidatedEvidence,
      invalidatedFacts,
    ] =
      assessmentIds.length > 0
        ? await Promise.all([
            this.prisma.assessmentDecisionCoverage.findMany({
              where: { assessmentId: { in: assessmentIds } },
              select: {
                assessmentId: true,
                assessmentRuleId: true,
                ruleSetVersionId: true,
                assessmentRuleVersion: true,
                resolutionState: true,
                currentDecisionId: true,
                decisionRevision: true,
              },
            }),
            this.prisma.assessmentRuleDecision.findMany({
              where: {
                assessmentId: { in: assessmentIds },
                state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
                supersededAt: null,
                invalidatedAt: null,
              },
              select: {
                decisionId: true,
                assessmentId: true,
                assessmentRuleId: true,
                assessmentRuleVersion: true,
                scopeId: true,
                ruleSetVersionId: true,
                decisionRevision: true,
                repositoryCommit: true,
                caseRevision: true,
                decision: true,
              },
            }),
            this.prisma.assessmentRuleDecision.findMany({
              where: {
                assessmentId: { in: assessmentIds },
                state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
              },
              select: { assessmentId: true },
            }),
            this.prisma.assessmentEvidence.findMany({
              where: {
                assessmentId: { in: assessmentIds },
                state: ASSESSMENT_RECORD_STATES.INVALIDATED,
              },
              select: { assessmentId: true },
            }),
            this.prisma.assessmentCaseFact.findMany({
              where: {
                assessmentId: { in: assessmentIds },
                state: ASSESSMENT_RECORD_STATES.INVALIDATED,
              },
              select: { assessmentId: true },
            }),
          ])
        : [[], [], [], [], []];

    // Group coverage and decisions by assessment
    const coverageByAssessmentId = new Map<string, typeof coverageRows>();
    for (const cov of coverageRows) {
      const list = coverageByAssessmentId.get(cov.assessmentId) ?? [];
      list.push(cov);
      coverageByAssessmentId.set(cov.assessmentId, list);
    }

    const decisionsById = new Map(decisionRows.map((d) => [d.decisionId, d]));

    const invalidatedAssessmentIds = new Set([
      ...invalidatedDecisions.map((d) => d.assessmentId),
      ...invalidatedEvidence.map((e) => e.assessmentId),
      ...invalidatedFacts.map((f) => f.assessmentId),
    ]);

    // Fetch pinned snapshots for exact repository and ref resolution
    const pinnedSnapshotIds = assessments
      .map((a) => a.domainCase?.repositorySnapshotId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const pinnedSnapshots =
      pinnedSnapshotIds.length > 0
        ? await this.prisma.repositorySnapshot.findMany({
            where: { id: { in: pinnedSnapshotIds } },
            select: {
              id: true,
              repositoryFullName: true,
              ref: true,
              branch: true,
              commitSha: true,
              createdAt: true,
              status: true,
            },
          })
        : [];

    const pinnedSnapshotById = new Map(pinnedSnapshots.map((s) => [s.id, s]));

    // Query authoritative latest snapshot for each distinct (repositoryFullName, ref)
    const repoRefKeys = [
      ...new Set(
        pinnedSnapshots.map(
          (s) => `${s.repositoryFullName}::${s.ref ?? s.branch ?? ""}`,
        ),
      ),
    ];
    const latestSnapshotsByRepoRef = new Map<
      string,
      (typeof pinnedSnapshots)[0]
    >();
    for (const key of repoRefKeys) {
      const [fullName, ref] = key.split("::");
      const latest = await this.prisma.repositorySnapshot.findFirst({
        where: {
          repositoryFullName: fullName,
          ...(ref ? { OR: [{ ref }, { branch: ref }] } : {}),
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          repositoryFullName: true,
          ref: true,
          branch: true,
          commitSha: true,
          createdAt: true,
          status: true,
        },
      });
      if (latest) {
        latestSnapshotsByRepoRef.set(key, latest);
      }
    }

    // Fetch expected rule counts per ruleSetVersionId
    const ruleSetVersionIds = [
      ...new Set(
        assessments
          .map((a) => a.domainCase?.ruleSetVersionId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    ];
    const expectedRuleCounts = await Promise.all(
      ruleSetVersionIds.map(async (vId) => {
        const count = await this.prisma.assessmentRule.count({
          where: { ruleSetVersionId: vId },
        });
        return [vId, count] as const;
      }),
    );
    const expectedRuleCountByVersionId = new Map(expectedRuleCounts);

    const actions: CustomerTrackingActionItem[] = [];
    const changes: CustomerTrackingChangeItem[] = [];
    const assessmentItems: CustomerTrackingAssessmentItem[] = [];

    let totalCompliant = 0;
    let totalNonCompliant = 0;
    let totalNotApplicable = 0;
    let totalUnresolved = 0;

    for (const assessment of assessments) {
      const domainCase = assessment.domainCase;
      const asmtCoverage = coverageByAssessmentId.get(assessment.id) ?? [];

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
            destinationUrl: `/assessments/${assessment.id}?requestId=${encodeURIComponent(hr.requestId)}`,
          });
        }
      }

      // 2. Exact Pinned Repository Freshness & Staleness
      let repoOwner: string | null = null;
      let repoName: string | null = null;
      let pinnedCommit: string | null = domainCase?.repositoryCommit ?? null;
      let latestCommit: string | null = null;
      let freshnessStatus: TrackingFreshnessStatus =
        TRACKING_FRESHNESS_STATUSES.UNKNOWN;
      let isStale = false;

      if (domainCase?.repositorySnapshotId) {
        const pinned = pinnedSnapshotById.get(domainCase.repositorySnapshotId);
        if (pinned) {
          pinnedCommit = domainCase.repositoryCommit ?? pinned.commitSha;
          const parts = pinned.repositoryFullName.split("/");
          repoOwner = parts.length > 1 ? parts[0] : null;
          repoName =
            parts.length > 1
              ? parts.slice(1).join("/")
              : pinned.repositoryFullName;

          const key = `${pinned.repositoryFullName}::${pinned.ref ?? pinned.branch ?? ""}`;
          const authoritativeLatest =
            latestSnapshotsByRepoRef.get(key) ?? pinned;
          latestCommit = authoritativeLatest.commitSha;

          if (
            pinnedCommit &&
            latestCommit &&
            latestCommit.toLowerCase() !== pinnedCommit.toLowerCase()
          ) {
            freshnessStatus = TRACKING_FRESHNESS_STATUSES.STALE;
            isStale = true;
          } else if (pinnedCommit && latestCommit) {
            freshnessStatus = TRACKING_FRESHNESS_STATUSES.CURRENT;
            isStale = false;
          }
        }
      }

      // Rule set status
      const ruleSetVersionId = domainCase?.ruleSetVersionId ?? null;
      const ruleSetName = domainCase?.ruleSet?.version ?? null;
      const ruleSetVersion = domainCase?.ruleSet?.version ?? null;
      const isRuleSetCurrent = Boolean(
        domainCase?.ruleSet &&
        domainCase.ruleSet.supersededAt === null &&
        domainCase.ruleSet.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );

      // 3. Current-decision pointer resolution & validation
      let asmtCompliant = 0;
      let asmtNonCompliant = 0;
      let asmtNotApplicable = 0;
      let asmtUnresolved = 0;
      let hasDecisionInconsistency = false;

      if (domainCase && asmtCoverage.length > 0) {
        for (const cov of asmtCoverage) {
          if (
            cov.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED ||
            !cov.currentDecisionId
          ) {
            asmtUnresolved++;
            continue;
          }

          const dec = decisionsById.get(cov.currentDecisionId);
          if (
            !dec ||
            dec.assessmentId !== assessment.id ||
            dec.decisionRevision !== cov.decisionRevision ||
            dec.assessmentRuleId !== cov.assessmentRuleId ||
            dec.scopeId !== ASSESSMENT_DECISION_SCOPE ||
            dec.ruleSetVersionId !== domainCase.ruleSetVersionId ||
            dec.assessmentRuleVersion !== cov.assessmentRuleVersion ||
            dec.repositoryCommit.toLowerCase() !==
              (domainCase.repositoryCommit ?? "").toLowerCase() ||
            dec.caseRevision > domainCase.caseRevision
          ) {
            hasDecisionInconsistency = true;
            asmtUnresolved++;
            continue;
          }

          const parsed =
            typeof dec.decision === "object" && dec.decision !== null
              ? (dec.decision as Record<string, unknown>)
              : {};
          const applicability = parsed.applicability ?? "APPLICABLE";
          const compliance = parsed.compliance;

          if (applicability === "NOT_APPLICABLE") {
            asmtNotApplicable++;
          } else if (compliance === "COMPLIANT") {
            asmtCompliant++;
          } else if (compliance === "NON_COMPLIANT") {
            asmtNonCompliant++;
          } else {
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

      // 5. Material changes (lifecycle-gated and baseline-scoped)
      if (isReportReady && activeReport) {
        const reportTime = (
          activeReport.activatedAt ?? activeReport.createdAt
        ).getTime();
        if (reportTime >= sinceTime) {
          changes.push({
            assessmentId: assessment.id,
            assessmentName: assessment.name,
            changeType: TRACKING_CHANGE_TYPES.REPORT_READY,
            titleKey: "assessment.tracking.reportReadyTitle",
            descriptionKey: "assessment.tracking.reportReadyDescription",
            title: isVi
              ? `Báo cáo cuối cùng đã sẵn sàng cho ${assessment.name}`
              : `Final Report available for ${assessment.name}`,
            description: isVi
              ? "Báo cáo tuân thủ chuẩn hoá đã sẵn sàng để tải về."
              : "Canonical compliance report is ready for download.",
            occurredAt: new Date(reportTime).toISOString(),
            destinationUrl: `/assessments/${assessment.id}/report?artifactId=${encodeURIComponent(activeReport.artifactId)}`,
          });
        }
      }

      if (isStale && pinnedCommit && latestCommit) {
        const asmtUpdateTime = assessment.updatedAt.getTime();
        if (asmtUpdateTime >= sinceTime) {
          const commitPrefix = latestCommit.slice(0, 7);
          changes.push({
            assessmentId: assessment.id,
            assessmentName: assessment.name,
            changeType: TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
            titleKey: "assessment.tracking.reassessmentRequiredTitle",
            descriptionKey:
              "assessment.tracking.reassessmentRequiredDescription",
            title: isVi
              ? `Phát hiện commit mới cho ${assessment.name}`
              : `New commit detected for ${assessment.name}`,
            description: isVi
              ? `Kho mã nguồn có commit mới hơn (${commitPrefix}) so với bản chụp đã đánh giá. Cần thực hiện đánh giá lại.`
              : `Repository has newer commit (${commitPrefix}) than assessed snapshot. Reassessment required.`,
            occurredAt: assessment.updatedAt.toISOString(),
            destinationUrl: `/assessments/${assessment.id}`,
          });
        }
      } else if (
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE &&
        !activeReport
      ) {
        const asmtUpdateTime = assessment.updatedAt.getTime();
        if (asmtUpdateTime >= sinceTime) {
          changes.push({
            assessmentId: assessment.id,
            assessmentName: assessment.name,
            changeType: TRACKING_CHANGE_TYPES.OUTCOME_COMPLETED,
            titleKey: "assessment.tracking.outcomeCompletedTitle",
            descriptionKey: "assessment.tracking.outcomeCompletedDescription",
            title: isVi
              ? `Đã hoàn thành đánh giá cho ${assessment.name}`
              : `Assessment completed for ${assessment.name}`,
            description: isVi
              ? "Đánh giá đã hoàn tất trên toàn bộ các quy tắc chuẩn."
              : "Evaluation completed across canonical rules.",
            occurredAt: assessment.updatedAt.toISOString(),
            destinationUrl: `/assessments/${assessment.id}`,
          });
        }
      }

      // 6. Fail-closed Trust Status Determination
      const expectedRulesCount = domainCase?.ruleSetVersionId
        ? (expectedRuleCountByVersionId.get(domainCase.ruleSetVersionId) ?? 0)
        : 0;

      const hasCompletePins = Boolean(
        domainCase &&
        domainCase.pinnedAt &&
        domainCase.ruleSetVersionId &&
        domainCase.repositorySnapshotId &&
        domainCase.repositoryScanJobId &&
        domainCase.repositoryCommit,
      );

      const hasInvalidated = invalidatedAssessmentIds.has(assessment.id);

      let trustStatus: TrackingTrustStatus;
      let trustReason: string | null;
      let isTrustworthy = false;

      if (!hasCompletePins) {
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
      } else if (hasDecisionInconsistency || hasInvalidated) {
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
        trustReason = "INTEGRITY_MISMATCH";
      } else if (domainCase?.ruleSet?.validationOutcome !== "PASSED") {
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
        trustReason = "RULE_SET_INVALID";
      } else if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.COMPLETE
      ) {
        trustStatus = TRACKING_TRUST_STATUSES.IN_PROGRESS;
        trustReason = "ASSESSMENT_IN_PROGRESS";
      } else if (
        asmtUnresolved > 0 ||
        asmtCoverage.length === 0 ||
        (expectedRulesCount > 0 && asmtCoverage.length < expectedRulesCount)
      ) {
        trustStatus = TRACKING_TRUST_STATUSES.IN_PROGRESS;
        trustReason = "UNRESOLVED_RULES";
      } else if (!isReportReady) {
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
        trustReason = "REPORT_NOT_READY";
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
          name: repoName,
          owner: repoOwner,
          pinnedCommit,
          latestCommit,
          freshnessStatus,
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

    actions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    changes.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return customerTrackingOverviewSchema.parse({
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
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + assessments.length < total,
      },
      correlationId: input.correlationId,
      generatedAt: now.toISOString(),
    });
  }

  /**
   * Loads operational tracking data for platform administrators with accurate metrics and full counts.
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

    // 2. Execution anomalies: failed, paused, interrupted, or long-running runtimes (>900s)
    const longRunningThreshold = new Date(now.getTime() - 15 * 60 * 1000);
    const anomalyRuntimes = await this.prisma.assessmentRuntime.findMany({
      where: {
        OR: [
          {
            executionState: {
              in: [
                AGENT_EXECUTION_STATES.FAILED,
                AGENT_EXECUTION_STATES.PAUSED,
                AGENT_EXECUTION_STATES.INTERRUPTED,
              ],
            },
          },
          {
            executionState: AGENT_EXECUTION_STATES.RUNNING,
            assessment: {
              updatedAt: { lt: longRunningThreshold },
            },
          },
        ],
      },
      include: {
        assessment: { select: { updatedAt: true } },
      },
      take: 100,
    });

    const executionAnomalies: AdminTrackingExecutionAnomaly[] =
      anomalyRuntimes.map((rt) => {
        let anomalyType: TrackingAnomalyType =
          TRACKING_ANOMALY_TYPES.EXECUTION_FAILED;
        let durationSeconds: number | null = null;

        if (rt.executionState === AGENT_EXECUTION_STATES.PAUSED) {
          anomalyType = TRACKING_ANOMALY_TYPES.EXECUTION_PAUSED;
        } else if (rt.executionState === AGENT_EXECUTION_STATES.INTERRUPTED) {
          anomalyType = TRACKING_ANOMALY_TYPES.EXECUTION_INTERRUPTED;
        } else if (rt.executionState === AGENT_EXECUTION_STATES.RUNNING) {
          anomalyType = TRACKING_ANOMALY_TYPES.ABNORMAL_RUNTIME_DURATION;
          durationSeconds = Math.max(
            0,
            Math.floor(
              (now.getTime() - rt.assessment.updatedAt.getTime()) / 1000,
            ),
          );
        }

        return {
          assessmentId: rt.assessmentId,
          executionId: rt.currentExecutionId ?? null,
          executionState: rt.executionState,
          rootAgentVersion: rt.rootAgentVersion,
          anomalyType,
          durationSeconds,
          detectedAt: now.toISOString(),
        };
      });

    // 3. Unreconciled usage: token usage events not settled or missing telemetry tokens
    const unreconciledRows = await this.prisma.llmUsageEvent.findMany({
      where: {
        OR: [
          { status: { not: LLM_USAGE_STATUSES.SETTLED } },
          { totalTokens: null },
          { inputTokens: null },
          { outputTokens: null },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const unreconciledUsage: AdminTrackingUnreconciledUsage[] =
      unreconciledRows.map((u) => ({
        eventId: u.id,
        assessmentId: u.assessmentId,
        model: u.model,
        promptTokens: u.inputTokens != null ? Number(u.inputTokens) : null,
        completionTokens:
          u.outputTokens != null ? Number(u.outputTokens) : null,
        totalTokens: u.totalTokens != null ? Number(u.totalTokens) : null,
        reconciled: u.status === LLM_USAGE_STATUSES.SETTLED,
        createdAt: u.createdAt.toISOString(),
      }));

    // 4. Untrusted projections: assessments missing pins or having invalidated decisions/evidence
    const untrustedRows = await this.prisma.assessment.findMany({
      where: {
        OR: [
          { domainCase: null },
          { domainCase: { ruleSetVersionId: null } },
          { domainCase: { repositoryCommit: null } },
          { domainCase: { repositorySnapshotId: null } },
          { domainCase: { repositoryScanJobId: null } },
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

    // 5. Truthful full aggregate platform health counts (not bounded sample lengths)
    const [
      activeCount,
      failedCount,
      blockedCount,
      totalExecutionAnomalies,
      totalUnreconciledUsageEvents,
      totalUntrustedProjections,
    ] = await Promise.all([
      this.prisma.assessment.count({
        where: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE },
      }),
      this.prisma.assessment.count({
        where: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FAILED },
      }),
      this.prisma.assessment.count({
        where: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.BLOCKED },
      }),
      this.prisma.assessmentRuntime.count({
        where: {
          OR: [
            {
              executionState: {
                in: [
                  AGENT_EXECUTION_STATES.FAILED,
                  AGENT_EXECUTION_STATES.PAUSED,
                  AGENT_EXECUTION_STATES.INTERRUPTED,
                ],
              },
            },
            {
              executionState: AGENT_EXECUTION_STATES.RUNNING,
              assessment: {
                updatedAt: { lt: longRunningThreshold },
              },
            },
          ],
        },
      }),
      this.prisma.llmUsageEvent.count({
        where: {
          OR: [
            { status: { not: LLM_USAGE_STATUSES.SETTLED } },
            { totalTokens: null },
            { inputTokens: null },
            { outputTokens: null },
          ],
        },
      }),
      this.prisma.assessment.count({
        where: {
          OR: [
            { domainCase: null },
            { domainCase: { ruleSetVersionId: null } },
            { domainCase: { repositoryCommit: null } },
            { domainCase: { repositorySnapshotId: null } },
            { domainCase: { repositoryScanJobId: null } },
            {
              domainCase: {
                decisions: {
                  some: {
                    state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
                  },
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
      }),
    ]);

    return adminTrackingOperationalSchema.parse({
      platformHealth: {
        totalActiveAssessments: activeCount,
        totalFailedAssessments: failedCount,
        totalBlockedAssessments: blockedCount,
        totalExecutionAnomalies,
        totalUnreconciledUsageEvents,
        totalUntrustedProjections,
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

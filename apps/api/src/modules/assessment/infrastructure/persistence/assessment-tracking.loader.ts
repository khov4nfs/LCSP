import { Injectable, HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  AGENT_EXECUTION_STATES,
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
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
import {
  REPOSITORY_SNAPSHOT_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";

/**
 * CANONICAL INVARIANTS BOUNDARY:
 *
 * 1. Guarantees provided by the canonical writer (submitRuleDecisionHandler & DecisionValidator):
 *    - Pinned RuleSetVersion criterion completeness.
 *    - Legal-context reference identity and existence.
 *    - Evidence payload structure and search-coverage completeness.
 *    - Fact-to-evidence derivation chains.
 *
 * 2. Revalidated at read time by the tracking projection (evaluateAssessmentDecisions & $queryRaw):
 *    - Resolution pointer authority (AssessmentDecisionCoverage.currentDecisionId points to accepted record).
 *    - Schema conformance of the stored JSON packet via ruleDecisionSchema.safeParse.
 *    - Domain pin identity: ruleSetVersionId, repositorySnapshotId, repositoryCommit, caseRevision,
 *      assessmentRuleId, assessmentRuleVersion, scopeId ('ASSESSMENT').
 *    - Decision lifecycle state (state === ACCEPTED, supersededAt === null, invalidatedAt === null).
 *    - Referenced evidence & confirmed facts validity: must exist, belong to the assessment,
 *      be in ACCEPTED state (non-invalidated), and match repositoryCommit / caseRevision bounds.
 *
 * If any revalidation check fails, the decision fails closed to unresolved and the assessment trust
 * status transitions to UNTRUSTED with reason DECISION_INCONSISTENCY.
 */

interface DecisionEvaluationParams {
  assessmentId: string;
  domainCase: {
    ruleSetVersionId: string;
    caseRevision: number;
    repositoryCommit: string;
    repositorySnapshotId?: string | null;
  };
  coverage: Array<{
    assessmentId: string;
    assessmentRuleId: string;
    ruleSetVersionId: string;
    assessmentRuleVersion: string;
    resolutionState: string;
    currentDecisionId: string | null;
    decisionRevision: number | null;
  }>;
  decisionsById: Map<
    string,
    {
      decisionId: string;
      assessmentId: string;
      assessmentRuleId: string;
      assessmentRuleVersion: string;
      scopeId: string;
      ruleSetVersionId: string;
      decisionRevision: number;
      repositoryCommit: string;
      caseRevision: number;
      decision: unknown;
    }
  >;
  evidenceById?: Map<
    string,
    { assessmentId: string; repositoryCommit: string; state?: string }
  >;
  factsById?: Map<
    string,
    { assessmentId: string; caseRevision: number; state?: string }
  >;
}

function evaluateAssessmentDecisions(params: DecisionEvaluationParams): {
  compliant: number;
  nonCompliant: number;
  notApplicable: number;
  unresolved: number;
  hasDecisionInconsistency: boolean;
} {
  let compliant = 0;
  let nonCompliant = 0;
  let notApplicable = 0;
  let unresolved = 0;
  let hasDecisionInconsistency = false;

  for (const cov of params.coverage) {
    if (
      cov.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED ||
      !cov.currentDecisionId
    ) {
      unresolved++;
      continue;
    }

    const dec = params.decisionsById.get(cov.currentDecisionId);
    if (
      !dec ||
      dec.assessmentId !== params.assessmentId ||
      dec.decisionRevision !== cov.decisionRevision ||
      dec.assessmentRuleId !== cov.assessmentRuleId ||
      dec.scopeId !== ASSESSMENT_DECISION_SCOPE ||
      dec.ruleSetVersionId !== params.domainCase.ruleSetVersionId ||
      dec.assessmentRuleVersion !== cov.assessmentRuleVersion ||
      dec.repositoryCommit.toLowerCase() !==
        params.domainCase.repositoryCommit.toLowerCase() ||
      dec.caseRevision !== params.domainCase.caseRevision
    ) {
      hasDecisionInconsistency = true;
      unresolved++;
      continue;
    }

    const parsed = ruleDecisionSchema.safeParse(dec.decision);
    if (!parsed.success) {
      hasDecisionInconsistency = true;
      unresolved++;
      continue;
    }

    const d = parsed.data;
    if (
      d.assessmentRuleId !== cov.assessmentRuleId ||
      d.assessmentRuleVersion !== cov.assessmentRuleVersion ||
      d.scopeId !== ASSESSMENT_DECISION_SCOPE ||
      d.ruleSetVersionId !== params.domainCase.ruleSetVersionId ||
      (params.domainCase.repositorySnapshotId &&
        d.repositorySnapshotId !== params.domainCase.repositorySnapshotId) ||
      d.repositoryCommit.toLowerCase() !==
        params.domainCase.repositoryCommit.toLowerCase() ||
      d.caseRevision !== params.domainCase.caseRevision
    ) {
      hasDecisionInconsistency = true;
      unresolved++;
      continue;
    }

    if (params.evidenceById || params.factsById) {
      const allRefs = [
        ...d.references,
        ...d.criteria.flatMap((c) => c.references),
      ];
      let refsValid = true;
      for (const ref of allRefs) {
        if (
          params.factsById &&
          ref.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT
        ) {
          const fact = params.factsById.get(ref.factId);
          if (
            !fact ||
            fact.assessmentId !== params.assessmentId ||
            (fact.state && fact.state !== ASSESSMENT_RECORD_STATES.ACCEPTED) ||
            fact.caseRevision !== params.domainCase.caseRevision
          ) {
            refsValid = false;
            break;
          }
        } else if (
          params.evidenceById &&
          ref.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
        ) {
          const ev = params.evidenceById.get(ref.evidenceId);
          if (
            !ev ||
            ev.assessmentId !== params.assessmentId ||
            (ev.state && ev.state !== ASSESSMENT_RECORD_STATES.ACCEPTED) ||
            ev.repositoryCommit.toLowerCase() !==
              params.domainCase.repositoryCommit.toLowerCase()
          ) {
            refsValid = false;
            break;
          }
        }
      }

      if (!refsValid) {
        hasDecisionInconsistency = true;
        unresolved++;
        continue;
      }
    }

    if (d.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE) {
      notApplicable++;
    } else if (d.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT) {
      compliant++;
    } else if (
      d.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
    ) {
      nonCompliant++;
    } else {
      unresolved++;
    }
  }

  return {
    compliant,
    nonCompliant,
    notApplicable,
    unresolved,
    hasDecisionInconsistency,
  };
}

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

    const pageAssessmentIds = assessments.map((a) => a.id);

    // Fetch related records bounded strictly by the current page assessments
    const [
      allCoverageRows,
      allDecisionRows,
      activeEvidence,
      activeFacts,
      invalidatedDecisions,
      invalidatedEvidence,
      invalidatedFacts,
    ] =
      pageAssessmentIds.length > 0
        ? await Promise.all([
            this.prisma.assessmentDecisionCoverage.findMany({
              where: { assessmentId: { in: pageAssessmentIds } },
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
                assessmentId: { in: pageAssessmentIds },
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
            this.prisma.assessmentEvidence.findMany({
              where: {
                assessmentId: { in: pageAssessmentIds },
                state: ASSESSMENT_RECORD_STATES.ACCEPTED,
              },
              select: {
                evidenceId: true,
                assessmentId: true,
                repositoryCommit: true,
                state: true,
              },
            }),
            this.prisma.assessmentCaseFact.findMany({
              where: {
                assessmentId: { in: pageAssessmentIds },
                state: ASSESSMENT_RECORD_STATES.ACCEPTED,
              },
              select: {
                factId: true,
                assessmentId: true,
                caseRevision: true,
                state: true,
              },
            }),
            this.prisma.assessmentRuleDecision.findMany({
              where: {
                assessmentId: { in: pageAssessmentIds },
                state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
              },
              select: { assessmentId: true },
            }),
            this.prisma.assessmentEvidence.findMany({
              where: {
                assessmentId: { in: pageAssessmentIds },
                state: ASSESSMENT_RECORD_STATES.INVALIDATED,
              },
              select: { assessmentId: true },
            }),
            this.prisma.assessmentCaseFact.findMany({
              where: {
                assessmentId: { in: pageAssessmentIds },
                state: ASSESSMENT_RECORD_STATES.INVALIDATED,
              },
              select: { assessmentId: true },
            }),
          ])
        : [[], [], [], [], [], [], []];

    // Group coverage and decisions by assessment
    const allCoverageByAssessmentId = new Map<string, typeof allCoverageRows>();
    for (const cov of allCoverageRows) {
      const list = allCoverageByAssessmentId.get(cov.assessmentId) ?? [];
      list.push(cov);
      allCoverageByAssessmentId.set(cov.assessmentId, list);
    }

    const allDecisionsById = new Map(
      allDecisionRows.map((d) => [d.decisionId, d]),
    );

    const evidenceById = new Map(activeEvidence.map((e) => [e.evidenceId, e]));
    const factsById = new Map(activeFacts.map((f) => [f.factId, f]));

    const invalidatedAssessmentIds = new Set([
      ...invalidatedDecisions.map((d) => d.assessmentId),
      ...invalidatedEvidence.map((e) => e.assessmentId),
      ...invalidatedFacts.map((f) => f.assessmentId),
    ]);

    // Database-level grouped aggregation for owner-wide compliance summary
    let ownerCompliant = 0;
    let ownerNonCompliant = 0;
    let ownerNotApplicable = 0;
    let ownerUnresolved = 0;

    if (typeof this.prisma.$queryRaw === "function") {
      interface SummaryRow {
        compliantCount: number | bigint;
        nonCompliantCount: number | bigint;
        notApplicableCount: number | bigint;
        unresolvedCount: number | bigint;
      }
      const summaryRows = await this.prisma.$queryRaw<SummaryRow[]>`
        WITH evaluated AS (
          SELECT
            adc."assessmentId",
            adc."assessmentRuleId",
            adc."resolutionState",
            ard."decisionId",
            ard."applicability",
            ard."compliance",
            (
              adc."resolutionState" = 'RESOLVED'
              AND ard."decisionId" IS NOT NULL
              AND ard."state" = 'ACCEPTED'
              AND ard."supersededAt" IS NULL
              AND ard."invalidatedAt" IS NULL
              AND ard."caseRevision" = ac."caseRevision"
              AND LOWER(ard."repositoryCommit") = LOWER(ac."repositoryCommit")
              AND ard."ruleSetVersionId" = ac."ruleSetVersionId"
              AND ard."scopeId" = 'ASSESSMENT'
              AND ard."assessmentRuleVersion" = adc."assessmentRuleVersion"
              AND ard."decisionRevision" = adc."decisionRevision"
              AND ard."decision" IS NOT NULL
              AND jsonb_typeof(ard."decision"::jsonb) = 'object'
              AND ard."decision"->>'assessmentRuleId' = adc."assessmentRuleId"
              AND ard."decision"->>'assessmentRuleVersion' = adc."assessmentRuleVersion"
              AND ard."decision"->>'scopeId' = 'ASSESSMENT'
              AND ard."decision"->>'ruleSetVersionId' = ac."ruleSetVersionId"
              AND (ac."repositorySnapshotId" IS NULL OR ard."decision"->>'repositorySnapshotId' = ac."repositorySnapshotId")
              AND LOWER(ard."decision"->>'repositoryCommit') = LOWER(ac."repositoryCommit")
              AND ard."decision"->>'caseRevision' = ac."caseRevision"::text
              AND ard."decision"->>'applicability' = ard."applicability"::text
              AND (
                (ard."compliance" IS NULL AND ard."decision"->>'compliance' IS NULL)
                OR (ard."decision"->>'compliance' = ard."compliance"::text)
              )
              AND jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array'
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'references') = 'array'
                    THEN (ard."decision"::jsonb)->'references'
                    ELSE '[]'::jsonb END
                  ||
                  CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array'
                    THEN (
                      SELECT COALESCE(jsonb_agg(c_ref), '[]'::jsonb)
                      FROM jsonb_array_elements((ard."decision"::jsonb)->'criteria') crit,
                           jsonb_array_elements(CASE WHEN jsonb_typeof(crit->'references') = 'array' THEN crit->'references' ELSE '[]'::jsonb END) c_ref
                    )
                    ELSE '[]'::jsonb END
                ) ref
                WHERE (
                  ref->>'type' = 'ASSESSMENT_EVIDENCE'
                  AND NOT EXISTS (
                    SELECT 1 FROM "AssessmentEvidence" ae
                    WHERE ae."evidenceId"::text = ref->>'evidenceId'
                      AND ae."assessmentId" = adc."assessmentId"
                      AND ae."state" = 'ACCEPTED'
                      AND ae."invalidatedAt" IS NULL
                      AND LOWER(ae."repositoryCommit") = LOWER(ac."repositoryCommit")
                  )
                ) OR (
                  ref->>'type' = 'CONFIRMED_FACT'
                  AND NOT EXISTS (
                    SELECT 1 FROM "AssessmentCaseFact" af
                    WHERE af."factId"::text = ref->>'factId'
                      AND af."assessmentId" = adc."assessmentId"
                      AND af."state" = 'ACCEPTED'
                      AND af."invalidatedAt" IS NULL
                      AND af."caseRevision" = ac."caseRevision"
                  )
                )
              )
            ) AS is_valid
          FROM "AssessmentDecisionCoverage" adc
          JOIN "Assessment" a ON a."id" = adc."assessmentId"
          JOIN "AssessmentCase" ac ON ac."assessmentId" = adc."assessmentId"
          LEFT JOIN "AssessmentRuleDecision" ard
            ON ard."decisionId" = adc."currentDecisionId"
            AND ard."assessmentId" = adc."assessmentId"
          WHERE a."ownerId" = ${input.sessionUserId}
        )
        SELECT
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'APPLICABLE' AND "compliance" = 'COMPLIANT' THEN 1 ELSE 0 END), 0) AS "compliantCount",
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'APPLICABLE' AND "compliance" = 'NON_COMPLIANT' THEN 1 ELSE 0 END), 0) AS "nonCompliantCount",
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'NOT_APPLICABLE' THEN 1 ELSE 0 END), 0) AS "notApplicableCount",
          COALESCE(SUM(CASE WHEN is_valid = false OR ("applicability" = 'APPLICABLE' AND "compliance" NOT IN ('COMPLIANT', 'NON_COMPLIANT')) THEN 1 ELSE 0 END), 0) AS "unresolvedCount"
        FROM evaluated
      `;
      if (summaryRows && summaryRows.length > 0) {
        ownerCompliant = Number(summaryRows[0].compliantCount ?? 0);
        ownerNonCompliant = Number(summaryRows[0].nonCompliantCount ?? 0);
        ownerNotApplicable = Number(summaryRows[0].notApplicableCount ?? 0);
        ownerUnresolved = Number(summaryRows[0].unresolvedCount ?? 0);
      }
    }

    // Fetch pinned snapshots for exact repository and ref resolution for page assessments
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
      const whereConditions: Array<Record<string, unknown>> = [
        {
          OR: [
            { assessment: { ownerId: input.sessionUserId } },
            {
              connection: {
                userId: input.sessionUserId,
                status: REPOSITORY_CONNECTION_STATUSES.active,
              },
            },
          ],
        },
      ];
      if (ref) {
        whereConditions.push({
          OR: [{ ref }, { branch: ref }],
        });
      }

      const latest = await this.prisma.repositorySnapshot.findFirst({
        where: {
          repositoryFullName: fullName,
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
          AND: whereConditions,
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

    for (const assessment of assessments) {
      const domainCase = assessment.domainCase;
      const asmtCoverage = allCoverageByAssessmentId.get(assessment.id) ?? [];

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
      let authoritativeLatest: (typeof pinnedSnapshots)[0] | null = null;

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
          const foundLatest = latestSnapshotsByRepoRef.get(key);

          // An assessment result was evaluated at pinnedCommit.
          // Check remote freshness against authorized subsequent observations:
          if (foundLatest && foundLatest.id !== pinned.id) {
            authoritativeLatest = foundLatest;
            if (
              pinnedCommit &&
              foundLatest.commitSha.toLowerCase() !== pinnedCommit.toLowerCase()
            ) {
              freshnessStatus = TRACKING_FRESHNESS_STATUSES.STALE;
              isStale = true;
              latestCommit = foundLatest.commitSha;
            } else {
              freshnessStatus = TRACKING_FRESHNESS_STATUSES.UNKNOWN;
              isStale = false;
              latestCommit = null;
            }
          } else {
            freshnessStatus = TRACKING_FRESHNESS_STATUSES.UNKNOWN;
            isStale = false;
            latestCommit = null;
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

      if (
        domainCase &&
        domainCase.ruleSetVersionId &&
        domainCase.repositoryCommit &&
        asmtCoverage.length > 0
      ) {
        const evalResult = evaluateAssessmentDecisions({
          assessmentId: assessment.id,
          domainCase: {
            ruleSetVersionId: domainCase.ruleSetVersionId,
            caseRevision: domainCase.caseRevision,
            repositoryCommit: domainCase.repositoryCommit,
            repositorySnapshotId: domainCase.repositorySnapshotId,
          },
          coverage: asmtCoverage,
          decisionsById: allDecisionsById,
          evidenceById,
          factsById,
        });

        asmtCompliant = evalResult.compliant;
        asmtNonCompliant = evalResult.nonCompliant;
        asmtNotApplicable = evalResult.notApplicable;
        asmtUnresolved = evalResult.unresolved;
        hasDecisionInconsistency = evalResult.hasDecisionInconsistency;
      }

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

      // Base REASSESSMENT_REQUIRED event timestamp on the observed source snapshot, not assessment.updatedAt
      if (isStale && pinnedCommit && latestCommit) {
        const sourceChangeTime = authoritativeLatest
          ? new Date(authoritativeLatest.createdAt).getTime()
          : assessment.updatedAt.getTime();
        if (sourceChangeTime >= sinceTime) {
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
            occurredAt: (authoritativeLatest
              ? new Date(authoritativeLatest.createdAt)
              : assessment.updatedAt
            ).toISOString(),
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
      } else if (hasDecisionInconsistency || hasInvalidated) {
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
        trustReason = hasDecisionInconsistency
          ? TRACKING_UNTRUSTED_REASONS.DECISION_INCONSISTENCY
          : TRACKING_UNTRUSTED_REASONS.DECISIONS_INVALIDATED;
      } else if (isStale) {
        trustStatus = TRACKING_TRUST_STATUSES.STALE;
        trustReason = TRACKING_UNTRUSTED_REASONS.SOURCE_SNAPSHOT_STALE;
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
        compliantCount: ownerCompliant,
        nonCompliantCount: ownerNonCompliant,
        notApplicableCount: ownerNotApplicable,
        unresolvedCount: ownerUnresolved,
        totalRulesEvaluated:
          ownerCompliant + ownerNonCompliant + ownerNotApplicable,
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
            OR: [
              { lastResumedAt: { lt: longRunningThreshold } },
              { lastResumedAt: null, startedAt: { lt: longRunningThreshold } },
            ],
          },
        ],
      },
      select: {
        assessmentId: true,
        currentExecutionId: true,
        rootAgentVersion: true,
        executionState: true,
        startedAt: true,
        lastResumedAt: true,
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
          const activeStart = rt.lastResumedAt ?? rt.startedAt;
          durationSeconds = activeStart
            ? Math.max(
                0,
                Math.floor((now.getTime() - activeStart.getTime()) / 1000),
              )
            : null;
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

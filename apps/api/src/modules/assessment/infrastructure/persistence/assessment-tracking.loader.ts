import {
  BadRequestException,
  Injectable,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
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
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let currentIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        results[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

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
  private readonly logger = new Logger(AssessmentTrackingLoader.name);

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
    actionsLimit?: number;
    actionsOffset?: number;
    changesLimit?: number;
    changesOffset?: number;
    since?: string;
    locale?: string;
  }): Promise<CustomerTrackingOverview> {
    if (input.since !== undefined && input.since !== "") {
      const parsedSince = new Date(input.since);
      if (Number.isNaN(parsedSince.getTime())) {
        throw new BadRequestException(
          `Invalid since parameter: ${input.since}`,
        );
      }
    }
    if (
      input.offset !== undefined &&
      (!Number.isFinite(input.offset) ||
        !Number.isInteger(input.offset) ||
        input.offset < 0)
    ) {
      throw new BadRequestException(
        "offset must be a finite non-negative integer",
      );
    }
    if (
      input.actionsOffset !== undefined &&
      (!Number.isFinite(input.actionsOffset) ||
        !Number.isInteger(input.actionsOffset) ||
        input.actionsOffset < 0)
    ) {
      throw new BadRequestException(
        "actionsOffset must be a finite non-negative integer",
      );
    }
    if (
      input.changesOffset !== undefined &&
      (!Number.isFinite(input.changesOffset) ||
        !Number.isInteger(input.changesOffset) ||
        input.changesOffset < 0)
    ) {
      throw new BadRequestException(
        "changesOffset must be a finite non-negative integer",
      );
    }
    if (
      input.limit !== undefined &&
      (!Number.isFinite(input.limit) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100)
    ) {
      throw new BadRequestException(
        "limit must be an integer between 1 and 100",
      );
    }
    if (
      input.actionsLimit !== undefined &&
      (!Number.isFinite(input.actionsLimit) ||
        !Number.isInteger(input.actionsLimit) ||
        input.actionsLimit < 1 ||
        input.actionsLimit > 100)
    ) {
      throw new BadRequestException(
        "actionsLimit must be an integer between 1 and 100",
      );
    }
    if (
      input.changesLimit !== undefined &&
      (!Number.isFinite(input.changesLimit) ||
        !Number.isInteger(input.changesLimit) ||
        input.changesLimit < 1 ||
        input.changesLimit > 100)
    ) {
      throw new BadRequestException(
        "changesLimit must be an integer between 1 and 100",
      );
    }

    const now = new Date();
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    const offset = Math.max(Number(input.offset) || 0, 0);
    const effectiveActionsLimit = Math.min(
      Math.max(Number(input.actionsLimit) || Math.max(limit, 50), 1),
      100,
    );
    const effectiveActionsOffset = Math.max(
      Number(input.actionsOffset) || 0,
      0,
    );
    const effectiveChangesLimit = Math.min(
      Math.max(Number(input.changesLimit) || Math.max(limit, 50), 1),
      100,
    );
    const effectiveChangesOffset = Math.max(
      Number(input.changesOffset) || 0,
      0,
    );
    const isVi = input.locale === "vi";
    const sinceTime = input.since ? new Date(input.since).getTime() : 0;

    if (input.subjectRole !== AUTH_USER_ROLES.customer) {
      return customerTrackingOverviewSchema.parse({
        actions: [],
        changes: [],
        actionsPagination: {
          total: 0,
          limit: effectiveActionsLimit,
          offset: effectiveActionsOffset,
          hasMore: false,
        },
        changesPagination: {
          total: 0,
          limit: effectiveChangesLimit,
          offset: effectiveChangesOffset,
          hasMore: false,
        },
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
      try {
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
            CASE WHEN (
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
              AND ard."assessmentRuleId" = adc."assessmentRuleId"
              AND ard."decision" IS NOT NULL
              AND jsonb_typeof(ard."decision"::jsonb) = 'object'
              AND jsonb_typeof((ard."decision"::jsonb)->'assessmentRuleId') = 'string'
              AND (ard."decision"->>'assessmentRuleId') IS NOT NULL
              AND ard."decision"->>'assessmentRuleId' = adc."assessmentRuleId"
              AND jsonb_typeof((ard."decision"::jsonb)->'assessmentRuleVersion') = 'string'
              AND (ard."decision"->>'assessmentRuleVersion') IS NOT NULL
              AND ard."decision"->>'assessmentRuleVersion' = adc."assessmentRuleVersion"
              AND jsonb_typeof((ard."decision"::jsonb)->'scopeId') = 'string'
              AND (ard."decision"->>'scopeId') IS NOT NULL
              AND ard."decision"->>'scopeId' = 'ASSESSMENT'
              AND jsonb_typeof((ard."decision"::jsonb)->'ruleSetVersionId') = 'string'
              AND (ard."decision"->>'ruleSetVersionId') IS NOT NULL
              AND ard."decision"->>'ruleSetVersionId' = ac."ruleSetVersionId"
              AND jsonb_typeof((ard."decision"::jsonb)->'repositorySnapshotId') = 'string'
              AND (ard."decision"->>'repositorySnapshotId') IS NOT NULL
              AND (ac."repositorySnapshotId" IS NULL OR ard."decision"->>'repositorySnapshotId' = ac."repositorySnapshotId")
              AND jsonb_typeof((ard."decision"::jsonb)->'repositoryCommit') = 'string'
              AND (ard."decision"->>'repositoryCommit') IS NOT NULL
              AND LOWER(ard."decision"->>'repositoryCommit') = LOWER(ac."repositoryCommit")
              AND jsonb_typeof((ard."decision"::jsonb)->'caseRevision') = 'number'
              AND (ard."decision"->>'caseRevision') IS NOT NULL
              AND ard."decision"->>'caseRevision' = ac."caseRevision"::text
              AND jsonb_typeof((ard."decision"::jsonb)->'applicability') = 'string'
              AND (ard."decision"->>'applicability') IS NOT NULL
              AND ard."decision"->>'applicability' = ard."applicability"::text
              AND (
                (ard."compliance" IS NULL AND jsonb_typeof((ard."decision"::jsonb)->'compliance') = 'null')
                OR (
                  ard."compliance" IS NOT NULL
                  AND jsonb_typeof((ard."decision"::jsonb)->'compliance') = 'string'
                  AND ard."decision"->>'compliance' IS NOT NULL
                  AND ard."decision"->>'compliance' = ard."compliance"::text
                )
              )
              AND ((ard."decision"::jsonb) - ARRAY['assessmentRuleId', 'assessmentRuleVersion', 'scopeId', 'ruleSetVersionId', 'repositorySnapshotId', 'repositoryCommit', 'caseRevision', 'legalContextRefs', 'applicability', 'rationale', 'references', 'criteria', 'compliance']) = '{}'::jsonb
              AND jsonb_typeof((ard."decision"::jsonb)->'legalContextRefs') = 'array'
              AND jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'legalContextRefs') = 'array' THEN (ard."decision"::jsonb)->'legalContextRefs' ELSE '[]'::jsonb END) >= 1
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'legalContextRefs') = 'array'
                    THEN (ard."decision"::jsonb)->'legalContextRefs'
                    ELSE '[]'::jsonb END
                ) lcr
                WHERE jsonb_typeof(lcr) <> 'object'
                  OR (lcr - ARRAY['legalContextId']) <> '{}'::jsonb
                  OR jsonb_typeof(lcr->'legalContextId') <> 'string'
                  OR lcr->>'legalContextId' IS NULL
                  OR length(trim(lcr->>'legalContextId')) = 0
              )
              AND jsonb_typeof((ard."decision"::jsonb)->'rationale') = 'string'
              AND (ard."decision"->>'rationale') IS NOT NULL
              AND length(trim(ard."decision"->>'rationale')) > 0
              AND jsonb_typeof((ard."decision"::jsonb)->'references') = 'array'
              AND jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'references') = 'array' THEN (ard."decision"::jsonb)->'references' ELSE '[]'::jsonb END) >= 1
              AND (
                CASE
                  WHEN ard."applicability" = 'APPLICABLE' THEN (
                    ard."compliance" IN ('COMPLIANT', 'NON_COMPLIANT')
                    AND jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array'
                    AND jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) >= 1
                    AND (
                      SELECT count(DISTINCT crit->>'criterionId')
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) crit
                    ) = jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END)
                    AND NOT EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) crit
                      WHERE jsonb_typeof(crit) <> 'object'
                        OR (crit - ARRAY['criterionId', 'outcome', 'rationale', 'references']) <> '{}'::jsonb
                        OR jsonb_typeof(crit->'criterionId') <> 'string'
                        OR crit->>'criterionId' IS NULL
                        OR length(trim(crit->>'criterionId')) = 0
                        OR jsonb_typeof(crit->'outcome') <> 'string'
                        OR crit->>'outcome' IS NULL
                        OR crit->>'outcome' NOT IN ('MET', 'NOT_MET')
                        OR jsonb_typeof(crit->'rationale') <> 'string'
                        OR crit->>'rationale' IS NULL
                        OR length(trim(crit->>'rationale')) = 0
                        OR jsonb_typeof(crit->'references') <> 'array'
                        OR jsonb_array_length(CASE WHEN jsonb_typeof(crit->'references') = 'array' THEN crit->'references' ELSE '[]'::jsonb END) < 1
                    )
                    AND CASE
                      WHEN ard."compliance" = 'NON_COMPLIANT' THEN
                        EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) crit
                          WHERE crit->>'outcome' = 'NOT_MET'
                        )
                      WHEN ard."compliance" = 'COMPLIANT' THEN
                        NOT EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) crit
                          WHERE crit->>'outcome' = 'NOT_MET'
                        )
                      ELSE false
                    END
                  )
                  WHEN ard."applicability" = 'NOT_APPLICABLE' THEN (
                    ard."compliance" IS NULL
                    AND jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array'
                    AND jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) = 0
                  )
                  ELSE false
                END
              )
              AND NOT EXISTS (
                SELECT 1
                FROM (
                  SELECT jsonb_array_elements(
                    CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'references') = 'array'
                      THEN (ard."decision"::jsonb)->'references'
                      ELSE '[]'::jsonb END
                  ) AS ref
                  UNION ALL
                  SELECT jsonb_array_elements(
                    CASE WHEN jsonb_typeof(crit->'references') = 'array'
                      THEN crit->'references'
                      ELSE '[]'::jsonb END
                  ) AS ref
                  FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array'
                      THEN (ard."decision"::jsonb)->'criteria'
                      ELSE '[]'::jsonb END
                  ) crit
                ) all_refs
                WHERE (
                  jsonb_typeof(all_refs.ref) <> 'object'
                  OR jsonb_typeof(all_refs.ref->'type') <> 'string'
                  OR all_refs.ref->>'type' IS NULL
                  OR all_refs.ref->>'type' NOT IN ('ASSESSMENT_EVIDENCE', 'CONFIRMED_FACT')
                  OR (
                    all_refs.ref->>'type' = 'ASSESSMENT_EVIDENCE'
                    AND (
                      (all_refs.ref - ARRAY['type', 'evidenceId']) <> '{}'::jsonb
                      OR jsonb_typeof(all_refs.ref->'evidenceId') <> 'string'
                      OR all_refs.ref->>'evidenceId' IS NULL
                      OR length(trim(all_refs.ref->>'evidenceId')) = 0
                      OR NOT EXISTS (
                        SELECT 1 FROM "AssessmentEvidence" ae
                        WHERE ae."evidenceId"::text = all_refs.ref->>'evidenceId'
                          AND ae."assessmentId" = adc."assessmentId"
                          AND ae."state" = 'ACCEPTED'
                          AND ae."invalidatedAt" IS NULL
                          AND LOWER(ae."repositoryCommit") = LOWER(ac."repositoryCommit")
                      )
                    )
                  )
                  OR (
                    all_refs.ref->>'type' = 'CONFIRMED_FACT'
                    AND (
                      (all_refs.ref - ARRAY['type', 'factId', 'caseRevision']) <> '{}'::jsonb
                      OR jsonb_typeof(all_refs.ref->'factId') <> 'string'
                      OR all_refs.ref->>'factId' IS NULL
                      OR length(trim(all_refs.ref->>'factId')) = 0
                      OR jsonb_typeof(all_refs.ref->'caseRevision') <> 'number'
                      OR all_refs.ref->>'caseRevision' IS NULL
                      OR all_refs.ref->>'caseRevision' <> ac."caseRevision"::text
                      OR NOT EXISTS (
                        SELECT 1 FROM "AssessmentCaseFact" af
                        WHERE af."factId"::text = all_refs.ref->>'factId'
                          AND af."assessmentId" = adc."assessmentId"
                          AND af."state" = 'ACCEPTED'
                          AND af."invalidatedAt" IS NULL
                          AND af."caseRevision" = ac."caseRevision"
                      )
                    )
                  )
                )
              )
            ) THEN true ELSE false END AS is_valid
          FROM "AssessmentDecisionCoverage" adc
          JOIN "Assessment" a ON a."id" = adc."assessmentId"
          JOIN "AssessmentCase" ac ON ac."assessmentId" = adc."assessmentId"
          LEFT JOIN "AssessmentRuleDecision" ard
            ON ard."decisionId" = adc."currentDecisionId"
            AND ard."assessmentId" = adc."assessmentId"
            AND ard."assessmentRuleId" = adc."assessmentRuleId"
          WHERE a."ownerId" = ${input.sessionUserId}
        )
        SELECT
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'APPLICABLE' AND "compliance" = 'COMPLIANT' THEN 1 ELSE 0 END), 0) AS "compliantCount",
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'APPLICABLE' AND "compliance" = 'NON_COMPLIANT' THEN 1 ELSE 0 END), 0) AS "nonCompliantCount",
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'NOT_APPLICABLE' THEN 1 ELSE 0 END), 0) AS "notApplicableCount",
          COALESCE(SUM(CASE WHEN is_valid IS NOT TRUE OR ("applicability" = 'APPLICABLE' AND ("compliance" IS NULL OR "compliance" NOT IN ('COMPLIANT', 'NON_COMPLIANT'))) THEN 1 ELSE 0 END), 0) AS "unresolvedCount"
        FROM evaluated
      `;
        if (summaryRows && summaryRows.length > 0) {
          ownerCompliant = Number(summaryRows[0].compliantCount ?? 0);
          ownerNonCompliant = Number(summaryRows[0].nonCompliantCount ?? 0);
          ownerNotApplicable = Number(summaryRows[0].notApplicableCount ?? 0);
          ownerUnresolved = Number(summaryRows[0].unresolvedCount ?? 0);
        }
      } catch (err) {
        this.logger.error(
          `Owner compliance summary database query failed for owner ${input.sessionUserId} (correlationId: ${input.correlationId}): ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
        throw new ServiceUnavailableException(
          `Owner compliance summary is temporarily unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 1. Dedicated owner-wide Actions queue: open human requests across all owned assessments
    const actions: CustomerTrackingActionItem[] = [];
    const actionsWhere = {
      status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
      assessmentCase: {
        assessment: {
          ownerId: input.sessionUserId,
        },
      },
    };
    const totalOpenHumanRequests =
      await this.prisma.assessmentHumanRequest.count({
        where: actionsWhere,
      });

    const openHumanRequests = await this.prisma.assessmentHumanRequest.findMany(
      {
        where: actionsWhere,
        select: {
          requestId: true,
          assessmentId: true,
          assessmentRuleId: true,
          question: true,
          unresolvedFact: true,
          createdAt: true,
          assessmentCase: {
            select: {
              assessment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { requestId: "desc" }],
        skip: effectiveActionsOffset,
        take: effectiveActionsLimit,
      },
    );

    for (const hr of openHumanRequests) {
      actions.push({
        requestId: hr.requestId,
        assessmentId: hr.assessmentId,
        assessmentName: hr.assessmentCase?.assessment?.name ?? "Assessment",
        assessmentRuleId: hr.assessmentRuleId,
        question: hr.question,
        unresolvedFact: hr.unresolvedFact,
        actionReason: TRACKING_ACTION_REASONS.HUMAN_FACT_REQUIRED,
        createdAt: hr.createdAt.toISOString(),
        destinationUrl: `/assessments/${hr.assessmentId}?requestId=${encodeURIComponent(hr.requestId)}`,
      });
    }

    // 2. Dedicated owner-wide Changes queue: material changes across all owned assessments
    let totalChanges = 0;
    let paginatedChanges: CustomerTrackingChangeItem[] = [];
    let usedDbChanges = false;

    if (typeof this.prisma.$queryRaw === "function") {
      try {
        const sinceDate = new Date(sinceTime);
        interface ChangeSqlRow {
          total: number;
          assessmentId: string | null;
          assessmentName: string | null;
          changeType: string | null;
          occurredAt: Date | null;
          artifactId: string | null;
          commitPrefix: string | null;
        }

        const changeRows = await this.prisma.$queryRaw<ChangeSqlRow[]>`
          WITH owner_ready_reports AS (
            SELECT
              art."assessmentId",
              a."name" AS "assessmentName",
              'REPORT_READY' AS "changeType",
              COALESCE(art."activatedAt", art."createdAt") AS "occurredAt",
              art."artifactId"::text AS "artifactId",
              NULL::text AS "commitPrefix"
            FROM "AssessmentArtifact" art
            JOIN "Assessment" a ON a."id" = art."assessmentId"
            WHERE a."ownerId" = ${input.sessionUserId}
              AND a."lifecycleState" = 'COMPLETE'
              AND art."kind" = 'FINAL_REPORT'
              AND art."lifecycleState" = 'ACTIVE'
              AND COALESCE(art."activatedAt", art."createdAt") >= ${sinceDate}
          ),
          owner_completed_without_reports AS (
            SELECT
              a."id" AS "assessmentId",
              a."name" AS "assessmentName",
              'OUTCOME_COMPLETED' AS "changeType",
              a."updatedAt" AS "occurredAt",
              NULL::text AS "artifactId",
              NULL::text AS "commitPrefix"
            FROM "Assessment" a
            WHERE a."ownerId" = ${input.sessionUserId}
              AND a."lifecycleState" = 'COMPLETE'
              AND a."updatedAt" >= ${sinceDate}
              AND NOT EXISTS (
                SELECT 1
                FROM "AssessmentArtifact" art
                WHERE art."assessmentId" = a."id"
                  AND art."kind" = 'FINAL_REPORT'
                  AND art."lifecycleState" = 'ACTIVE'
              )
          ),
          owner_reassessments AS (
            SELECT
              a."id" AS "assessmentId",
              a."name" AS "assessmentName",
              'REASSESSMENT_REQUIRED' AS "changeType",
              ls."createdAt" AS "occurredAt",
              NULL::text AS "artifactId",
              SUBSTRING(ls."commitSha" FROM 1 FOR 7) AS "commitPrefix"
            FROM "Assessment" a
            JOIN "AssessmentCase" ac ON ac."assessmentId" = a."id"
            JOIN "RepositorySnapshot" ps ON ps."id" = ac."repositorySnapshotId"
            CROSS JOIN LATERAL (
              SELECT s."id", s."commitSha", s."createdAt"
              FROM "RepositorySnapshot" s
              WHERE s."status" = 'READY'
                AND s."repositoryFullName" = ps."repositoryFullName"
                AND (
                  (ps."ref" IS NOT NULL AND (s."ref" = ps."ref" OR s."branch" = ps."ref"))
                  OR (ps."branch" IS NOT NULL AND (s."ref" = ps."branch" OR s."branch" = ps."branch"))
                  OR (ps."ref" IS NULL AND ps."branch" IS NULL)
                )
                AND (
                  EXISTS (
                    SELECT 1 FROM "Assessment" oa WHERE oa."id" = s."assessmentId" AND oa."ownerId" = a."ownerId"
                  )
                  OR EXISTS (
                    SELECT 1 FROM "RepositoryConnection" rc WHERE rc."id" = s."connectionId" AND rc."userId" = a."ownerId" AND rc."status" = 'ACTIVE'
                  )
                )
              ORDER BY s."createdAt" DESC
              LIMIT 1
            ) ls
            WHERE a."ownerId" = ${input.sessionUserId}
              AND ls."id" <> ps."id"
              AND LOWER(ls."commitSha") <> LOWER(COALESCE(ac."repositoryCommit", ps."commitSha"))
              AND ls."createdAt" >= ${sinceDate}
          ),
          all_changes AS (
            SELECT * FROM owner_ready_reports
            UNION ALL
            SELECT * FROM owner_completed_without_reports
            UNION ALL
            SELECT * FROM owner_reassessments
          ),
          deduped_changes AS (
            SELECT DISTINCT ON ("changeType", "assessmentId")
              "assessmentId",
              "assessmentName",
              "changeType",
              "occurredAt",
              "artifactId",
              "commitPrefix"
            FROM all_changes
            ORDER BY "changeType", "assessmentId", "occurredAt" DESC
          ),
          total_count AS (
            SELECT COUNT(*)::int AS "total" FROM deduped_changes
          ),
          paged_changes AS (
            SELECT *
            FROM deduped_changes
            ORDER BY "occurredAt" DESC, "assessmentId" ASC, "changeType" ASC
            LIMIT ${effectiveChangesLimit} OFFSET ${effectiveChangesOffset}
          )
          SELECT
            tc."total",
            pc."assessmentId",
            pc."assessmentName",
            pc."changeType",
            pc."occurredAt",
            pc."artifactId",
            pc."commitPrefix"
          FROM total_count tc
          LEFT JOIN paged_changes pc ON true
        `;

        if (
          Array.isArray(changeRows) &&
          changeRows.length > 0 &&
          typeof changeRows[0].total === "number"
        ) {
          usedDbChanges = true;
          totalChanges = changeRows[0].total;
          paginatedChanges = changeRows
            .filter(
              (
                row,
              ): row is ChangeSqlRow & {
                assessmentId: string;
                assessmentName: string;
                changeType: string;
                occurredAt: Date;
              } =>
                row.assessmentId !== null &&
                row.assessmentName !== null &&
                row.changeType !== null &&
                row.occurredAt !== null,
            )
            .map((row) => {
              const occurredAtStr = new Date(row.occurredAt).toISOString();
              if (row.changeType === TRACKING_CHANGE_TYPES.REPORT_READY) {
                return {
                  assessmentId: row.assessmentId,
                  assessmentName: row.assessmentName,
                  changeType: TRACKING_CHANGE_TYPES.REPORT_READY,
                  titleKey: "assessment.tracking.reportReadyTitle",
                  descriptionKey: "assessment.tracking.reportReadyDescription",
                  title: isVi
                    ? `Báo cáo cuối cùng đã sẵn sàng cho ${row.assessmentName}`
                    : `Final Report available for ${row.assessmentName}`,
                  description: isVi
                    ? "Báo cáo tuân thủ chuẩn hoá đã sẵn sàng để tải về."
                    : "Canonical compliance report is ready for download.",
                  occurredAt: occurredAtStr,
                  destinationUrl: `/assessments/${row.assessmentId}/report?artifactId=${encodeURIComponent(row.artifactId ?? "")}`,
                };
              }
              if (row.changeType === TRACKING_CHANGE_TYPES.OUTCOME_COMPLETED) {
                return {
                  assessmentId: row.assessmentId,
                  assessmentName: row.assessmentName,
                  changeType: TRACKING_CHANGE_TYPES.OUTCOME_COMPLETED,
                  titleKey: "assessment.tracking.outcomeCompletedTitle",
                  descriptionKey:
                    "assessment.tracking.outcomeCompletedDescription",
                  title: isVi
                    ? `Đã hoàn thành đánh giá cho ${row.assessmentName}`
                    : `Assessment completed for ${row.assessmentName}`,
                  description: isVi
                    ? "Đánh giá đã hoàn tất trên toàn bộ các quy tắc chuẩn."
                    : "Evaluation completed across canonical rules.",
                  occurredAt: occurredAtStr,
                  destinationUrl: `/assessments/${row.assessmentId}`,
                };
              }
              const commitPrefix = row.commitPrefix ?? "";
              return {
                assessmentId: row.assessmentId,
                assessmentName: row.assessmentName,
                changeType: TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
                titleKey: "assessment.tracking.reassessmentRequiredTitle",
                descriptionKey:
                  "assessment.tracking.reassessmentRequiredDescription",
                title: isVi
                  ? `Phát hiện commit mới cho ${row.assessmentName}`
                  : `New commit detected for ${row.assessmentName}`,
                description: isVi
                  ? `Kho mã nguồn có commit mới hơn (${commitPrefix}) so với bản chụp đã đánh giá. Cần thực hiện đánh giá lại.`
                  : `Repository has newer commit (${commitPrefix}) than assessed snapshot. Reassessment required.`,
                occurredAt: occurredAtStr,
                destinationUrl: `/assessments/${row.assessmentId}`,
              };
            });
        }
      } catch (err) {
        this.logger.error(
          `Customer change feed database query failed for owner ${input.sessionUserId} (correlationId: ${input.correlationId}): ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
        throw new ServiceUnavailableException(
          `Customer change feed query is temporarily unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const changes: CustomerTrackingChangeItem[] = [];

    // Fallback path with controlled concurrency for unit test mocks where $queryRaw is not provided
    if (!usedDbChanges) {
      // 2a. Ready reports across all owned completed assessments
      const readyReports = await this.prisma.assessmentArtifact.findMany({
        where: {
          kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
          lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
          assessmentCase: {
            assessment: {
              ownerId: input.sessionUserId,
              lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
            },
          },
          OR: [
            { activatedAt: { gte: new Date(sinceTime) } },
            { createdAt: { gte: new Date(sinceTime) } },
          ],
        },
        select: {
          artifactId: true,
          createdAt: true,
          activatedAt: true,
          assessmentCase: {
            select: {
              assessment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const report of readyReports) {
        const reportTime = (report.activatedAt ?? report.createdAt).getTime();
        changes.push({
          assessmentId: report.assessmentCase.assessment.id,
          assessmentName: report.assessmentCase.assessment.name,
          changeType: TRACKING_CHANGE_TYPES.REPORT_READY,
          titleKey: "assessment.tracking.reportReadyTitle",
          descriptionKey: "assessment.tracking.reportReadyDescription",
          title: isVi
            ? `Báo cáo cuối cùng đã sẵn sàng cho ${report.assessmentCase.assessment.name}`
            : `Final Report available for ${report.assessmentCase.assessment.name}`,
          description: isVi
            ? "Báo cáo tuân thủ chuẩn hoá đã sẵn sàng để tải về."
            : "Canonical compliance report is ready for download.",
          occurredAt: new Date(reportTime).toISOString(),
          destinationUrl: `/assessments/${report.assessmentCase.assessment.id}/report?artifactId=${encodeURIComponent(report.artifactId)}`,
        });
      }

      // 2b. Completed assessments without reports updated since sinceTime
      const completedWithoutReports = await this.prisma.assessment.findMany({
        where: {
          ownerId: input.sessionUserId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
          updatedAt: { gte: new Date(sinceTime) },
          domainCase: {
            artifacts: {
              none: {
                kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
                lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
              },
            },
          },
        },
        select: {
          id: true,
          name: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      for (const asmt of completedWithoutReports) {
        changes.push({
          assessmentId: asmt.id,
          assessmentName: asmt.name,
          changeType: TRACKING_CHANGE_TYPES.OUTCOME_COMPLETED,
          titleKey: "assessment.tracking.outcomeCompletedTitle",
          descriptionKey: "assessment.tracking.outcomeCompletedDescription",
          title: isVi
            ? `Đã hoàn thành đánh giá cho ${asmt.name}`
            : `Assessment completed for ${asmt.name}`,
          description: isVi
            ? "Đánh giá đã hoàn tất trên toàn bộ các quy tắc chuẩn."
            : "Evaluation completed across canonical rules.",
          occurredAt: asmt.updatedAt.toISOString(),
          destinationUrl: `/assessments/${asmt.id}`,
        });
      }

      // 2c. Candidate cases with pinned snapshots across all owned assessments (for staleness detection)
      const ownerCasesWithSnapshots = await this.prisma.assessmentCase.findMany(
        {
          where: {
            assessment: { ownerId: input.sessionUserId },
            repositorySnapshotId: { not: null },
          },
          select: {
            assessmentId: true,
            repositorySnapshotId: true,
            repositoryCommit: true,
            assessment: {
              select: {
                id: true,
                name: true,
                updatedAt: true,
              },
            },
          },
          orderBy: { assessment: { updatedAt: "desc" } },
        },
      );

      const allPinnedSnapshotIds = [
        ...new Set([
          ...assessments
            .map((a) => a.domainCase?.repositorySnapshotId)
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
          ...ownerCasesWithSnapshots
            .map((c) => c.repositorySnapshotId)
            .filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
        ]),
      ];

      const pinnedSnapshots =
        allPinnedSnapshotIds.length > 0
          ? await this.prisma.repositorySnapshot.findMany({
              where: { id: { in: allPinnedSnapshotIds } },
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
      const latestEntries = await mapWithConcurrency(
        repoRefKeys,
        8,
        async (key) => {
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
          return [key, latest] as const;
        },
      );
      for (const [key, latest] of latestEntries) {
        if (latest) {
          latestSnapshotsByRepoRef.set(key, latest);
        }
      }

      for (const ac of ownerCasesWithSnapshots) {
        if (!ac.repositorySnapshotId) continue;
        const pinned = pinnedSnapshotById.get(ac.repositorySnapshotId);
        if (!pinned) continue;
        const pinnedCommit = ac.repositoryCommit ?? pinned.commitSha;
        const key = `${pinned.repositoryFullName}::${pinned.ref ?? pinned.branch ?? ""}`;
        const foundLatest = latestSnapshotsByRepoRef.get(key);
        if (foundLatest && foundLatest.id !== pinned.id) {
          const latestCommit = foundLatest.commitSha;
          const isStale =
            Boolean(pinnedCommit) &&
            Boolean(latestCommit) &&
            pinnedCommit.toLowerCase() !== latestCommit.toLowerCase();
          if (isStale && pinnedCommit && latestCommit) {
            const sourceChangeTime = new Date(foundLatest.createdAt).getTime();
            if (sourceChangeTime >= sinceTime) {
              const commitPrefix = latestCommit.slice(0, 7);
              changes.push({
                assessmentId: ac.assessment.id,
                assessmentName: ac.assessment.name,
                changeType: TRACKING_CHANGE_TYPES.REASSESSMENT_REQUIRED,
                titleKey: "assessment.tracking.reassessmentRequiredTitle",
                descriptionKey:
                  "assessment.tracking.reassessmentRequiredDescription",
                title: isVi
                  ? `Phát hiện commit mới cho ${ac.assessment.name}`
                  : `New commit detected for ${ac.assessment.name}`,
                description: isVi
                  ? `Kho mã nguồn có commit mới hơn (${commitPrefix}) so với bản chụp đã đánh giá. Cần thực hiện đánh giá lại.`
                  : `Repository has newer commit (${commitPrefix}) than assessed snapshot. Reassessment required.`,
                occurredAt: new Date(foundLatest.createdAt).toISOString(),
                destinationUrl: `/assessments/${ac.assessment.id}`,
              });
            }
          }
        }
      }
    }

    // Pinned snapshots and authoritative remote status for current page assessments only
    const pagePinnedSnapshotIds = [
      ...new Set(
        assessments
          .map((a) => a.domainCase?.repositorySnapshotId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    ];

    const pagePinnedSnapshots =
      pagePinnedSnapshotIds.length > 0
        ? await this.prisma.repositorySnapshot.findMany({
            where: { id: { in: pagePinnedSnapshotIds } },
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

    const pinnedSnapshotById = new Map(
      pagePinnedSnapshots.map((s) => [s.id, s]),
    );

    const pageRepoRefKeys = [
      ...new Set(
        pagePinnedSnapshots.map(
          (s) => `${s.repositoryFullName}::${s.ref ?? s.branch ?? ""}`,
        ),
      ),
    ];
    const latestSnapshotsByRepoRef = new Map<
      string,
      (typeof pagePinnedSnapshots)[0]
    >();
    const latestPageEntries = await mapWithConcurrency(
      pageRepoRefKeys,
      5,
      async (key) => {
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
        return [key, latest] as const;
      },
    );
    for (const [key, latest] of latestPageEntries) {
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
    const expectedRuleCounts = await mapWithConcurrency(
      ruleSetVersionIds,
      5,
      async (vId) => {
        const count = await this.prisma.assessmentRule.count({
          where: { ruleSetVersionId: vId },
        });
        return [vId, count] as const;
      },
    );
    const expectedRuleCountByVersionId = new Map(expectedRuleCounts);

    const assessmentItems: CustomerTrackingAssessmentItem[] = [];

    for (const assessment of assessments) {
      const domainCase = assessment.domainCase;
      const asmtCoverage = allCoverageByAssessmentId.get(assessment.id) ?? [];

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
          const foundLatest = latestSnapshotsByRepoRef.get(key);

          // An assessment result was evaluated at pinnedCommit.
          // Check remote freshness against authorized subsequent observations:
          if (foundLatest && foundLatest.id !== pinned.id) {
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

      // 5. Fail-closed Trust Status Determination
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

    actions.sort((a, b) => {
      const timeDiff =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.requestId.localeCompare(a.requestId);
    });

    if (!usedDbChanges) {
      const seenChangeKeys = new Set<string>();
      const deduplicatedChanges = changes.filter((c) => {
        const key = `${c.changeType}::${c.assessmentId}`;
        if (seenChangeKeys.has(key)) return false;
        seenChangeKeys.add(key);
        return true;
      });

      deduplicatedChanges.sort((a, b) => {
        const timeDiff =
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        const idDiff = a.assessmentId.localeCompare(b.assessmentId);
        if (idDiff !== 0) return idDiff;
        return a.changeType.localeCompare(b.changeType);
      });

      totalChanges = deduplicatedChanges.length;
      paginatedChanges = deduplicatedChanges.slice(
        effectiveChangesOffset,
        effectiveChangesOffset + effectiveChangesLimit,
      );
    }

    const actionsPagination = {
      total: totalOpenHumanRequests,
      limit: effectiveActionsLimit,
      offset: effectiveActionsOffset,
      hasMore: effectiveActionsOffset + actions.length < totalOpenHumanRequests,
    };

    const changesPagination = {
      total: totalChanges,
      limit: effectiveChangesLimit,
      offset: effectiveChangesOffset,
      hasMore: effectiveChangesOffset + paginatedChanges.length < totalChanges,
    };

    return customerTrackingOverviewSchema.parse({
      actions,
      changes: paginatedChanges,
      actionsPagination,
      changesPagination,
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

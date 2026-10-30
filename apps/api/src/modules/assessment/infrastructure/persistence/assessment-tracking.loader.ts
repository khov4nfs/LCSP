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
  TRACKING_RULE_OUTCOMES,
  TRACKING_UNTRUSTED_REASONS,
  customerTrackingOverviewSchema,
  customerTrackingObligationsSchema,
  customerTrackingObligationAssessmentsSchema,
  customerTrackingReportsSchema,
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
  type TrackingRuleOutcome,
  type CustomerTrackingObligations,
  type CustomerTrackingReports,
} from "@lcsp/contracts/assessment-domain";
import type {
  FilteredTrackingReportPagePayload,
  TrackingObligationAggregatePayload,
} from "./types/assessment-tracking-persistence.types.js";
import {
  REPOSITORY_SNAPSHOT_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES } from "@lcsp/contracts/compliance-rule-set";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";

const CANONICAL_SQL_WHITESPACE = Prisma.raw(
  `E' \\t\\n\\r\\x0B\\x0C\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'`,
);
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

/**
 * Business purpose: Provide database projections with the canonical validity result for owned rule decisions.
 * Business rules: A decision is valid only when the current coverage pointer, persisted columns, strict JSON packet, evidence, and facts agree with the assessment's pinned rule set and revision; optional group scope restricts the evaluated rule population.
 * Execution flow: 1. Bind the customer owner ID. 2. Optionally bind a rule-set and rule group. 3. Read the scoped coverage rows and current decision references. 4. Return a CTE that marks only fully revalidated decisions as valid.
 * Failure cases: Missing, malformed, stale, invalidated, or cross-assessment references produce an invalid row that downstream projections count as unresolved.
 * Side effects: Builds a parameterized read-only SQL fragment; it performs no writes.
 */
function ownerCanonicalDecisionEvaluationCte(
  ownerId: string,
  group?: { ruleSetVersionId: string; assessmentRuleId: string },
): Prisma.Sql {
  const groupScope = group
    ? Prisma.sql`AND adc."ruleSetVersionId" = ${group.ruleSetVersionId} AND adc."assessmentRuleId" = ${group.assessmentRuleId}`
    : Prisma.empty;
  return Prisma.sql`
        WITH evaluated AS (
          SELECT
            adc."assessmentId",
            adc."assessmentRuleId",
            adc."ruleSetVersionId",
            adc."resolutionState",
            a."name" AS "assessmentName",
            a."updatedAt",
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
              AND length(btrim(ard."decision"->>'assessmentRuleId', ${CANONICAL_SQL_WHITESPACE})) BETWEEN 1 AND 200
              AND jsonb_typeof((ard."decision"::jsonb)->'assessmentRuleVersion') = 'string'
              AND (ard."decision"->>'assessmentRuleVersion') IS NOT NULL
              AND ard."decision"->>'assessmentRuleVersion' = adc."assessmentRuleVersion"
              AND length(btrim(ard."decision"->>'assessmentRuleVersion', ${CANONICAL_SQL_WHITESPACE})) BETWEEN 1 AND 200
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
              AND ard."decision"->>'repositoryCommit' = ac."repositoryCommit"
              AND (ard."decision"->>'repositoryCommit') ~ '^(?:[a-f0-9]{40}|[a-f0-9]{64})$'
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
                  OR length(btrim(lcr->>'legalContextId', ${CANONICAL_SQL_WHITESPACE})) = 0
                  OR length(btrim(lcr->>'legalContextId', ${CANONICAL_SQL_WHITESPACE})) > 200
              )
              AND jsonb_typeof((ard."decision"::jsonb)->'rationale') = 'string'
              AND (ard."decision"->>'rationale') IS NOT NULL
              AND length(btrim(ard."decision"->>'rationale', ${CANONICAL_SQL_WHITESPACE})) BETWEEN 1 AND 10000
              AND jsonb_typeof((ard."decision"::jsonb)->'references') = 'array'
              AND jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'references') = 'array' THEN (ard."decision"::jsonb)->'references' ELSE '[]'::jsonb END) >= 1
              AND (
                CASE
                  WHEN ard."applicability" = 'APPLICABLE' THEN (
                    ard."compliance" IN ('COMPLIANT', 'NON_COMPLIANT')
                    AND jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array'
                    AND jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) >= 1
                    AND (
                      SELECT count(DISTINCT btrim(crit->>'criterionId', ${CANONICAL_SQL_WHITESPACE}))
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) crit
                    ) = jsonb_array_length(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END)
                    AND NOT EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof((ard."decision"::jsonb)->'criteria') = 'array' THEN (ard."decision"::jsonb)->'criteria' ELSE '[]'::jsonb END) crit
                      WHERE jsonb_typeof(crit) <> 'object'
                        OR (crit - ARRAY['criterionId', 'outcome', 'rationale', 'references']) <> '{}'::jsonb
                        OR jsonb_typeof(crit->'criterionId') <> 'string'
                        OR crit->>'criterionId' IS NULL
                        OR length(btrim(crit->>'criterionId', ${CANONICAL_SQL_WHITESPACE})) = 0
                        OR length(btrim(crit->>'criterionId', ${CANONICAL_SQL_WHITESPACE})) > 200
                        OR jsonb_typeof(crit->'outcome') <> 'string'
                        OR crit->>'outcome' IS NULL
                        OR crit->>'outcome' NOT IN ('MET', 'NOT_MET')
                        OR jsonb_typeof(crit->'rationale') <> 'string'
                        OR crit->>'rationale' IS NULL
                        OR length(btrim(crit->>'rationale', ${CANONICAL_SQL_WHITESPACE})) = 0
                        OR length(btrim(crit->>'rationale', ${CANONICAL_SQL_WHITESPACE})) > 10000
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
                      OR length(btrim(all_refs.ref->>'evidenceId', ${CANONICAL_SQL_WHITESPACE})) = 0
                      OR length(btrim(all_refs.ref->>'evidenceId', ${CANONICAL_SQL_WHITESPACE})) > 200
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
                      OR length(btrim(all_refs.ref->>'factId', ${CANONICAL_SQL_WHITESPACE})) = 0
                      OR length(btrim(all_refs.ref->>'factId', ${CANONICAL_SQL_WHITESPACE})) > 200
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
          WHERE a."ownerId" = ${ownerId}
            ${groupScope}
        )
        `;
}

/**
 * Business purpose: Calculate source freshness for a bounded owner-scoped assessment candidate set.
 * Business rules: Only READY snapshots visible to the authenticated owner or an active owner connection can establish freshness; ref falls back to branch and matching commits are CURRENT.
 * Execution flow: 1. Read pinned snapshots for scoped_assessments. 2. Find the latest visible snapshot for each repository and normalized ref-or-branch key. 3. Return freshness and observation time for each candidate assessment.
 * Failure cases: Missing pins or a missing newer snapshot produce FRESHNESS_UNKNOWN; database errors propagate to the caller's shared error handling.
 * Side effects: Builds a parameterized read-only SQL CTE.
 */
function ownerScopedFreshnessCte(ownerId: string): Prisma.Sql {
  return Prisma.sql`, freshness AS (
    SELECT
      scoped."assessmentId",
      CASE
        WHEN latest."id" IS NOT NULL
          AND pinned."id" IS NOT NULL
          AND latest."id" <> pinned."id"
          AND latest."createdAt" > pinned."createdAt"
          AND LOWER(latest."commitSha") = LOWER(COALESCE(scoped."repositoryCommit", pinned."commitSha"))
          THEN ${TRACKING_FRESHNESS_STATUSES.CURRENT}
        WHEN latest."id" IS NOT NULL
          AND pinned."id" IS NOT NULL
          AND latest."id" <> pinned."id"
          AND latest."createdAt" > pinned."createdAt"
          THEN ${TRACKING_FRESHNESS_STATUSES.STALE}
        ELSE ${TRACKING_FRESHNESS_STATUSES.UNKNOWN}
      END AS "freshnessStatus",
      CASE
        WHEN latest."id" IS NOT NULL
          AND pinned."id" IS NOT NULL
          AND latest."id" <> pinned."id"
          AND latest."createdAt" > pinned."createdAt"
          THEN latest."createdAt"
        ELSE NULL
      END AS "observedAt"
    FROM scoped_assessments scoped
    LEFT JOIN "RepositorySnapshot" pinned
      ON pinned."id" = scoped."repositorySnapshotId"
    LEFT JOIN LATERAL (
      SELECT candidate."id", candidate."createdAt", candidate."commitSha"
      FROM "RepositorySnapshot" candidate
      WHERE candidate."status" = ${REPOSITORY_SNAPSHOT_STATUSES.ready}
        AND candidate."repositoryFullName" = pinned."repositoryFullName"
        AND (
          candidate."ref" = COALESCE(pinned."ref", pinned."branch")
          OR (
            candidate."ref" IS NULL
            AND candidate."branch" = COALESCE(pinned."ref", pinned."branch")
          )
        )
        AND (
          EXISTS (
            SELECT 1
            FROM "Assessment" snapshot_assessment
            WHERE snapshot_assessment."id" = candidate."assessmentId"
              AND snapshot_assessment."ownerId" = ${ownerId}
          )
          OR EXISTS (
            SELECT 1
            FROM "RepositoryConnection" snapshot_connection
            WHERE snapshot_connection."id" = candidate."connectionId"
              AND snapshot_connection."userId" = ${ownerId}
              AND snapshot_connection."status" = ${REPOSITORY_CONNECTION_STATUSES.active}
          )
        )
      ORDER BY candidate."createdAt" DESC, candidate."id" ASC
      LIMIT 1
    ) latest ON true
  )`;
}

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
  outcomes: Map<
    string,
    (typeof TRACKING_RULE_OUTCOMES)[keyof typeof TRACKING_RULE_OUTCOMES]
  >;
} {
  let compliant = 0;
  let nonCompliant = 0;
  let notApplicable = 0;
  let unresolved = 0;
  let hasDecisionInconsistency = false;
  const outcomes = new Map<
    string,
    (typeof TRACKING_RULE_OUTCOMES)[keyof typeof TRACKING_RULE_OUTCOMES]
  >();

  for (const cov of params.coverage) {
    if (
      cov.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED ||
      !cov.currentDecisionId
    ) {
      unresolved++;
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.UNRESOLVED);
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
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.UNRESOLVED);
      continue;
    }

    const parsed = ruleDecisionSchema.safeParse(dec.decision);
    if (!parsed.success) {
      hasDecisionInconsistency = true;
      unresolved++;
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.UNRESOLVED);
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
        outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.UNRESOLVED);
        continue;
      }
    }

    if (d.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE) {
      notApplicable++;
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.NOT_APPLICABLE);
    } else if (d.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT) {
      compliant++;
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.COMPLIANT);
    } else if (
      d.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
    ) {
      nonCompliant++;
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.NON_COMPLIANT);
    } else {
      unresolved++;
      outcomes.set(cov.assessmentRuleId, TRACKING_RULE_OUTCOMES.UNRESOLVED);
    }
  }

  return {
    compliant,
    nonCompliant,
    notApplicable,
    unresolved,
    hasDecisionInconsistency,
    outcomes,
  };
}

/**
 * Business purpose: Decide whether an assessment's decision ledger covers the full pinned rule population.
 * Business rules: A rule set must contain at least one expected rule and the assessment coverage row count must match that population exactly.
 * Execution flow: 1. Compare the expected count with zero. 2. Compare actual coverage with the pinned rule count. 3. Return true only for an exact positive match.
 * Failure cases: Empty rule sets, empty coverage, missing rules, and excess coverage all return false.
 * Side effects: Pure calculation with no persistence or external effects.
 */
function hasCanonicalCompleteCoverage(
  coverageCount: number,
  expectedRuleCount: number,
) {
  return expectedRuleCount > 0 && coverageCount === expectedRuleCount;
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
    search?: string;
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

    const assessmentWhere = {
      ownerId: input.sessionUserId,
      ...(input.search
        ? { name: { contains: input.search, mode: "insensitive" as const } }
        : {}),
    };
    const total = await this.prisma.assessment.count({
      where: assessmentWhere,
    });

    const assessments = await this.prisma.assessment.findMany({
      where: assessmentWhere,
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
        const summaryRows = await this.prisma.$queryRaw<SummaryRow[]>(
          Prisma.sql`${ownerCanonicalDecisionEvaluationCte(input.sessionUserId)}
SELECT
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'APPLICABLE' AND "compliance" = 'COMPLIANT' THEN 1 ELSE 0 END), 0) AS "compliantCount",
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'APPLICABLE' AND "compliance" = 'NON_COMPLIANT' THEN 1 ELSE 0 END), 0) AS "nonCompliantCount",
          COALESCE(SUM(CASE WHEN is_valid = true AND "applicability" = 'NOT_APPLICABLE' THEN 1 ELSE 0 END), 0) AS "notApplicableCount",
          COALESCE(SUM(CASE WHEN is_valid IS NOT TRUE OR ("applicability" = 'APPLICABLE' AND ("compliance" IS NULL OR "compliance" NOT IN ('COMPLIANT', 'NON_COMPLIANT'))) THEN 1 ELSE 0 END), 0) AS "unresolvedCount"
        FROM evaluated
      `,
        );
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
        if (
          foundLatest &&
          foundLatest.id !== pinned.id &&
          foundLatest.createdAt > pinned.createdAt
        ) {
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
      let observedAt: string | null = null;
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
          if (
            foundLatest &&
            foundLatest.id !== pinned.id &&
            foundLatest.createdAt > pinned.createdAt
          ) {
            latestCommit = foundLatest.commitSha;
            observedAt = foundLatest.createdAt.toISOString();
            isStale = Boolean(
              pinnedCommit &&
              foundLatest.commitSha.toLowerCase() !==
                pinnedCommit.toLowerCase(),
            );
            freshnessStatus = isStale
              ? TRACKING_FRESHNESS_STATUSES.STALE
              : TRACKING_FRESHNESS_STATUSES.CURRENT;
          } else {
            freshnessStatus = TRACKING_FRESHNESS_STATUSES.UNKNOWN;
            isStale = false;
            latestCommit = null;
            observedAt = null;
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
        !hasCanonicalCompleteCoverage(asmtCoverage.length, expectedRulesCount)
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
          observedAt,
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
  /**
   * Business purpose: Provide customers a paginated view of completed Final Reports.
   * Business rules: Only the authenticated customer owner may read owned assessments; freshness filtering and pagination are applied to active reports before bounded detail hydration.
   * Execution flow: 1. Validate the role. 2. Query owner-scoped active reports and freshness in PostgreSQL. 3. Apply the requested freshness, stable ordering, count, and page. 4. Hydrate only page details and preserve canonical trust status.
   * Failure cases: Non-customer roles receive an empty page; query failure or a page/detail mismatch fails closed through shared API problem handling.
   * Side effects: Read-only database access.
   */
  async loadCustomerReports(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    limit?: number;
    offset?: number;
    freshness?: TrackingFreshnessStatus;
  }): Promise<CustomerTrackingReports> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    if (input.subjectRole !== AUTH_USER_ROLES.customer) {
      return customerTrackingReportsSchema.parse({
        items: [],
        pagination: { total: 0, limit, offset, hasMore: false },
        generatedAt: new Date().toISOString(),
      });
    }
    if (input.freshness === undefined) {
      const reportWhere = {
        kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
        lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
        assessmentCase: {
          assessment: {
            ownerId: input.sessionUserId,
            lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
          },
        },
      };
      const [total, reportRows] = await Promise.all([
        this.prisma.assessmentArtifact.count({ where: reportWhere }),
        this.prisma.assessmentArtifact.findMany({
          where: reportWhere,
          orderBy: [{ createdAt: "desc" }, { artifactId: "asc" }],
          skip: offset,
          take: limit,
          select: { artifactId: true, assessmentId: true, createdAt: true },
        }),
      ]);
      const rows = reportRows.length
        ? await this.loadCustomerTrackingRows(
            input.sessionUserId,
            reportRows.map((row) => row.assessmentId),
          )
        : [];
      const rowsByAssessmentId = new Map(
        rows.map((row) => [row.assessmentId, row]),
      );
      const items = reportRows.flatMap((report) => {
        const row = rowsByAssessmentId.get(report.assessmentId);
        return row
          ? [
              {
                assessmentId: row.assessmentId,
                assessmentName: row.assessmentName,
                repositoryName: row.repositoryName,
                repositoryOwner: row.repositoryOwner,
                artifactId: report.artifactId,
                createdAt: report.createdAt.toISOString(),
                freshnessStatus: row.freshnessStatus,
                observedAt: row.observedAt,
                trustStatus: row.trustStatus,
              },
            ]
          : [];
      });
      return customerTrackingReportsSchema.parse({
        items,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + reportRows.length < total,
        },
        generatedAt: new Date().toISOString(),
      });
    }
    let payload: FilteredTrackingReportPagePayload | undefined;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ payload: FilteredTrackingReportPagePayload }>
      >(Prisma.sql`
        WITH scoped_assessments AS (
          SELECT
            a."id" AS "assessmentId",
            ac."repositorySnapshotId",
            ac."repositoryCommit",
            report."artifactId",
            report."createdAt" AS "reportCreatedAt"
          FROM "Assessment" a
          JOIN "AssessmentCase" ac ON ac."assessmentId" = a."id"
          JOIN "AssessmentArtifact" report ON report."assessmentId" = a."id"
          WHERE a."ownerId" = ${input.sessionUserId}
            AND a."lifecycleState" = ${ASSESSMENT_LIFECYCLE_STATES.COMPLETE}
            AND report."kind" = ${ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT}
            AND report."lifecycleState" = ${ARTIFACT_LIFECYCLE_STATES.ACTIVE}
        )
        ${ownerScopedFreshnessCte(input.sessionUserId)},
        filtered_reports AS (
          SELECT scoped.*, freshness."freshnessStatus", freshness."observedAt"
          FROM scoped_assessments scoped
          JOIN freshness USING ("assessmentId")
          WHERE freshness."freshnessStatus" = ${input.freshness}
        ),
        report_page AS (
          SELECT * FROM filtered_reports
          ORDER BY "reportCreatedAt" DESC, "artifactId" ASC
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT jsonb_build_object(
          'total', (SELECT COUNT(*)::int FROM filtered_reports),
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'assessmentId', page."assessmentId",
              'artifactId', page."artifactId",
              'createdAt', page."reportCreatedAt",
              'freshnessStatus', page."freshnessStatus",
              'observedAt', page."observedAt"
            ) ORDER BY page."reportCreatedAt" DESC, page."artifactId" ASC)
            FROM report_page page
          ), '[]'::jsonb)
        ) AS payload
      `);
      payload = rows[0]?.payload;
    } catch (error) {
      this.logger.error(
        `Customer report freshness query failed for owner ${input.sessionUserId} (correlationId: ${input.correlationId}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        `Customer report freshness is temporarily unavailable (correlationId: ${input.correlationId}).`,
      );
    }
    if (!payload) {
      throw new ServiceUnavailableException(
        `Customer report freshness is temporarily unavailable (correlationId: ${input.correlationId}).`,
      );
    }
    const pageRows = payload.items.length
      ? await this.loadCustomerTrackingRows(
          input.sessionUserId,
          payload.items.map((item) => item.assessmentId),
        )
      : [];
    const rowsByAssessmentId = new Map(
      pageRows.map((row) => [row.assessmentId, row]),
    );
    const items = payload.items.map((report) => {
      const row = rowsByAssessmentId.get(report.assessmentId);
      if (!row || row.freshnessStatus !== report.freshnessStatus) {
        throw new ServiceUnavailableException(
          `Customer report details changed during pagination (correlationId: ${input.correlationId}).`,
        );
      }
      return {
        assessmentId: row.assessmentId,
        assessmentName: row.assessmentName,
        repositoryName: row.repositoryName,
        repositoryOwner: row.repositoryOwner,
        artifactId: report.artifactId,
        createdAt: new Date(report.createdAt).toISOString(),
        freshnessStatus: report.freshnessStatus,
        observedAt: report.observedAt
          ? new Date(report.observedAt).toISOString()
          : null,
        trustStatus: row.trustStatus,
      };
    });
    return customerTrackingReportsSchema.parse({
      items,
      pagination: {
        total: payload.total,
        limit,
        offset,
        hasMore: offset + items.length < payload.total,
      },
      generatedAt: new Date().toISOString(),
    });
  }

  /**
   * Business purpose: Let a customer inspect every owned assessment contributing to one obligation group.
   * Business rules: The validated group key and optional outcome/freshness filters must match owner-scoped canonical decisions; preview and follow-up pages use updatedAt DESC then assessmentId ASC.
   * Execution flow: 1. Validate the role. 2. Select the requested page and exact count in PostgreSQL. 3. Hydrate canonical details only for page IDs. 4. Preserve database ordering in the response.
   * Failure cases: Non-customer roles receive an empty page; unknown or non-owned groups return an empty page; query or detail mismatches fail closed.
   * Side effects: Read-only database access.
   */
  async loadCustomerObligationAssessments(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    ruleSetVersionId: string;
    assessmentRuleId: string;
    limit?: number;
    offset?: number;
    outcome?: TrackingRuleOutcome;
    freshness?: TrackingFreshnessStatus;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    if (input.subjectRole !== AUTH_USER_ROLES.customer) {
      return customerTrackingObligationAssessmentsSchema.parse({
        items: [],
        pagination: { total: 0, limit, offset, hasMore: false },
        generatedAt: new Date().toISOString(),
      });
    }

    if (!input.outcome && !input.freshness) {
      const groupWhere = {
        ownerId: input.sessionUserId,
        domainCase: {
          is: {
            ruleSetVersionId: input.ruleSetVersionId,
            coverage: {
              some: {
                ruleSetVersionId: input.ruleSetVersionId,
                assessmentRuleId: input.assessmentRuleId,
              },
            },
          },
        },
      };
      const [total, pageAssessments] = await Promise.all([
        this.prisma.assessment.count({ where: groupWhere }),
        this.prisma.assessment.findMany({
          where: groupWhere,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          skip: offset,
          take: limit,
          select: { id: true },
        }),
      ]);
      const rows = pageAssessments.length
        ? await this.loadCustomerTrackingRows(
            input.sessionUserId,
            pageAssessments.map((assessment) => assessment.id),
          )
        : [];
      const rowsByAssessmentId = new Map(
        rows.map((row) => [row.assessmentId, row]),
      );
      const items = pageAssessments.map((assessment) => {
        const row = rowsByAssessmentId.get(assessment.id);
        const rule = row?.rules.find(
          (item) => item.assessmentRuleId === input.assessmentRuleId,
        );
        if (!row || !rule) {
          throw new ServiceUnavailableException(
            "Customer obligation assessment details changed during pagination.",
          );
        }
        return {
          assessmentId: row.assessmentId,
          assessmentName: row.assessmentName,
          outcome: rule.outcome,
          freshnessStatus: row.freshnessStatus,
          observedAt: row.observedAt,
          trustStatus: row.trustStatus,
        };
      });
      return customerTrackingObligationAssessmentsSchema.parse({
        items,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + items.length < total,
        },
        generatedAt: new Date().toISOString(),
      });
    }

    type FilteredObligationPage = {
      total: number;
      items: Array<{
        assessmentId: string;
        freshnessStatus: TrackingFreshnessStatus;
      }>;
    };
    let payload: FilteredObligationPage | undefined;
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ payload: FilteredObligationPage }>
      >(Prisma.sql`
        ${ownerCanonicalDecisionEvaluationCte(input.sessionUserId, {
          ruleSetVersionId: input.ruleSetVersionId,
          assessmentRuleId: input.assessmentRuleId,
        })},
        scoped_assessments AS (
          SELECT DISTINCT
            a."id" AS "assessmentId",
            ac."repositorySnapshotId",
            ac."repositoryCommit"
          FROM "Assessment" a
          JOIN "AssessmentCase" ac ON ac."assessmentId" = a."id"
          JOIN "AssessmentDecisionCoverage" group_coverage
            ON group_coverage."assessmentId" = a."id"
            AND group_coverage."ruleSetVersionId" = ${input.ruleSetVersionId}
            AND group_coverage."assessmentRuleId" = ${input.assessmentRuleId}
          WHERE a."ownerId" = ${input.sessionUserId}
            AND ac."ruleSetVersionId" = ${input.ruleSetVersionId}
        )
        ${ownerScopedFreshnessCte(input.sessionUserId)},
        normalized AS (
          SELECT
            evaluated."assessmentId",
            evaluated."assessmentName",
            evaluated."updatedAt",
            CASE
              WHEN evaluated."is_valid" = true
                AND evaluated."applicability" = 'NOT_APPLICABLE'
                THEN ${TRACKING_RULE_OUTCOMES.NOT_APPLICABLE}
              WHEN evaluated."is_valid" = true
                AND evaluated."applicability" = 'APPLICABLE'
                AND evaluated."compliance" = 'COMPLIANT'
                THEN ${TRACKING_RULE_OUTCOMES.COMPLIANT}
              WHEN evaluated."is_valid" = true
                AND evaluated."applicability" = 'APPLICABLE'
                AND evaluated."compliance" = 'NON_COMPLIANT'
                THEN ${TRACKING_RULE_OUTCOMES.NON_COMPLIANT}
              ELSE ${TRACKING_RULE_OUTCOMES.UNRESOLVED}
            END AS outcome,
            freshness."freshnessStatus"
          FROM evaluated
          JOIN scoped_assessments scoped USING ("assessmentId")
          JOIN "AssessmentRule" rule
            ON rule."ruleSetVersionId" = evaluated."ruleSetVersionId"
            AND rule."assessmentRuleId" = evaluated."assessmentRuleId"
          JOIN freshness USING ("assessmentId")
        ),
        filtered AS (
          SELECT * FROM normalized
          WHERE (${input.outcome ?? null}::text IS NULL
            OR outcome = ${input.outcome ?? null}::text)
            AND (${input.freshness ?? null}::text IS NULL
              OR "freshnessStatus" = ${input.freshness ?? null}::text)
        ),
        obligation_page AS (
          SELECT * FROM filtered
          ORDER BY "updatedAt" DESC, "assessmentId" ASC
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT jsonb_build_object(
          'total', (SELECT COUNT(*)::int FROM filtered),
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'assessmentId', page."assessmentId",
              'freshnessStatus', page."freshnessStatus"
            ) ORDER BY page."updatedAt" DESC, page."assessmentId" ASC)
            FROM obligation_page page
          ), '[]'::jsonb)
        ) AS payload
      `);
      payload = rows[0]?.payload;
    } catch (error) {
      this.logger.error(
        `Customer obligation page query failed for owner ${input.sessionUserId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        "Customer obligation assessment page is temporarily unavailable.",
      );
    }
    if (!payload) {
      throw new ServiceUnavailableException(
        "Customer obligation assessment page is temporarily unavailable.",
      );
    }
    const rows = payload.items.length
      ? await this.loadCustomerTrackingRows(
          input.sessionUserId,
          payload.items.map((item) => item.assessmentId),
        )
      : [];
    const rowsByAssessmentId = new Map(
      rows.map((row) => [row.assessmentId, row]),
    );
    const items = payload.items.map((pageItem) => {
      const row = rowsByAssessmentId.get(pageItem.assessmentId);
      const rule = row?.rules.find(
        (item) => item.assessmentRuleId === input.assessmentRuleId,
      );
      if (
        !row ||
        !rule ||
        row.freshnessStatus !== pageItem.freshnessStatus ||
        (input.outcome && rule.outcome !== input.outcome)
      ) {
        throw new ServiceUnavailableException(
          "Customer obligation assessment details changed during pagination.",
        );
      }
      return {
        assessmentId: row.assessmentId,
        assessmentName: row.assessmentName,
        outcome: rule.outcome,
        freshnessStatus: row.freshnessStatus,
        observedAt: row.observedAt,
        trustStatus: row.trustStatus,
      };
    });
    return customerTrackingObligationAssessmentsSchema.parse({
      items,
      pagination: {
        total: payload.total,
        limit,
        offset,
        hasMore: offset + items.length < payload.total,
      },
      generatedAt: new Date().toISOString(),
    });
  }

  /**
   * Business purpose: Summarize evaluated compliance obligations and identify assessments that cannot be evaluated.
   * Business rules: Only owner data is considered; missing or incomplete rule coverage never counts as an evaluated all-clear; outcome, freshness, and attention filters are applied before pagination.
   * Execution flow: 1. Validate the role. 2. Aggregate canonical outcomes, source freshness, and evaluation coverage in PostgreSQL. 3. Apply filters before stable group pagination. 4. Batch-load canonical details for at most twenty preview assessments per returned group. 5. Return exact totals and evaluation metadata.
   * Failure cases: Non-customer roles receive an empty page; unavailable data access propagates through the shared API problem handling.
   * Side effects: Read-only database access.
   */
  async loadCustomerObligations(input: {
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
    limit?: number;
    offset?: number;
    outcome?: TrackingRuleOutcome;
    freshness?: TrackingFreshnessStatus;
    needsAttention?: boolean;
  }): Promise<CustomerTrackingObligations> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    if (input.subjectRole !== AUTH_USER_ROLES.customer) {
      return customerTrackingObligationsSchema.parse({
        items: [],
        pagination: { total: 0, limit, offset, hasMore: false },
        evaluationSummary: {
          evaluatedAssessmentCount: 0,
          notEvaluatedAssessmentCount: 0,
        },
        generatedAt: new Date().toISOString(),
      });
    }
    return this.loadCustomerObligationsFromDatabase(input, limit, offset);
  }

  /**
   * Business purpose: Return exact owner-wide obligation totals without reading the full assessment ledger into application memory.
   * Business rules: The shared canonical SQL validator determines outcomes; owner scope is applied inside every owner-scoped query; only requested groups and their first twenty assessment details are returned.
   * Execution flow: 1. Aggregate canonical decision outcomes and evaluation coverage in PostgreSQL. 2. Apply outcome and attention filters before stable group pagination. 3. Batch-load canonical tracking details for preview assessment IDs on the requested page. 4. Return exact totals and evaluation counts.
   * Failure cases: SQL or detail reads that fail propagate through the shared API error handling; missing preview rows are omitted rather than assigned fabricated statuses.
   * Side effects: Read-only owner-scoped database access.
   */
  private async loadCustomerObligationsFromDatabase(
    input: {
      sessionUserId: string;
      correlationId: string;
      outcome?: TrackingRuleOutcome;
      needsAttention?: boolean;
      freshness?: TrackingFreshnessStatus;
    },
    limit: number,
    offset: number,
  ): Promise<CustomerTrackingObligations> {
    let aggregateRows: Array<{ payload: TrackingObligationAggregatePayload }>;
    try {
      aggregateRows = await this.prisma.$queryRaw<
        Array<{ payload: TrackingObligationAggregatePayload }>
      >(Prisma.sql`
      ${ownerCanonicalDecisionEvaluationCte(input.sessionUserId)},
      /* tracking-obligation-aggregate */
      owner_freshness AS (
        SELECT
          a."id" AS "assessmentId",
          CASE
            WHEN latest."id" IS NOT NULL
              AND pinned."id" IS NOT NULL
              AND latest."id" <> pinned."id"
              AND latest."createdAt" > pinned."createdAt"
              AND LOWER(latest."commitSha") = LOWER(COALESCE(ac."repositoryCommit", pinned."commitSha"))
              THEN ${TRACKING_FRESHNESS_STATUSES.CURRENT}
            WHEN latest."id" IS NOT NULL
              AND pinned."id" IS NOT NULL
              AND latest."id" <> pinned."id"
              AND latest."createdAt" > pinned."createdAt"
              THEN ${TRACKING_FRESHNESS_STATUSES.STALE}
            ELSE ${TRACKING_FRESHNESS_STATUSES.UNKNOWN}
          END AS "freshnessStatus"
        FROM "Assessment" a
        LEFT JOIN "AssessmentCase" ac ON ac."assessmentId" = a."id"
        LEFT JOIN "RepositorySnapshot" pinned ON pinned."id" = ac."repositorySnapshotId"
        LEFT JOIN LATERAL (
          SELECT candidate."id", candidate."createdAt", candidate."commitSha"
          FROM "RepositorySnapshot" candidate
          WHERE candidate."status" = ${REPOSITORY_SNAPSHOT_STATUSES.ready}
            AND candidate."repositoryFullName" = pinned."repositoryFullName"
            AND (
              candidate."ref" = COALESCE(pinned."ref", pinned."branch")
              OR (candidate."ref" IS NULL AND candidate."branch" = COALESCE(pinned."ref", pinned."branch"))
            )
            AND (
              EXISTS (
                SELECT 1 FROM "Assessment" snapshot_assessment
                WHERE snapshot_assessment."id" = candidate."assessmentId"
                  AND snapshot_assessment."ownerId" = ${input.sessionUserId}
              )
              OR EXISTS (
                SELECT 1 FROM "RepositoryConnection" snapshot_connection
                WHERE snapshot_connection."id" = candidate."connectionId"
                  AND snapshot_connection."userId" = ${input.sessionUserId}
                  AND snapshot_connection."status" = ${REPOSITORY_CONNECTION_STATUSES.active}
              )
            )
          ORDER BY candidate."createdAt" DESC, candidate."id" ASC
          LIMIT 1
        ) latest ON true
        WHERE a."ownerId" = ${input.sessionUserId}
      ),
      portfolio_evaluation AS (
        SELECT
          COUNT(*) FILTER (WHERE (
            ac."pinnedAt" IS NOT NULL
            AND ac."ruleSetVersionId" IS NOT NULL
            AND ac."repositorySnapshotId" IS NOT NULL
            AND ac."repositoryScanJobId" IS NOT NULL
            AND ac."repositoryCommit" IS NOT NULL
            AND rs."validationOutcome" = ${COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED}
            AND expected."ruleCount" > 0
            AND coverage."coverageCount" = expected."ruleCount"
          ))::int AS "evaluatedAssessmentCount",
          COUNT(*) FILTER (WHERE NOT (
            ac."pinnedAt" IS NOT NULL
            AND ac."ruleSetVersionId" IS NOT NULL
            AND ac."repositorySnapshotId" IS NOT NULL
            AND ac."repositoryScanJobId" IS NOT NULL
            AND ac."repositoryCommit" IS NOT NULL
            AND rs."validationOutcome" = ${COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED}
            AND expected."ruleCount" > 0
            AND coverage."coverageCount" = expected."ruleCount"
          ))::int AS "notEvaluatedAssessmentCount"
        FROM "Assessment" a
        JOIN owner_freshness freshness ON freshness."assessmentId" = a."id"
        LEFT JOIN "AssessmentCase" ac ON ac."assessmentId" = a."id"
        LEFT JOIN "ComplianceRuleSetVersion" rs ON rs."id" = ac."ruleSetVersionId"
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "ruleCount"
          FROM "AssessmentRule" ar
          WHERE ar."ruleSetVersionId" = ac."ruleSetVersionId"
        ) expected ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "coverageCount"
          FROM "AssessmentDecisionCoverage" adc
          WHERE adc."assessmentId" = a."id"
        ) coverage ON true
        WHERE a."ownerId" = ${input.sessionUserId}
          AND (${input.freshness ?? null}::text IS NULL OR freshness."freshnessStatus" = ${input.freshness ?? null}::text)
      ),
      normalized AS (
        SELECT
          e."assessmentId",
          e."assessmentName",
          e."updatedAt",
          e."ruleSetVersionId",
          e."assessmentRuleId",
          rs."version" AS "ruleSetVersion",
          ar."concept",
          freshness."freshnessStatus",
          CASE
            WHEN e."is_valid" = true AND e."applicability" = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
            WHEN e."is_valid" = true AND e."applicability" = 'APPLICABLE' AND e."compliance" = 'COMPLIANT' THEN 'COMPLIANT'
            WHEN e."is_valid" = true AND e."applicability" = 'APPLICABLE' AND e."compliance" = 'NON_COMPLIANT' THEN 'NON_COMPLIANT'
            ELSE 'UNRESOLVED'
          END AS outcome
        FROM evaluated e
        JOIN "AssessmentRule" ar
          ON ar."ruleSetVersionId" = e."ruleSetVersionId"
          AND ar."assessmentRuleId" = e."assessmentRuleId"
        LEFT JOIN "ComplianceRuleSetVersion" rs ON rs."id" = e."ruleSetVersionId"
        JOIN owner_freshness freshness ON freshness."assessmentId" = e."assessmentId"
        WHERE (${input.outcome ?? null}::text IS NULL OR (
          CASE
            WHEN e."is_valid" = true AND e."applicability" = 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE'
            WHEN e."is_valid" = true AND e."applicability" = 'APPLICABLE' AND e."compliance" = 'COMPLIANT' THEN 'COMPLIANT'
            WHEN e."is_valid" = true AND e."applicability" = 'APPLICABLE' AND e."compliance" = 'NON_COMPLIANT' THEN 'NON_COMPLIANT'
            ELSE 'UNRESOLVED'
          END
        ) = ${input.outcome ?? null}::text)
          AND (${input.freshness ?? null}::text IS NULL OR freshness."freshnessStatus" = ${input.freshness ?? null}::text)
      ),
      ranked AS (
        SELECT normalized.*,
          ROW_NUMBER() OVER (
            PARTITION BY "ruleSetVersionId", "assessmentRuleId"
            ORDER BY "updatedAt" DESC, "assessmentId" ASC
          ) AS "previewRank"
        FROM normalized
      ),
      grouped AS (
        SELECT
          "ruleSetVersionId",
          MAX("ruleSetVersion") AS "ruleSetVersion",
          "assessmentRuleId",
          MAX("concept") AS concept,
          COUNT(*) FILTER (WHERE outcome = 'COMPLIANT')::int AS "compliantCount",
          COUNT(*) FILTER (WHERE outcome = 'NON_COMPLIANT')::int AS "nonCompliantCount",
          COUNT(*) FILTER (WHERE outcome = 'NOT_APPLICABLE')::int AS "notApplicableCount",
          COUNT(*) FILTER (WHERE outcome = 'UNRESOLVED')::int AS "unresolvedCount",
          COUNT(*)::int AS "affectedAssessmentCount",
          ARRAY_AGG("assessmentId" ORDER BY "updatedAt" DESC, "assessmentId" ASC)
            FILTER (WHERE "previewRank" <= 20) AS "previewAssessmentIds"
        FROM ranked
        GROUP BY "ruleSetVersionId", "assessmentRuleId"
      ),
      filtered AS (
        SELECT * FROM grouped
        WHERE (${input.needsAttention ?? null}::boolean IS NULL OR (
          ("nonCompliantCount" > 0 OR "unresolvedCount" > 0)
          = ${input.needsAttention ?? false}::boolean
        ))
      ),
      group_page AS (
        SELECT * FROM filtered
        ORDER BY
          ("nonCompliantCount" > 0 OR "unresolvedCount" > 0) DESC,
          "nonCompliantCount" DESC,
          "unresolvedCount" DESC,
          concept ASC,
          "ruleSetVersionId" ASC,
          "assessmentRuleId" ASC
        LIMIT ${limit} OFFSET ${offset}
      )
      SELECT jsonb_build_object(
        'total', (SELECT COUNT(*)::int FROM filtered),
        'evaluationSummary', (SELECT to_jsonb(portfolio_evaluation) FROM portfolio_evaluation),
        'items', COALESCE((
          SELECT jsonb_agg(to_jsonb(group_page) ORDER BY
            (group_page."nonCompliantCount" > 0 OR group_page."unresolvedCount" > 0) DESC,
            group_page."nonCompliantCount" DESC,
            group_page."unresolvedCount" DESC,
            group_page.concept ASC,
            group_page."ruleSetVersionId" ASC,
            group_page."assessmentRuleId" ASC
          ) FROM group_page
        ), '[]'::jsonb)
      ) AS payload
      `);
    } catch (error) {
      this.logger.error(
        `Customer obligation aggregate SQL failed for owner ${input.sessionUserId} (correlationId: ${input.correlationId}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        `Customer obligation aggregate is temporarily unavailable (correlationId: ${input.correlationId}).`,
      );
    }
    const [aggregate] = aggregateRows;
    if (!aggregate?.payload) {
      throw new ServiceUnavailableException(
        `Customer obligation aggregate is temporarily unavailable (correlationId: ${input.correlationId}).`,
      );
    }
    const previewIds = [
      ...new Set(
        aggregate.payload.items.flatMap((item) => item.previewAssessmentIds),
      ),
    ];
    const previewPages = await mapWithConcurrency(
      Array.from({ length: Math.ceil(previewIds.length / 100) }, (_, index) =>
        previewIds.slice(index * 100, (index + 1) * 100),
      ),
      3,
      (ids) => this.loadCustomerTrackingRows(input.sessionUserId, ids),
    );
    const rowsById = new Map(
      previewPages.flat().map((row) => [row.assessmentId, row]),
    );
    const items = aggregate.payload.items.map((item) => ({
      ruleSetVersionId: item.ruleSetVersionId,
      ruleSetVersion: item.ruleSetVersion,
      assessmentRuleId: item.assessmentRuleId,
      concept: item.concept,
      compliantCount: item.compliantCount,
      nonCompliantCount: item.nonCompliantCount,
      notApplicableCount: item.notApplicableCount,
      unresolvedCount: item.unresolvedCount,
      affectedAssessmentCount: item.affectedAssessmentCount,
      assessments: item.previewAssessmentIds.flatMap((assessmentId) => {
        const row = rowsById.get(assessmentId);
        const rule = row?.rules.find(
          (candidate) => candidate.assessmentRuleId === item.assessmentRuleId,
        );
        return row && rule
          ? [
              {
                assessmentId,
                assessmentName: row.assessmentName,
                outcome: rule.outcome,
                freshnessStatus: row.freshnessStatus,
                observedAt: row.observedAt,
                trustStatus: row.trustStatus,
              },
            ]
          : [];
      }),
    }));
    return customerTrackingObligationsSchema.parse({
      items,
      pagination: {
        total: aggregate.payload.total,
        limit,
        offset,
        hasMore: offset + items.length < aggregate.payload.total,
      },
      evaluationSummary: aggregate.payload.evaluationSummary,
      generatedAt: new Date().toISOString(),
    });
  }

  /**
   * Business purpose: Build canonical owner-scoped report and obligation rows from assessment evidence.
   * Business rules: Every read is restricted to the customer owner; decision pointers, evidence, facts, pins, rule-set coverage, and source freshness are revalidated before assigning outcomes or trust.
   * Execution flow: 1. Read owned assessments and coverage. 2. Batch-load associated decisions and records. 3. Batch-load repository snapshots and rule counts. 4. Evaluate each assessment and return normalized rows.
   * Failure cases: Missing, inconsistent, incomplete, invalidated, or stale inputs fail closed into unavailable, unresolved, or untrusted statuses.
   * Side effects: Read-only database access.
   */
  private async loadCustomerTrackingRows(
    sessionUserId: string,
    assessmentIds?: string[],
    page?: { skip: number; take: number; reportsOnly?: boolean },
  ) {
    const assessments = await this.prisma.assessment.findMany({
      where: {
        ownerId: sessionUserId,
        ...(assessmentIds ? { id: { in: assessmentIds } } : {}),
        ...(page?.reportsOnly
          ? {
              lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
              domainCase: {
                is: {
                  artifacts: {
                    some: {
                      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
                      lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
                    },
                  },
                },
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      ...(page ? { skip: page.skip, take: page.take } : {}),
      select: {
        id: true,
        name: true,
        lifecycleState: true,
        blockerReason: true,
        domainCase: {
          select: {
            caseRevision: true,
            pinnedAt: true,
            ruleSetVersionId: true,
            repositorySnapshotId: true,
            repositoryScanJobId: true,
            repositoryCommit: true,
            ruleSet: { select: { version: true, validationOutcome: true } },
            coverage: {
              select: {
                assessmentId: true,
                assessmentRuleId: true,
                ruleSetVersionId: true,
                assessmentRuleVersion: true,
                resolutionState: true,
                currentDecisionId: true,
                decisionRevision: true,
                assessmentRule: { select: { concept: true } },
              },
            },
            artifacts: {
              where: {
                kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
                lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { artifactId: true, createdAt: true },
            },
          },
        },
      },
    });
    const ids = assessments.map((row) => row.id);
    const coverage = ids.length
      ? await this.prisma.assessmentDecisionCoverage.findMany({
          where: { assessmentId: { in: ids } },
          select: {
            assessmentId: true,
            assessmentRuleId: true,
            ruleSetVersionId: true,
            assessmentRuleVersion: true,
            resolutionState: true,
            currentDecisionId: true,
            decisionRevision: true,
          },
        })
      : [];
    const [
      decisions,
      evidence,
      facts,
      invalidatedDecisions,
      invalidatedEvidence,
      invalidatedFacts,
    ] = ids.length
      ? await Promise.all([
          this.prisma.assessmentRuleDecision.findMany({
            where: {
              assessmentId: { in: ids },
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
              assessmentId: { in: ids },
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
              assessmentId: { in: ids },
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
              assessmentId: { in: ids },
              state: ASSESSMENT_DECISION_RECORD_STATES.INVALIDATED,
            },
            select: { assessmentId: true },
          }),
          this.prisma.assessmentEvidence.findMany({
            where: {
              assessmentId: { in: ids },
              state: ASSESSMENT_RECORD_STATES.INVALIDATED,
            },
            select: { assessmentId: true },
          }),
          this.prisma.assessmentCaseFact.findMany({
            where: {
              assessmentId: { in: ids },
              state: ASSESSMENT_RECORD_STATES.INVALIDATED,
            },
            select: { assessmentId: true },
          }),
        ])
      : [[], [], [], [], [], []];
    const decisionsById = new Map(
      decisions.map((item) => [item.decisionId, item]),
    );
    const evidenceById = new Map(
      evidence.map((item) => [item.evidenceId, item]),
    );
    const factsById = new Map(facts.map((item) => [item.factId, item]));
    const invalidatedIds = new Set([
      ...invalidatedDecisions.map((item) => item.assessmentId),
      ...invalidatedEvidence.map((item) => item.assessmentId),
      ...invalidatedFacts.map((item) => item.assessmentId),
    ]);
    const coverageByAssessment = new Map<string, typeof coverage>();
    for (const item of coverage) {
      const list = coverageByAssessment.get(item.assessmentId) ?? [];
      list.push(item);
      coverageByAssessment.set(item.assessmentId, list);
    }

    const pinnedIds = [
      ...new Set(
        assessments
          .map((item) => item.domainCase?.repositorySnapshotId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const pinnedSnapshots = pinnedIds.length
      ? await this.prisma.repositorySnapshot.findMany({
          where: { id: { in: pinnedIds } },
          select: {
            id: true,
            repositoryFullName: true,
            ref: true,
            branch: true,
            commitSha: true,
            createdAt: true,
          },
        })
      : [];
    const pinnedById = new Map(pinnedSnapshots.map((item) => [item.id, item]));
    const latestKeys = [
      ...new Map(
        pinnedSnapshots.map((item) => [
          `${item.repositoryFullName}::${item.ref ?? item.branch ?? ""}`,
          item,
        ]),
      ).values(),
    ];
    const latestByKey = new Map<string, (typeof pinnedSnapshots)[number]>();
    const latestSnapshots = latestKeys.length
      ? await this.prisma.repositorySnapshot.findMany({
          where: {
            status: REPOSITORY_SNAPSHOT_STATUSES.ready,
            OR: latestKeys.map((item) => ({
              repositoryFullName: item.repositoryFullName,
              OR: [
                { ref: item.ref ?? item.branch },
                { branch: item.ref ?? item.branch },
              ],
            })),
            AND: [
              {
                OR: [
                  { assessment: { ownerId: sessionUserId } },
                  {
                    connection: {
                      userId: sessionUserId,
                      status: REPOSITORY_CONNECTION_STATUSES.active,
                    },
                  },
                ],
              },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          distinct: ["repositoryFullName", "ref", "branch"],
          select: {
            id: true,
            repositoryFullName: true,
            ref: true,
            branch: true,
            commitSha: true,
            createdAt: true,
          },
        })
      : [];
    for (const latest of latestSnapshots) {
      const key = `${latest.repositoryFullName}::${latest.ref ?? latest.branch ?? ""}`;
      const current = latestByKey.get(key);
      if (!current || latest.createdAt > current.createdAt) {
        latestByKey.set(key, latest);
      }
    }

    const ruleSetVersionIds = [
      ...new Set(
        assessments
          .map((item) => item.domainCase?.ruleSetVersionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const expectedRuleCounts = await mapWithConcurrency(
      ruleSetVersionIds,
      5,
      async (ruleSetVersionId) =>
        [
          ruleSetVersionId,
          await this.prisma.assessmentRule.count({
            where: { ruleSetVersionId },
          }),
        ] as const,
    );
    const expectedRuleCountByVersionId = new Map(expectedRuleCounts);

    return assessments.map((assessment) => {
      const domainCase = assessment.domainCase;
      const assessmentCoverage = coverageByAssessment.get(assessment.id) ?? [];
      const completePins = Boolean(
        domainCase?.pinnedAt &&
        domainCase.ruleSetVersionId &&
        domainCase.repositorySnapshotId &&
        domainCase.repositoryScanJobId &&
        domainCase.repositoryCommit,
      );
      const pinned = domainCase?.repositorySnapshotId
        ? pinnedById.get(domainCase.repositorySnapshotId)
        : undefined;
      let freshnessStatus: TrackingFreshnessStatus =
        TRACKING_FRESHNESS_STATUSES.UNKNOWN;
      let observedAt: string | null = null;
      let repositoryName: string | null = null;
      let repositoryOwner: string | null = null;
      if (pinned) {
        const parts = pinned.repositoryFullName.split("/");
        repositoryOwner = parts.length > 1 ? parts[0] : null;
        repositoryName =
          parts.length > 1
            ? parts.slice(1).join("/")
            : pinned.repositoryFullName;
        const latest = latestByKey.get(
          `${pinned.repositoryFullName}::${pinned.ref ?? pinned.branch ?? ""}`,
        );
        if (
          latest &&
          latest.id !== pinned.id &&
          latest.createdAt > pinned.createdAt
        ) {
          observedAt = latest.createdAt.toISOString();
          freshnessStatus =
            latest.commitSha.toLowerCase() ===
            (domainCase?.repositoryCommit ?? pinned.commitSha).toLowerCase()
              ? TRACKING_FRESHNESS_STATUSES.CURRENT
              : TRACKING_FRESHNESS_STATUSES.STALE;
        }
      }
      const evaluation =
        domainCase?.ruleSetVersionId && domainCase.repositoryCommit
          ? evaluateAssessmentDecisions({
              assessmentId: assessment.id,
              domainCase: {
                ruleSetVersionId: domainCase.ruleSetVersionId,
                caseRevision: domainCase.caseRevision,
                repositoryCommit: domainCase.repositoryCommit,
                repositorySnapshotId: domainCase.repositorySnapshotId,
              },
              coverage: assessmentCoverage,
              decisionsById,
              evidenceById,
              factsById,
            })
          : null;
      const expectedRulesCount = domainCase?.ruleSetVersionId
        ? (expectedRuleCountByVersionId.get(domainCase.ruleSetVersionId) ?? 0)
        : 0;
      const hasCompleteCoverage = Boolean(
        completePins &&
        hasCanonicalCompleteCoverage(
          assessmentCoverage.length,
          expectedRulesCount,
        ) &&
        domainCase?.ruleSet?.validationOutcome === "PASSED",
      );
      const report = domainCase?.artifacts[0] ?? null;
      const lifecycleComplete =
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE;
      let trustStatus: TrackingTrustStatus;
      if (!completePins) trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
      else if (
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED ||
        assessment.blockerReason !== null
      )
        trustStatus = TRACKING_TRUST_STATUSES.BLOCKED;
      else if (
        evaluation?.hasDecisionInconsistency ||
        invalidatedIds.has(assessment.id)
      )
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
      else if (freshnessStatus === TRACKING_FRESHNESS_STATUSES.STALE)
        trustStatus = TRACKING_TRUST_STATUSES.STALE;
      else if (domainCase?.ruleSet?.validationOutcome !== "PASSED")
        trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
      else if (
        !lifecycleComplete ||
        !evaluation ||
        !hasCompleteCoverage ||
        evaluation.unresolved > 0
      )
        trustStatus = TRACKING_TRUST_STATUSES.IN_PROGRESS;
      else if (!report) trustStatus = TRACKING_TRUST_STATUSES.DATA_UNAVAILABLE;
      else trustStatus = TRACKING_TRUST_STATUSES.TRUSTED;
      return {
        assessmentId: assessment.id,
        assessmentName: assessment.name,
        repositoryName,
        repositoryOwner,
        ruleSetVersionId: domainCase?.ruleSetVersionId ?? null,
        ruleSetVersion: domainCase?.ruleSet?.version ?? null,
        lifecycleComplete,
        reportArtifactId: report?.artifactId ?? null,
        reportCreatedAt: report?.createdAt.toISOString() ?? null,
        freshnessStatus,
        observedAt,
        trustStatus,
        hasCompleteCoverage,
        rules: assessmentCoverage.map((rule) => ({
          assessmentRuleId: rule.assessmentRuleId,
          concept:
            assessment.domainCase?.coverage.find(
              (item) => item.assessmentRuleId === rule.assessmentRuleId,
            )?.assessmentRule.concept ?? rule.assessmentRuleId,
          outcome:
            evaluation?.outcomes.get(rule.assessmentRuleId) ??
            TRACKING_RULE_OUTCOMES.UNRESOLVED,
        })),
      };
    });
  }

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

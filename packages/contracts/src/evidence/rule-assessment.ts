import { z } from "zod";

/**
 * Per-EngineeringRule assessment produced by the repository-analyst Deep Agent
 * and persisted by the API as the accepted-evidence ledger (RuleEvidenceIndex).
 * The Python runtime mirrors these value sets; the API validates every write
 * against ACCEPTED_RULE_ASSESSMENT_SCHEMA.
 */
export const RULE_CRITERION_STATUSES = {
  evidenceFound: "EVIDENCE_FOUND",
  businessContextRequired: "BUSINESS_CONTEXT_REQUIRED",
  technicalUnresolved: "TECHNICAL_UNRESOLVED",
  notObserved: "NOT_OBSERVED",
} as const;

export type RuleCriterionStatus =
  (typeof RULE_CRITERION_STATUSES)[keyof typeof RULE_CRITERION_STATUSES];

/**
 * Kind of POSITIVE evidence an EVIDENCE_FOUND criterion carries. The model reports
 * what the evidence shows; it never decides compliance.
 */
export const RULE_EVIDENCE_KINDS = {
  supportsRequirement: "SUPPORTS_REQUIREMENT",
  demonstratesViolation: "DEMONSTRATES_VIOLATION",
} as const;

export type RuleEvidenceKind =
  (typeof RULE_EVIDENCE_KINDS)[keyof typeof RULE_EVIDENCE_KINDS];

export const RULE_ANALYSIS_STATUSES = {
  completed: "COMPLETED",
  needsContext: "NEEDS_CONTEXT",
  unresolved: "UNRESOLVED",
  failed: "FAILED",
} as const;

export type RuleAnalysisStatus =
  (typeof RULE_ANALYSIS_STATUSES)[keyof typeof RULE_ANALYSIS_STATUSES];

export const BUSINESS_CONTEXT_NEED_STATES = {
  active: "ACTIVE",
  resolved: "RESOLVED",
  cancelled: "CANCELLED",
} as const;

export type BusinessContextNeedState =
  (typeof BUSINESS_CONTEXT_NEED_STATES)[keyof typeof BUSINESS_CONTEXT_NEED_STATES];

export const RULE_ANALYSIS_ACTIVITIES = {
  ruleAnalysisStarted: "RULE_ANALYSIS_STARTED",
  ruleAnalysisCompleted: "RULE_ANALYSIS_COMPLETED",
  ruleAnalysisNeedsContext: "RULE_ANALYSIS_NEEDS_CONTEXT",
  ruleAnalysisUnresolved: "RULE_ANALYSIS_UNRESOLVED",
  ruleAnalysisFailed: "RULE_ANALYSIS_FAILED",
  businessContextRequested: "BUSINESS_CONTEXT_REQUESTED",
  businessContextResolved: "BUSINESS_CONTEXT_RESOLVED",
  ruleAnalysisResumed: "RULE_ANALYSIS_RESUMED",
  ruleApplicabilityEvaluated: "RULE_APPLICABILITY_EVALUATED",
  ruleCompletionGated: "RULE_COMPLETION_GATED",
} as const;

/** Per-rule runtime event tool name: `rule_analysis:{engineeringRuleId}`. */
export const RULE_ANALYSIS_TOOL_PREFIX = "rule_analysis:";

/** Once-per-loop summary event tool name (rule counts by applicability). */
export const RULE_ANALYSIS_SUMMARY_TOOL = "rule_analysis_summary";

export type RuleAnalysisActivity =
  (typeof RULE_ANALYSIS_ACTIVITIES)[keyof typeof RULE_ANALYSIS_ACTIVITIES];

/**
 * Canonical governed evidence ref: `source:{commitSha}:{path}#L{start}-L{end}`.
 * Runtime-minted `~mac` suffixes are stripped before persistence; a ref containing
 * `~` never matches.
 */
export const RULE_EVIDENCE_REF_PATTERN =
  /^source:[A-Za-z0-9_.-]{7,64}:[^#\s~]+#L[0-9]+-L[0-9]+$/;

const RULE_ASSESSMENT_LIMITS = {
  maxCriteria: 100,
  maxEvidencePerCriterion: 50,
  maxTechnicalFacts: 10,
  maxTechnicalFactLength: 500,
  maxLimitations: 20,
  maxQuestionLength: 1000,
  maxObservationLength: 1000,
} as const;

const valuesOf = <T extends Record<string, string>>(record: T) =>
  Object.values(record) as [T[keyof T], ...T[keyof T][]];

const LIMITATION_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/);

/** LCSP-stamped provenance of one accepted evidence entry; never model-supplied. */
export const RULE_ASSESSMENT_EVIDENCE_PROVENANCE_SCHEMA = z.object({
  assessmentId: z.string().min(1).max(100),
  repositoryVersion: z.string().min(7).max(64),
  engineeringRuleId: z.string().min(1).max(200),
  criterionId: z.string().min(1).max(200),
  validator: z.string().min(1).max(200),
});

export const RULE_ASSESSMENT_EVIDENCE_SCHEMA = z.object({
  ref: z.string().regex(RULE_EVIDENCE_REF_PATTERN),
  path: z.string().min(1).max(1024),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  symbol: z.string().max(300).nullish(),
  provenance: RULE_ASSESSMENT_EVIDENCE_PROVENANCE_SCHEMA,
});

export const RULE_BUSINESS_CONTEXT_NEED_SCHEMA = z.object({
  needId: z.string().min(1).max(300),
  question: z.string().min(1).max(RULE_ASSESSMENT_LIMITS.maxQuestionLength),
  observation: z
    .string()
    .min(1)
    .max(RULE_ASSESSMENT_LIMITS.maxObservationLength),
  authoredConditionIndex: z.number().int().min(0).nullish(),
  resolutionCriterionIds: z.array(z.string().min(1).max(200)).min(1).max(50),
});

export const RULE_CRITERION_ASSESSMENT_SCHEMA = z
  .object({
    criterionId: z.string().min(1).max(200),
    status: z.enum(valuesOf(RULE_CRITERION_STATUSES)),
    evidenceKind: z.enum(valuesOf(RULE_EVIDENCE_KINDS)).nullish(),
    evidenceRefs: z
      .array(z.string().regex(RULE_EVIDENCE_REF_PATTERN))
      .max(RULE_ASSESSMENT_LIMITS.maxEvidencePerCriterion),
    evidence: z
      .array(RULE_ASSESSMENT_EVIDENCE_SCHEMA)
      .max(RULE_ASSESSMENT_LIMITS.maxEvidencePerCriterion),
    technicalFacts: z
      .array(z.string().max(RULE_ASSESSMENT_LIMITS.maxTechnicalFactLength))
      .max(RULE_ASSESSMENT_LIMITS.maxTechnicalFacts),
    limitations: z
      .array(LIMITATION_CODE)
      .max(RULE_ASSESSMENT_LIMITS.maxLimitations),
    businessContextNeed: RULE_BUSINESS_CONTEXT_NEED_SCHEMA.nullish(),
  })
  .superRefine((criterion, ctx) => {
    if (
      criterion.status === RULE_CRITERION_STATUSES.evidenceFound &&
      criterion.evidenceRefs.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "EVIDENCE_FOUND requires at least one evidence ref",
      });
    }
    const isFound = criterion.status === RULE_CRITERION_STATUSES.evidenceFound;
    if (isFound && !criterion.evidenceKind) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceKind"],
        message: "EVIDENCE_FOUND requires evidenceKind",
      });
    }
    if (!isFound && criterion.evidenceKind) {
      ctx.addIssue({
        code: "custom",
        path: ["evidenceKind"],
        message: "evidenceKind is only allowed for EVIDENCE_FOUND",
      });
    }
    if (
      criterion.status === RULE_CRITERION_STATUSES.businessContextRequired &&
      !criterion.businessContextNeed
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["businessContextNeed"],
        message: "BUSINESS_CONTEXT_REQUIRED requires businessContextNeed",
      });
    }
    if (
      (criterion.status === RULE_CRITERION_STATUSES.notObserved ||
        criterion.status === RULE_CRITERION_STATUSES.technicalUnresolved) &&
      criterion.limitations.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["limitations"],
        message: `${criterion.status} requires at least one limitation`,
      });
    }
  });

export const RULE_ASSESSMENT_EXECUTION_SCHEMA = z.object({
  provider: z.string().max(100).nullish(),
  model: z.string().max(200).nullish(),
  runId: z.string().max(200).nullish(),
  attempt: z.number().int().min(1),
  durationMs: z.number().int().min(0).nullish(),
  modelCalls: z.number().int().min(0).nullish(),
  toolCalls: z.number().int().min(0).nullish(),
  exceptionType: z.string().max(200).nullish(),
});

export const ACCEPTED_RULE_ASSESSMENT_SCHEMA = z.object({
  resultId: z.string().min(1).max(200),
  assessmentId: z.string().min(1).max(100),
  engineeringRuleId: z.string().min(1).max(200),
  engineeringRuleVersion: z.string().min(1).max(200),
  repositoryVersion: z.string().min(7).max(64),
  contextRevision: z.number().int().min(0),
  status: z.enum(valuesOf(RULE_ANALYSIS_STATUSES)),
  criteria: z
    .array(RULE_CRITERION_ASSESSMENT_SCHEMA)
    .max(RULE_ASSESSMENT_LIMITS.maxCriteria),
  limitations: z
    .array(LIMITATION_CODE)
    .max(RULE_ASSESSMENT_LIMITS.maxLimitations),
  execution: RULE_ASSESSMENT_EXECUTION_SCHEMA,
});

export type RuleAssessmentEvidence = z.infer<
  typeof RULE_ASSESSMENT_EVIDENCE_SCHEMA
>;
export type RuleBusinessContextNeed = z.infer<
  typeof RULE_BUSINESS_CONTEXT_NEED_SCHEMA
>;
export type RuleCriterionAssessment = z.infer<
  typeof RULE_CRITERION_ASSESSMENT_SCHEMA
>;
export type RuleAssessmentExecution = z.infer<
  typeof RULE_ASSESSMENT_EXECUTION_SCHEMA
>;
export type AcceptedRuleAssessment = z.infer<
  typeof ACCEPTED_RULE_ASSESSMENT_SCHEMA
>;

/** Rule status derivation shared by the API ledger and the runtime. */
export function deriveRuleAnalysisStatus(
  criteria: ReadonlyArray<{ status: RuleCriterionStatus }>,
): RuleAnalysisStatus {
  if (
    criteria.some(
      (criterion) =>
        criterion.status === RULE_CRITERION_STATUSES.businessContextRequired,
    )
  ) {
    return RULE_ANALYSIS_STATUSES.needsContext;
  }
  if (
    criteria.some(
      (criterion) =>
        criterion.status === RULE_CRITERION_STATUSES.technicalUnresolved ||
        criterion.status === RULE_CRITERION_STATUSES.notObserved,
    )
  ) {
    return RULE_ANALYSIS_STATUSES.unresolved;
  }
  return RULE_ANALYSIS_STATUSES.completed;
}

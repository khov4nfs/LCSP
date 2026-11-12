import { z } from "zod";

import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
} from "../assessment-domain/constants.ts";
import { LEGAL_REQUIREMENT_COVERAGE_STATES } from "../compliance-rule-set/constants.ts";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferenceSchema,
  ruleDecisionReferences,
  ruleDecisionSchema,
  type RuleDecisionReference,
} from "../assessment/agentic-runtime.ts";
import {
  isCanonicalRepositorySourcePath,
  isRepositoryPathInSourceScope,
  repositorySourcePathPrefixSchema,
} from "../github-integration/source-scope.ts";
import {
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_LIMITS,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
  type AssessmentReportFieldClassification,
  type AssessmentReportSourceScopeMode,
  type AssessmentReportSourceVisibilityLimitationReason,
  type AssessmentReportSourceVisibilityState,
} from "./constants.ts";

const utf8Encoder = new TextEncoder();

/**
 * Business purpose: Measure the exact UTF-8 byte length of report text separately from JavaScript UTF-16 code-unit length.
 *
 * Business rules:
 * - Multi-byte characters such as Vietnamese diacritics and supplementary Unicode characters count by their encoded UTF-8 byte size, not string `.length`.
 *
 * Execution flow:
 * 1. Encode the supplied string as UTF-8 and return its byte length.
 *
 * Failure cases:
 * - Non-string inputs are prevented by TypeScript types and upstream schema parsing.
 *
 * Side effects:
 * - None: pure in-memory byte calculation.
 */
export function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

const identifierSchema = z
  .string()
  .min(1)
  .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_IDENTIFIER_CHARS);
const uuidSchema = z.uuid();
const revisionSchema = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const boundedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_TEXT_CHARS)
  .refine(
    (value) =>
      utf8ByteLength(value) <= ASSESSMENT_REPORT_V3_LIMITS.MAX_TEXT_UTF8_BYTES,
    {
      message: `Text exceeds maximum UTF-8 byte limit (${ASSESSMENT_REPORT_V3_LIMITS.MAX_TEXT_UTF8_BYTES})`,
    },
  );
const boundedTextListSchema = z
  .array(boundedTextSchema)
  .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS);

const sourceReferenceSchemaV3 = z.strictObject({
  legalSourceVersionId: uuidSchema,
  legalSourceVersion: boundedTextSchema,
  documentId: identifierSchema,
  documentTitle: boundedTextSchema.optional(),
  locator: boundedTextSchema,
  contentSha256: sha256Schema,
});

const legalRequirementSchemaV3 = z.strictObject({
  legalRequirementId: identifierSchema,
  title: boundedTextSchema,
  proposition: boundedTextSchema,
  applicabilityConditions: boundedTextListSchema,
  qualifiers: boundedTextListSchema,
  exceptions: boundedTextListSchema,
  nonRepositoryDuty: z.boolean(),
  coverageState: z.enum(LEGAL_REQUIREMENT_COVERAGE_STATES),
  sourceRefs: z
    .array(sourceReferenceSchemaV3)
    .min(1)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
});

const evidenceIndexSchemaV3 = z.strictObject({
  evidenceId: uuidSchema,
  type: z.enum(ASSESSMENT_EVIDENCE_TYPES),
  contentSha256: sha256Schema,
  repositoryCommit: commitSchema.nullable(),
  safeLocator: boundedTextSchema.nullable(),
});

const factIndexSchemaV3 = z.strictObject({
  factId: uuidSchema,
  caseRevision: revisionSchema,
  kind: z.enum(ASSESSMENT_FACT_KINDS),
  authority: z.enum(ASSESSMENT_FACT_AUTHORITIES),
  statement: boundedTextSchema,
  evidenceIds: z
    .array(uuidSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
});

const decisionReferenceEntrySchemaV3 = z.strictObject({
  origin: z.literal(ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.decision),
  reference: ruleDecisionReferenceSchema,
});

const criterionReferenceEntrySchemaV3 = z.strictObject({
  origin: z.literal(ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.criterion),
  reference: ruleDecisionReferenceSchema,
});

export const assessmentReportApplicabilityBasisReferenceSchema = z.strictObject({
  origin: z.literal(ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.applicabilityBasis),
  legalRequirementId: identifierSchema,
  kind: z.enum(RULE_DECISION_BASIS_KINDS),
  index: z.number().int().nonnegative(),
  reference: ruleDecisionReferenceSchema,
});
export type AssessmentReportApplicabilityBasisReference = z.infer<
  typeof assessmentReportApplicabilityBasisReferenceSchema
>;

export const assessmentReportFactEvidenceReferenceSchema = z.strictObject({
  origin: z.literal(ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.factEvidence),
  factId: uuidSchema,
  reference: z.strictObject({
    type: z.literal(RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE),
    evidenceId: uuidSchema,
  }),
});
export type AssessmentReportFactEvidenceReference = z.infer<
  typeof assessmentReportFactEvidenceReferenceSchema
>;

const criterionSchemaV3 = z.strictObject({
  criterionId: identifierSchema,
  outcome: z.enum(RULE_DECISION_CRITERION_OUTCOMES),
  rationale: boundedTextSchema,
  references: z
    .array(criterionReferenceEntrySchemaV3)
    .min(1)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
});

const boundedRuleNarrativeSchemaV3 = z.strictObject({
  summary: boundedTextSchema,
  recommendations: boundedTextListSchema,
});

const criterionDefinitionSchemaV3 = z.strictObject({
  criterionId: identifierSchema,
  statement: boundedTextSchema,
});

const ruleDetailSchemaV3 = z.strictObject({
  assessmentRuleId: identifierSchema,
  assessmentRuleVersion: identifierSchema,
  legalRequirementIds: z
    .array(identifierSchema)
    .min(1)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
  concept: boundedTextSchema,
  legalIntent: boundedTextSchema,
  applicabilityGuidance: boundedTextSchema,
  criteria: z
    .array(criterionDefinitionSchemaV3)
    .min(1)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
  decisionId: uuidSchema,
  decisionRevision: revisionSchema,
  decision: ruleDecisionSchema,
  decisionReferences: z
    .array(decisionReferenceEntrySchemaV3)
    .min(1)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
  applicabilityBasisReferences: z
    .array(assessmentReportApplicabilityBasisReferenceSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_APPLICABILITY_BASIS_REFERENCES),
  factEvidenceReferences: z
    .array(assessmentReportFactEvidenceReferenceSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_FACT_EVIDENCE_REFERENCES),
  criteriaDecisions: z
    .array(criterionSchemaV3)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
  narrative: boundedRuleNarrativeSchemaV3,
  factIds: z
    .array(uuidSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_FACT_EVIDENCE_REFERENCES),
  evidenceIds: z
    .array(uuidSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_FACT_EVIDENCE_REFERENCES),
  sourceRefs: z
    .array(sourceReferenceSchemaV3)
    .min(1)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ARRAY_ITEMS),
});

export const assessmentReportSourceScopeSchema = z.strictObject({
  mode: z.enum(ASSESSMENT_REPORT_SOURCE_SCOPE_MODES),
  visibility: z.enum(ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES),
  sourcePathPrefix: repositorySourcePathPrefixSchema.nullable(),
  excludedPaths: z
    .array(repositorySourcePathPrefixSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_EXCLUDED_PATHS),
  limitationReasons: z
    .array(z.enum(ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS))
    .max(10),
  searchCoverageEvidenceIds: z
    .array(uuidSchema)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_SEARCH_COVERAGE_EVIDENCE_IDS),
});
export type AssessmentReportSourceScope = z.infer<
  typeof assessmentReportSourceScopeSchema
>;

const actionPlanHighlightItemSchemaV3 = z.strictObject({
  actionId: identifierSchema,
  assessmentRuleId: identifierSchema,
  ruleDetailRef: identifierSchema,
  recommendationIndex: z.number().int().nonnegative(),
  priority: z.enum(ASSESSMENT_REPORT_ACTION_PRIORITIES),
});

export const assessmentReportBoundedActionPlanSchema = z.strictObject({
  maxHighlightItems: z.literal(
    ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
  ),
  totalRecommendations: z.number().int().nonnegative(),
  omittedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  items: z
    .array(actionPlanHighlightItemSchemaV3)
    .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS),
});
export type AssessmentReportBoundedActionPlan = z.infer<
  typeof assessmentReportBoundedActionPlanSchema
>;

const outcomeSummarySchemaV3 = z.strictObject({
  totalRules: z.number().int().nonnegative(),
  applicableCompliant: z.number().int().nonnegative(),
  applicableNonCompliant: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
});

const publicationProvenanceSchemaV3 = z.strictObject({
  sourceManifestDigest: sha256Schema.nullable(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});

/**
 * Business purpose: Produce a canonical string key for a decision reference so multiset comparisons do not depend on property order or silent deduplication.
 *
 * Business rules:
 * - Distinguish CONFIRMED_FACT (including factId and caseRevision) from ASSESSMENT_EVIDENCE (evidenceId).
 *
 * Execution flow:
 * 1. Format the reference discriminant and immutable identifiers into a fixed string key.
 *
 * Failure cases:
 * - Invalid reference shapes are rejected by `ruleDecisionReferenceSchema` prior to key construction.
 *
 * Side effects:
 * - None: pure deterministic formatting.
 */
function canonicalReferenceKey(reference: RuleDecisionReference): string {
  return reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT
    ? `${reference.type}:${reference.factId}:${reference.caseRevision}`
    : `${reference.type}:${reference.evidenceId}`;
}

/**
 * Business purpose: Verify that two reference collections contain the exact same multiset of entries without silently dropping or fabricating references.
 *
 * Business rules:
 * - Cardinality and every individual entry key must match 1-to-1 after deterministic sorting.
 *
 * Execution flow:
 * 1. Compare lengths for fast mismatch detection.
 * 2. Sort copies of both key lists and compare element by element.
 *
 * Failure cases:
 * - Missing, extra, or substituted entries return false.
 *
 * Side effects:
 * - None: pure comparison on temporary sorted arrays.
 */
function haveSameReferenceMultiset(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * Business purpose: Parse and validate a formatted repository evidence safeLocator (`path:start-end`) into a canonical repository-relative path and line span.
 *
 * Business rules:
 * - Only locators matching `<canonicalPath>:<positiveInt>-<positiveInt>` with `endLine >= startLine` and span `< MAX_LINE_SPAN` are valid.
 * - Absolute paths, traversal (`..`), alternate separators, encoded paths, control characters, and malformed ranges return null.
 *
 * Execution flow:
 * 1. Match the trailing positive-integer line-range suffix (`:<start>-<end>`).
 * 2. Validate the extracted path with `isCanonicalRepositorySourcePath` and verify integer line-range bounds.
 *
 * Failure cases:
 * - Unmatched, non-canonical, or out-of-bounds locators return null so callers fail closed rather than bypassing scope containment.
 *
 * Side effects:
 * - None: pure string and integer validation.
 */
function parseRepositorySourceSafeLocator(
  locator: string,
): { path: string; startLine: number; endLine: number } | null {
  const match = locator.match(/^(.+):([1-9]\d*)-([1-9]\d*)$/u);
  if (!match) return null;
  const [, path, startText, endText] = match;
  if (!isCanonicalRepositorySourcePath(path)) return null;
  const startLine = Number(startText);
  const endLine = Number(endText);
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine >= ASSESSMENT_DOMAIN_LIMITS.MAX_LINE_SPAN
  ) {
    return null;
  }
  return { path, startLine, endLine };
}

/**
 * Business purpose: Enforce structural and evidence-index consistency for V3 repository source scope declarations.
 *
 * Business rules:
 * - WHOLE_REPOSITORY forbids a `sourcePathPrefix`; SUBTREE requires a canonical `sourcePathPrefix`; UNKNOWN mode requires `null` prefix and `UNKNOWN` visibility.
 * - KNOWN_FULL forbids exclusions or limitation reasons; KNOWN_LIMITED requires explicit limitation signals and never `VISIBILITY_UNKNOWN`; UNKNOWN visibility forbids exclusions and known-limitation codes.
 * - Every `searchCoverageEvidenceIds` entry must exist in `evidenceIndex` as `SEARCH_COVERAGE`, and REPOSITORY_SOURCE evidence paths must lie within `sourceScope` and outside `excludedPaths`.
 *
 * Execution flow:
 * 1. Validate mode, prefix, visibility, exclusions, and limitation reason combinations.
 * 2. Verify uniqueness and evidence-index references for `searchCoverageEvidenceIds`.
 * 3. Check `REPOSITORY_SOURCE` evidence locators against subtree and excluded path boundaries.
 *
 * Failure cases:
 * - Contradictory, duplicate, or dangling scope declarations add targeted Zod custom issues.
 *
 * Side effects:
 * - None: records validation issues on the Zod refinement context only.
 */
function validateV3SourceScope(
  report: {
    sourceScope: AssessmentReportSourceScope;
    evidenceIndex: ReadonlyArray<z.infer<typeof evidenceIndexSchemaV3>>;
  },
  evidenceById: ReadonlyMap<string, z.infer<typeof evidenceIndexSchemaV3>>,
  context: z.RefinementCtx,
): void {
  const { sourceScope } = report;

  if (
    sourceScope.mode ===
      ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.WHOLE_REPOSITORY &&
    sourceScope.sourcePathPrefix !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope", "sourcePathPrefix"],
      message: "WHOLE_REPOSITORY source scope must have null sourcePathPrefix",
    });
  }
  if (
    sourceScope.mode === ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE &&
    sourceScope.sourcePathPrefix === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope", "sourcePathPrefix"],
      message: "SUBTREE source scope requires a non-null sourcePathPrefix",
    });
  }
  if (sourceScope.mode === ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN) {
    if (sourceScope.sourcePathPrefix !== null) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "sourcePathPrefix"],
        message: "UNKNOWN source scope mode must have null sourcePathPrefix",
      });
    }
    if (
      sourceScope.visibility !==
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "visibility"],
        message: "UNKNOWN source scope mode requires UNKNOWN visibility",
      });
    }
  }

  if (
    new Set(sourceScope.excludedPaths).size !== sourceScope.excludedPaths.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope", "excludedPaths"],
      message: "Excluded paths must be unique",
    });
  }
  if (
    new Set(sourceScope.limitationReasons).size !==
    sourceScope.limitationReasons.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope", "limitationReasons"],
      message: "Limitation reasons must be unique",
    });
  }
  if (
    new Set(sourceScope.searchCoverageEvidenceIds).size !==
    sourceScope.searchCoverageEvidenceIds.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope", "searchCoverageEvidenceIds"],
      message: "Search coverage evidence IDs must be unique",
    });
  }

  if (
    sourceScope.mode === ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE &&
    sourceScope.sourcePathPrefix !== null
  ) {
    for (const [index, excludedPath] of sourceScope.excludedPaths.entries()) {
      if (
        excludedPath === sourceScope.sourcePathPrefix ||
        !isRepositoryPathInSourceScope(
          excludedPath,
          sourceScope.sourcePathPrefix,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceScope", "excludedPaths", index],
          message:
            "Excluded path under SUBTREE scope must be a proper descendant of sourcePathPrefix",
        });
      }
    }
  }

  if (
    sourceScope.visibility ===
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL
  ) {
    if (
      sourceScope.excludedPaths.length > 0 ||
      sourceScope.limitationReasons.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "visibility"],
        message:
          "KNOWN_FULL source visibility cannot declare excludedPaths or limitationReasons",
      });
    }
  } else if (
    sourceScope.visibility ===
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED
  ) {
    if (
      sourceScope.excludedPaths.length === 0 &&
      sourceScope.limitationReasons.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope"],
        message:
          "KNOWN_LIMITED source visibility requires excludedPaths or limitationReasons",
      });
    }
    if (
      sourceScope.limitationReasons.includes(
        ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "limitationReasons"],
        message:
          "KNOWN_LIMITED visibility cannot use VISIBILITY_UNKNOWN limitation reason",
      });
    }
    const hasExcludedPathsReason = sourceScope.limitationReasons.includes(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.EXCLUDED_PATHS,
    );
    if (sourceScope.excludedPaths.length > 0 && !hasExcludedPathsReason) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "limitationReasons"],
        message:
          "Declaring excludedPaths requires EXCLUDED_PATHS in limitationReasons",
      });
    }
    if (hasExcludedPathsReason && sourceScope.excludedPaths.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "excludedPaths"],
        message:
          "EXCLUDED_PATHS limitation reason requires at least one entry in excludedPaths",
      });
    }
  } else {
    if (sourceScope.excludedPaths.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "excludedPaths"],
        message: "UNKNOWN source visibility cannot declare excludedPaths",
      });
    }
    if (
      sourceScope.limitationReasons.some(
        (reason) =>
          reason !==
          ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "limitationReasons"],
        message:
          "UNKNOWN source visibility may only record VISIBILITY_UNKNOWN limitation reason",
      });
    }
  }

  for (const [
    index,
    coverageId,
  ] of sourceScope.searchCoverageEvidenceIds.entries()) {
    const entry = evidenceById.get(coverageId);
    if (!entry) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "searchCoverageEvidenceIds", index],
        message: `Unknown search coverage evidence ${coverageId}`,
      });
    } else if (entry.type !== ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE) {
      context.addIssue({
        code: "custom",
        path: ["sourceScope", "searchCoverageEvidenceIds", index],
        message: `Evidence ${coverageId} must have type SEARCH_COVERAGE`,
      });
    }
  }

  for (const [index, item] of report.evidenceIndex.entries()) {
    if (item.type === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE) {
      if (item.safeLocator === null) continue;
      const parsedLocator = parseRepositorySourceSafeLocator(item.safeLocator);
      if (!parsedLocator) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "safeLocator"],
          message:
            "REPOSITORY_SOURCE evidence safeLocator must match canonical <path>:<startLine>-<endLine>",
        });
        continue;
      }
      if (
        sourceScope.mode === ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE &&
        sourceScope.sourcePathPrefix !== null &&
        !isRepositoryPathInSourceScope(
          parsedLocator.path,
          sourceScope.sourcePathPrefix,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "safeLocator"],
          message:
            "REPOSITORY_SOURCE evidence path lies outside declared SUBTREE sourcePathPrefix",
        });
      }
      if (
        sourceScope.excludedPaths.some((excluded) =>
          isRepositoryPathInSourceScope(parsedLocator.path, excluded),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "safeLocator"],
          message:
            "REPOSITORY_SOURCE evidence path falls inside declared excludedPaths",
        });
      }
    }
  }
}

/**
 * Business purpose: Enforce exact bounded action-plan accounting and provenance linkage back to `ruleDetails` across the 199/200/201 recommendation boundary.
 *
 * Business rules:
 * - Per-rule `ruleDetails[].narrative.recommendations` remain the complete, untruncated source of truth.
 * - `boundedActionPlan.totalRecommendations` must equal the sum of all per-rule recommendation counts.
 * - When `totalRecommendations <= 200`, `items.length === totalRecommendations`, `omittedCount === 0`, and `truncated === false`; when `totalRecommendations > 200`, `items.length === 200`, `omittedCount === totalRecommendations - 200`, and `truncated === true`.
 * - Every highlight item must uniquely and deterministically bind to an existing rule index and recommendation index.
 *
 * Execution flow:
 * 1. Compute expected recommendation totals and bounded highlight/omission counts.
 * 2. Verify highlight item identities, rule pointers, and recommendation indices without silent loss.
 *
 * Failure cases:
 * - Mismatched totals, silent truncation, duplicate action IDs, or dangling rule/index pointers record Zod issues.
 *
 * Side effects:
 * - None: records validation issues on the Zod refinement context only.
 */
function validateV3BoundedActionPlan(
  report: {
    ruleDetails: ReadonlyArray<z.infer<typeof ruleDetailSchemaV3>>;
    boundedActionPlan: AssessmentReportBoundedActionPlan;
  },
  ruleIndexById: ReadonlyMap<string, number>,
  context: z.RefinementCtx,
): void {
  const { boundedActionPlan } = report;
  const expectedTotal = report.ruleDetails.reduce(
    (sum, rule) => sum + rule.narrative.recommendations.length,
    0,
  );
  const expectedIncluded = Math.min(
    expectedTotal,
    boundedActionPlan.maxHighlightItems,
  );
  const expectedOmitted = expectedTotal - expectedIncluded;
  const expectedTruncated =
    expectedTotal > boundedActionPlan.maxHighlightItems;

  if (boundedActionPlan.totalRecommendations !== expectedTotal) {
    context.addIssue({
      code: "custom",
      path: ["boundedActionPlan", "totalRecommendations"],
      message: `totalRecommendations (${boundedActionPlan.totalRecommendations}) must equal sum of rule recommendations (${expectedTotal})`,
    });
  }
  if (boundedActionPlan.items.length !== expectedIncluded) {
    context.addIssue({
      code: "custom",
      path: ["boundedActionPlan", "items"],
      message: `boundedActionPlan.items length (${boundedActionPlan.items.length}) must equal ${expectedIncluded}`,
    });
  }
  if (boundedActionPlan.omittedCount !== expectedOmitted) {
    context.addIssue({
      code: "custom",
      path: ["boundedActionPlan", "omittedCount"],
      message: `omittedCount (${boundedActionPlan.omittedCount}) must equal ${expectedOmitted}`,
    });
  }
  if (boundedActionPlan.truncated !== expectedTruncated) {
    context.addIssue({
      code: "custom",
      path: ["boundedActionPlan", "truncated"],
      message: `truncated must be ${String(expectedTruncated)} for ${expectedTotal} recommendations`,
    });
  }

  const seenActionIds = new Set<string>();
  const seenRuleRecKeys = new Set<string>();
  for (const [index, item] of boundedActionPlan.items.entries()) {
    const ruleIndex = ruleIndexById.get(item.assessmentRuleId);
    if (ruleIndex === undefined) {
      context.addIssue({
        code: "custom",
        path: ["boundedActionPlan", "items", index, "assessmentRuleId"],
        message: `Unknown AssessmentRule ${item.assessmentRuleId} in boundedActionPlan`,
      });
      continue;
    }
    const rule = report.ruleDetails[ruleIndex];
    const expectedRef = `/ruleDetails/${ruleIndex}`;
    if (item.ruleDetailRef !== expectedRef) {
      context.addIssue({
        code: "custom",
        path: ["boundedActionPlan", "items", index, "ruleDetailRef"],
        message: `ruleDetailRef must equal ${expectedRef}`,
      });
    }
    const expectedActionId = `${item.assessmentRuleId}#${item.recommendationIndex}`;
    if (item.actionId !== expectedActionId) {
      context.addIssue({
        code: "custom",
        path: ["boundedActionPlan", "items", index, "actionId"],
        message: `actionId must equal ${expectedActionId}`,
      });
    }
    if (item.recommendationIndex >= rule.narrative.recommendations.length) {
      context.addIssue({
        code: "custom",
        path: ["boundedActionPlan", "items", index, "recommendationIndex"],
        message: `recommendationIndex ${item.recommendationIndex} is out of bounds for rule ${item.assessmentRuleId}`,
      });
    }
    if (seenActionIds.has(item.actionId)) {
      context.addIssue({
        code: "custom",
        path: ["boundedActionPlan", "items", index, "actionId"],
        message: `Duplicate actionId ${item.actionId} in boundedActionPlan`,
      });
    }
    seenActionIds.add(item.actionId);

    const ruleRecKey = `${item.assessmentRuleId}:${item.recommendationIndex}`;
    if (seenRuleRecKeys.has(ruleRecKey)) {
      context.addIssue({
        code: "custom",
        path: ["boundedActionPlan", "items", index],
        message: `Duplicate recommendation reference ${ruleRecKey} in boundedActionPlan`,
      });
    }
    seenRuleRecKeys.add(ruleRecKey);
  }
}

/**
 * Business purpose: Validate all V3 report cross-field invariants covering pins, criterion equality, reference/evidence transitive closure, source scope, outcome totals, and bounded action plan.
 *
 * Business rules:
 * - Identity, decision pins, rule versions, legal source pins, and unique IDs must remain strictly consistent.
 * - Projected criteria must correspond 1-to-1 with declared and accepted criteria and match canonical outcomes and references without relying on prose equality.
 * - Decision, criterion, applicability-basis, and fact-linked evidence references must achieve full transitive closure into `factIndex` and `evidenceIndex` while preserving origin and `HUMAN_PROVIDED` authority.
 *
 * Execution flow:
 * 1. Validate identity/pins and index uniqueness for requirements, rules, facts, and evidence.
 * 2. Validate evidence types/locators and fact authority/evidence-type boundaries.
 * 3. Validate each rule's pins, criteria projection, reference multisets, transitive fact->evidence closure, and source pins.
 * 4. Validate outcome totals, source scope boundaries, and bounded action-plan invariants.
 *
 * Failure cases:
 * - Any canonical inconsistency, dangling reference, authority elevation, or scope contradiction adds structured Zod issues.
 *
 * Side effects:
 * - None: pure validation on the parsed candidate V3 report.
 */
function validateAssessmentFinalReportV3Invariants(
  report: AssessmentFinalReportV3,
  context: z.RefinementCtx,
): void {
  if (
    report.identity.repositorySnapshotId !== report.pins.repositorySnapshotId ||
    report.identity.repositoryCommit.toLowerCase() !==
      report.pins.repositoryCommit.toLowerCase()
  ) {
    context.addIssue({
      code: "custom",
      path: ["identity"],
      message: "Report identity must match its pinned repository identity",
    });
  }

  const ruleIndexById = new Map<string, number>();
  const decisionIds = new Set<string>();
  for (const [index, rule] of report.ruleDetails.entries()) {
    if (ruleIndexById.has(rule.assessmentRuleId)) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", index, "assessmentRuleId"],
        message: "AssessmentRule IDs must be unique",
      });
    } else {
      ruleIndexById.set(rule.assessmentRuleId, index);
    }
    if (decisionIds.has(rule.decisionId)) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", index, "decisionId"],
        message: "Decision IDs must be unique across ruleDetails",
      });
    }
    decisionIds.add(rule.decisionId);
  }

  const requirementIds = new Set<string>();
  for (const [index, requirement] of report.legalRequirements.entries()) {
    if (requirementIds.has(requirement.legalRequirementId)) {
      context.addIssue({
        code: "custom",
        path: ["legalRequirements", index, "legalRequirementId"],
        message: "LegalRequirement IDs must be unique",
      });
    }
    requirementIds.add(requirement.legalRequirementId);
    for (const [sourceIdx, source] of requirement.sourceRefs.entries()) {
      if (
        source.legalSourceVersionId !== report.pins.legalSourceVersionId ||
        source.legalSourceVersion !== report.pins.legalSourceVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["legalRequirements", index, "sourceRefs", sourceIdx],
          message:
            "LegalRequirement source does not match pinned LegalSourceVersion",
        });
      }
    }
  }

  const evidenceById = new Map<
    string,
    z.infer<typeof evidenceIndexSchemaV3>
  >();
  for (const [index, item] of report.evidenceIndex.entries()) {
    if (evidenceById.has(item.evidenceId)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIndex", index, "evidenceId"],
        message: "Evidence index IDs must be unique",
      });
    } else {
      evidenceById.set(item.evidenceId, item);
    }

    const pinnedCommit = report.pins.repositoryCommit.toLowerCase();
    if (item.type === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE) {
      if (
        item.repositoryCommit === null ||
        item.repositoryCommit.toLowerCase() !== pinnedCommit
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "repositoryCommit"],
          message:
            "REPOSITORY_SOURCE evidence must match pinned repositoryCommit",
        });
      }
      if (item.safeLocator === null) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "safeLocator"],
          message: "REPOSITORY_SOURCE evidence requires a non-null safeLocator",
        });
      }
    } else if (item.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE) {
      if (
        item.repositoryCommit === null ||
        item.repositoryCommit.toLowerCase() !== pinnedCommit
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "repositoryCommit"],
          message:
            "SEARCH_COVERAGE evidence must match pinned repositoryCommit",
        });
      }
      if (item.safeLocator !== null) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "safeLocator"],
          message: "SEARCH_COVERAGE evidence must have null safeLocator",
        });
      }
    } else {
      if (item.safeLocator !== null) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "safeLocator"],
          message:
            "HUMAN_ANSWER evidence cannot carry a repository safeLocator",
        });
      }
      if (
        item.repositoryCommit !== null &&
        item.repositoryCommit.toLowerCase() !== pinnedCommit
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidenceIndex", index, "repositoryCommit"],
          message:
            "HUMAN_ANSWER repositoryCommit, when present, must match pinned repositoryCommit",
        });
      }
    }
  }

  const factById = new Map<string, z.infer<typeof factIndexSchemaV3>>();
  for (const [index, fact] of report.factIndex.entries()) {
    if (factById.has(fact.factId)) {
      context.addIssue({
        code: "custom",
        path: ["factIndex", index, "factId"],
        message: "Fact index IDs must be unique",
      });
    } else {
      factById.set(fact.factId, fact);
    }

    if (fact.caseRevision > report.caseRevision) {
      context.addIssue({
        code: "custom",
        path: ["factIndex", index, "caseRevision"],
        message: "Fact caseRevision cannot exceed report caseRevision",
      });
    }
    if (new Set(fact.evidenceIds).size !== fact.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["factIndex", index, "evidenceIds"],
        message: "Fact evidenceIds must be unique",
      });
    }
    if (
      fact.authority === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED &&
      fact.evidenceIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["factIndex", index, "evidenceIds"],
        message:
          "EVIDENCE_CITED fact must link to at least one evidence index entry",
      });
    }

    for (const [evIndex, evidenceId] of fact.evidenceIds.entries()) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        context.addIssue({
          code: "custom",
          path: ["factIndex", index, "evidenceIds", evIndex],
          message: `Unknown fact evidence index entry ${evidenceId}`,
        });
        continue;
      }
      if (
        fact.authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED &&
        evidence.type !== ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER
      ) {
        context.addIssue({
          code: "custom",
          path: ["factIndex", index, "evidenceIds", evIndex],
          message:
            "HUMAN_PROVIDED fact cannot link to non-HUMAN_ANSWER repository evidence",
        });
      }
      if (
        fact.authority === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED &&
        evidence.type === ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER
      ) {
        context.addIssue({
          code: "custom",
          path: ["factIndex", index, "evidenceIds", evIndex],
          message:
            "EVIDENCE_CITED fact cannot rely on HUMAN_ANSWER evidence",
        });
      }
    }
  }

  for (const [ruleIndex, rule] of report.ruleDetails.entries()) {
    if (
      new Set(rule.legalRequirementIds).size !== rule.legalRequirementIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "legalRequirementIds"],
        message: "Per-rule legalRequirementIds must be unique",
      });
    }
    const ruleRequirementIds = new Set(rule.legalRequirementIds);
    for (const requirementId of rule.legalRequirementIds) {
      if (!requirementIds.has(requirementId)) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "legalRequirementIds"],
          message: `Unknown LegalRequirement ${requirementId}`,
        });
      }
    }

    const seenLegalContextIds = new Set<string>();
    for (const [contextIdx, legalContext] of rule.decision.legalContextRefs.entries()) {
      if (seenLegalContextIds.has(legalContext.legalContextId)) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIndex,
            "decision",
            "legalContextRefs",
            contextIdx,
          ],
          message: `Duplicate legalContextId ${legalContext.legalContextId} in decision.legalContextRefs`,
        });
      }
      seenLegalContextIds.add(legalContext.legalContextId);
      if (!ruleRequirementIds.has(legalContext.legalContextId)) {
        context.addIssue({
          code: "custom",
          path: [
            "ruleDetails",
            ruleIndex,
            "decision",
            "legalContextRefs",
            contextIdx,
          ],
          message: `legalContextId ${legalContext.legalContextId} is not linked to rule ${rule.assessmentRuleId}`,
        });
      }
    }

    const declaredCriterionIds = new Set(
      rule.criteria.map((criterion) => criterion.criterionId),
    );
    if (declaredCriterionIds.size !== rule.criteria.length) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "criteria"],
        message: "Declared rule criteria IDs must be unique",
      });
    }

    if (
      rule.assessmentRuleId !== rule.decision.assessmentRuleId ||
      rule.assessmentRuleVersion !== rule.decision.assessmentRuleVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "decision"],
        message: "Decision rule identity/version does not match rule detail",
      });
    }

    if (
      rule.decision.ruleSetVersionId !== report.pins.ruleSetVersionId ||
      rule.decision.repositorySnapshotId !== report.pins.repositorySnapshotId ||
      rule.decision.repositoryCommit.toLowerCase() !==
        report.pins.repositoryCommit.toLowerCase() ||
      rule.decision.caseRevision !== report.caseRevision ||
      rule.decision.scopeId !== ASSESSMENT_DECISION_SCOPE
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "decision"],
        message: "Decision pins or scope do not match the report pins",
      });
    }

    const decision = rule.decision;
    if (
      decision.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
    ) {
      if (
        decision.compliance !== null ||
        decision.criteria.length !== 0 ||
        rule.criteriaDecisions.length !== 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "decision"],
          message: "NOT_APPLICABLE cannot contain compliance criteria",
        });
      }
    } else {
      if (
        decision.compliance !== RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT &&
        decision.compliance !== RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "decision", "compliance"],
          message:
            "Applicable decisions require a supported compliance outcome",
        });
      }

      const acceptedCriteria = new Map(
        decision.criteria.map((criterion) => [
          criterion.criterionId,
          criterion,
        ]),
      );
      const projectedCriterionIds = rule.criteriaDecisions.map(
        (criterion) => criterion.criterionId,
      );
      if (
        new Set(projectedCriterionIds).size !== projectedCriterionIds.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "criteriaDecisions"],
          message: "Projected criterion IDs must be unique",
        });
      }
      if (
        acceptedCriteria.size !== declaredCriterionIds.size ||
        [...declaredCriterionIds].some((id) => !acceptedCriteria.has(id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "decision", "criteria"],
          message:
            "Accepted decision criteria must match declared rule criteria 1-to-1",
        });
      }
      if (
        rule.criteriaDecisions.length !== acceptedCriteria.size ||
        [...acceptedCriteria.keys()].some(
          (id) => !projectedCriterionIds.includes(id),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "criteriaDecisions"],
          message:
            "Projected criteriaDecisions must represent every accepted criterion exactly once",
        });
      }

      for (const [critIndex, projected] of rule.criteriaDecisions.entries()) {
        const accepted = acceptedCriteria.get(projected.criterionId);
        if (!accepted) {
          context.addIssue({
            code: "custom",
            path: ["ruleDetails", ruleIndex, "criteriaDecisions", critIndex],
            message: `Unknown projected criterion ${projected.criterionId}`,
          });
          continue;
        }
        if (projected.outcome !== accepted.outcome) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIndex,
              "criteriaDecisions",
              critIndex,
              "outcome",
            ],
            message: `Projected outcome for ${projected.criterionId} must match accepted outcome ${accepted.outcome}`,
          });
        }
        const expectedKeys = accepted.references.map(canonicalReferenceKey);
        const projectedKeys = projected.references.map((item) =>
          canonicalReferenceKey(item.reference),
        );
        if (!haveSameReferenceMultiset(expectedKeys, projectedKeys)) {
          context.addIssue({
            code: "custom",
            path: [
              "ruleDetails",
              ruleIndex,
              "criteriaDecisions",
              critIndex,
              "references",
            ],
            message:
              "Projected criterion references must match accepted criterion references without omission or extra entries",
          });
        }
      }
    }

    const expectedDecisionRefKeys = decision.references.map(
      canonicalReferenceKey,
    );
    const projectedDecisionRefKeys = rule.decisionReferences.map((item) =>
      canonicalReferenceKey(item.reference),
    );
    if (
      !haveSameReferenceMultiset(
        expectedDecisionRefKeys,
        projectedDecisionRefKeys,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "decisionReferences"],
        message:
          "decisionReferences must match accepted decision.references without omission or extra entries",
      });
    }

    const expectedBasisKeys: string[] = [];
    for (const basisEntry of decision.applicabilityBasis ?? []) {
      if (!ruleRequirementIds.has(basisEntry.legalRequirementId)) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "decision", "applicabilityBasis"],
          message: `applicabilityBasis references unlinked LegalRequirement ${basisEntry.legalRequirementId}`,
        });
      }
      for (const reference of basisEntry.references) {
        expectedBasisKeys.push(
          `${basisEntry.legalRequirementId}|${basisEntry.kind}|${basisEntry.index}|${canonicalReferenceKey(reference)}`,
        );
      }
    }
    const projectedBasisKeys = rule.applicabilityBasisReferences.map(
      (item) =>
        `${item.legalRequirementId}|${item.kind}|${item.index}|${canonicalReferenceKey(item.reference)}`,
    );
    if (!haveSameReferenceMultiset(expectedBasisKeys, projectedBasisKeys)) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "applicabilityBasisReferences"],
        message:
          "applicabilityBasisReferences must match accepted decision.applicabilityBasis references without omission or extra entries",
      });
    }

    if (new Set(rule.factIds).size !== rule.factIds.length) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "factIds"],
        message: "Per-rule factIds must be unique",
      });
    }
    if (new Set(rule.evidenceIds).size !== rule.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "evidenceIds"],
        message: "Per-rule evidenceIds must be unique",
      });
    }

    const referencedFactIds = new Set<string>();
    const directEvidenceIds = new Set<string>();
    for (const reference of ruleDecisionReferences(decision)) {
      if (reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT) {
        referencedFactIds.add(reference.factId);
      } else {
        directEvidenceIds.add(reference.evidenceId);
      }
    }

    const ruleFactSet = new Set(rule.factIds);
    if (
      ruleFactSet.size !== referencedFactIds.size ||
      [...referencedFactIds].some((id) => !ruleFactSet.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "factIds"],
        message:
          "Per-rule factIds must exactly match all CONFIRMED_FACT references across decision, criteria, and applicabilityBasis",
      });
    }

    const expectedFactEvidenceKeys: string[] = [];
    const expectedAllEvidenceIds = new Set(directEvidenceIds);
    for (const factId of rule.factIds) {
      const fact = factById.get(factId);
      if (!fact) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "factIds"],
          message: `Unknown fact index entry ${factId}`,
        });
        continue;
      }
      for (const evidenceId of fact.evidenceIds) {
        expectedAllEvidenceIds.add(evidenceId);
        expectedFactEvidenceKeys.push(`${factId}|${evidenceId}`);
      }
    }

    const projectedFactEvidenceKeys = rule.factEvidenceReferences.map(
      (item) => `${item.factId}|${item.reference.evidenceId}`,
    );
    if (
      !haveSameReferenceMultiset(
        expectedFactEvidenceKeys,
        projectedFactEvidenceKeys,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "factEvidenceReferences"],
        message:
          "factEvidenceReferences must match the exact transitive closure of evidence linked through rule factIds",
      });
    }

    const ruleEvidenceSet = new Set(rule.evidenceIds);
    if (
      ruleEvidenceSet.size !== expectedAllEvidenceIds.size ||
      [...expectedAllEvidenceIds].some((id) => !ruleEvidenceSet.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["ruleDetails", ruleIndex, "evidenceIds"],
        message:
          "Per-rule evidenceIds must equal the complete union of direct and fact-linked evidence references",
      });
    }
    for (const evidenceId of rule.evidenceIds) {
      if (!evidenceById.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "evidenceIds"],
          message: `Unknown evidence index entry ${evidenceId}`,
        });
      }
    }

    for (const [sourceIdx, source] of rule.sourceRefs.entries()) {
      if (
        source.legalSourceVersionId !== report.pins.legalSourceVersionId ||
        source.legalSourceVersion !== report.pins.legalSourceVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["ruleDetails", ruleIndex, "sourceRefs", sourceIdx],
          message: "Rule source does not match pinned LegalSourceVersion",
        });
      }
    }
  }

  const counts = report.ruleDetails.reduce(
    (summary, rule) => {
      if (
        rule.decision.applicability ===
        RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      ) {
        summary.notApplicable += 1;
      } else if (
        rule.decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
      ) {
        summary.applicableCompliant += 1;
      } else {
        summary.applicableNonCompliant += 1;
      }
      return summary;
    },
    { applicableCompliant: 0, applicableNonCompliant: 0, notApplicable: 0 },
  );
  if (
    report.outcomeSummary.totalRules !== report.ruleDetails.length ||
    report.outcomeSummary.applicableCompliant !== counts.applicableCompliant ||
    report.outcomeSummary.applicableNonCompliant !==
      counts.applicableNonCompliant ||
    report.outcomeSummary.notApplicable !== counts.notApplicable
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcomeSummary"],
      message: "Outcome counts do not match accepted rule decisions",
    });
  }

  validateV3SourceScope(report, evidenceById, context);
  validateV3BoundedActionPlan(report, ruleIndexById, context);
}

export const assessmentFinalReportV3Schema = z
  .strictObject({
    schemaVersion: z.literal(ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION),
    artifactId: uuidSchema,
    assessmentId: uuidSchema,
    kind: z.literal(ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT),
    identity: z.strictObject({
      repositorySnapshotId: identifierSchema,
      repositoryCommit: commitSchema,
    }),
    pins: z.strictObject({
      legalSourceVersionId: uuidSchema,
      legalSourceVersion: boundedTextSchema,
      ruleSetVersionId: uuidSchema,
      ruleSetVersion: boundedTextSchema,
      ruleSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
      repositorySnapshotId: identifierSchema,
      repositoryScanJobId: identifierSchema,
      repositoryCommit: commitSchema,
    }),
    caseRevision: revisionSchema,
    decisionFingerprint: sha256Schema,
    sourceScope: assessmentReportSourceScopeSchema,
    legalRequirements: z
      .array(legalRequirementSchemaV3)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_LEGAL_REQUIREMENTS),
    ruleDetails: z
      .array(ruleDetailSchemaV3)
      .min(1)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_RULE_DETAILS),
    factIndex: z
      .array(factIndexSchemaV3)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_INDEX_ENTRIES),
    evidenceIndex: z
      .array(evidenceIndexSchemaV3)
      .max(ASSESSMENT_REPORT_V3_LIMITS.MAX_INDEX_ENTRIES),
    outcomeSummary: outcomeSummarySchemaV3,
    boundedNarrative: z.strictObject({
      summary: boundedTextSchema,
      scopeLimitations: boundedTextListSchema,
    }),
    boundedActionPlan: assessmentReportBoundedActionPlanSchema,
    publicationProvenance: publicationProvenanceSchemaV3,
  })
  .superRefine(validateAssessmentFinalReportV3Invariants);

export type AssessmentFinalReportV3 = z.infer<
  typeof assessmentFinalReportV3Schema
>;

export interface AssessmentReportV3SizeMeasurement {
  utf8Bytes: number;
  jsLength: number;
  totalRecommendations: number;
  includedActionPlanItems: number;
  omittedActionPlanItems: number;
  ruleCount: number;
  factCount: number;
  evidenceCount: number;
}

/**
 * Business purpose: Measure a V3 report artifact's serialized UTF-8 byte size versus JavaScript string length and recommendation counts.
 *
 * Business rules:
 * - UTF-8 byte measurements use actual encoded bytes so multi-byte Unicode text is never equated with UTF-16 `.length`.
 * - Measuring payload size does not imply that HTTP ingress limits have been raised.
 *
 * Execution flow:
 * 1. Serialize the V3 report to JSON and compute both `utf8ByteLength(json)` and `json.length`.
 * 2. Aggregate recommendation and index counts from the report structure.
 *
 * Failure cases:
 * - Non-serializable inputs would throw from `JSON.stringify`; valid V3 objects always serialize cleanly.
 *
 * Side effects:
 * - None: pure in-memory measurement.
 */
export function measureAssessmentFinalReportV3Size(
  report: AssessmentFinalReportV3,
): AssessmentReportV3SizeMeasurement {
  const serialized = JSON.stringify(report);
  const totalRecommendations = report.ruleDetails.reduce(
    (sum, rule) => sum + rule.narrative.recommendations.length,
    0,
  );
  return {
    utf8Bytes: utf8ByteLength(serialized),
    jsLength: serialized.length,
    totalRecommendations,
    includedActionPlanItems: report.boundedActionPlan.items.length,
    omittedActionPlanItems:
      totalRecommendations - report.boundedActionPlan.items.length,
    ruleCount: report.ruleDetails.length,
    factCount: report.factIndex.length,
    evidenceCount: report.evidenceIndex.length,
  };
}

/**
 * Business purpose: Interpret missing or legacy source-scope metadata honestly without inferring whole-repository coverage.
 *
 * Business rules:
 * - Absent or null legacy scope metadata maps to `UNKNOWN` mode and `UNKNOWN` visibility, never `WHOLE_REPOSITORY` or `KNOWN_FULL`.
 * - A valid legacy non-null `sourcePathPrefix` identifies `SUBTREE` mode, while visibility remains `UNKNOWN` unless explicit V3 coverage metadata exists.
 *
 * Execution flow:
 * 1. Inspect the optional legacy `sourcePathPrefix`.
 * 2. Return a schema-valid V3 `AssessmentReportSourceScope` with `UNKNOWN` visibility.
 *
 * Failure cases:
 * - Invalid non-canonical `sourcePathPrefix` strings are not silently normalized or widened; they fall back to `UNKNOWN` mode with `null` prefix.
 *
 * Side effects:
 * - None: pure classification helper.
 */
export function classifyLegacyAssessmentReportSourceScope(input?: {
  sourcePathPrefix?: string | null;
}): AssessmentReportSourceScope {
  const parsedPrefix =
    typeof input?.sourcePathPrefix === "string"
      ? repositorySourcePathPrefixSchema.safeParse(input.sourcePathPrefix)
      : null;
  if (parsedPrefix?.success) {
    return {
      mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
      sourcePathPrefix: parsedPrefix.data,
      excludedPaths: [],
      limitationReasons: [
        ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
      ],
      searchCoverageEvidenceIds: [],
    };
  }
  const mode: AssessmentReportSourceScopeMode =
    ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN;
  const visibility: AssessmentReportSourceVisibilityState =
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN;
  const reason: AssessmentReportSourceVisibilityLimitationReason =
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN;
  return {
    mode,
    visibility,
    sourcePathPrefix: null,
    excludedPaths: [],
    limitationReasons: [reason],
    searchCoverageEvidenceIds: [],
  };
}

export interface AssessmentReportV3FieldPathClassification {
  pathPattern: string;
  classification: AssessmentReportFieldClassification;
  b1AuthoredFieldsIncluded: boolean;
  c2ProtectedKeysRecommendation: string | null;
  notes: string;
}

/**
 * Explicit classification of every Report V3 field path for persisted localization compatibility (`AuthoredLocalizationService.authoredFields`).
 * C1 keeps the production localization service untouched and records exact expectations for C2 regression testing.
 */
export const ASSESSMENT_FINAL_REPORT_V3_FIELD_PATH_CLASSIFICATIONS: ReadonlyArray<AssessmentReportV3FieldPathClassification> =
  [
    {
      pathPattern: "/schemaVersion",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Version discriminator ASSESSMENT_FINAL_REPORT_V3; never translated.",
    },
    {
      pathPattern:
        "/artifactId, /assessmentId, /kind, /caseRevision, /decisionFingerprint",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Artifact/case identity, kind enum, revision, and decision hash.",
    },
    {
      pathPattern: "/identity/*, /pins/*, /publicationProvenance/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes:
        "Pinned snapshot, scan job, commit, rule-set, and legal-source version metadata.",
    },
    {
      pathPattern: "/sourceScope/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: "sourceScope",
      notes:
        "Contains mode/visibility/limitationReasons enums, canonical sourcePathPrefix/excludedPaths, and searchCoverageEvidenceIds. Add sourceScope to protectedKeys in C2 for defense-in-depth.",
    },
    {
      pathPattern:
        "/legalRequirements/*/legalRequirementId, /legalRequirements/*/nonRepositoryDuty, /legalRequirements/*/coverageState",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Requirement identity, boolean flag, and coverage enum.",
    },
    {
      pathPattern:
        "/legalRequirements/*/title, /legalRequirements/*/proposition, /legalRequirements/*/applicabilityConditions/*, /legalRequirements/*/qualifiers/*, /legalRequirements/*/exceptions/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes: "Covered by B1 authoredKeys.",
    },
    {
      pathPattern: "/legalRequirements/*/sourceRefs/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Excluded by B1 protectedKeys (sourceRefs).",
    },
    {
      pathPattern:
        "/ruleDetails/*/assessmentRuleId, /ruleDetails/*/assessmentRuleVersion, /ruleDetails/*/legalRequirementIds/*, /ruleDetails/*/decisionId, /ruleDetails/*/decisionRevision, /ruleDetails/*/factIds/*, /ruleDetails/*/evidenceIds/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Rule/decision/fact/evidence identifiers and revisions.",
    },
    {
      pathPattern:
        "/ruleDetails/*/concept, /ruleDetails/*/legalIntent, /ruleDetails/*/applicabilityGuidance",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes: "Covered by B1 authoredKeys.",
    },
    {
      pathPattern: "/ruleDetails/*/criteria/*/criterionId",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Criterion identifier; never translated.",
    },
    {
      pathPattern: "/ruleDetails/*/criteria/*/statement",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes: "Covered by B1 statement path regex /\\/(?:criteria|criteriaDecisions)\\/\\d+$/.",
    },
    {
      pathPattern:
        "/ruleDetails/*/decision/(assessmentRuleId|assessmentRuleVersion|scopeId|ruleSetVersionId|repositorySnapshotId|repositoryCommit|caseRevision|legalContextRefs|applicability|compliance)",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Canonical decision verdict, pins, and context IDs.",
    },
    {
      pathPattern:
        "/ruleDetails/*/decision/rationale, /ruleDetails/*/decision/criteria/*/rationale, /ruleDetails/*/decision/applicabilityBasis/*/rationale",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes: "Covered by B1 authoredKeys (rationale).",
    },
    {
      pathPattern:
        "/ruleDetails/*/decision/references/*, /ruleDetails/*/decision/criteria/*/references/*, /ruleDetails/*/decision/applicabilityBasis/*/references/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Excluded by B1 protectedKeys (references).",
    },
    {
      pathPattern:
        "/ruleDetails/*/decision/criteria/*/criterionId, /ruleDetails/*/decision/criteria/*/outcome, /ruleDetails/*/decision/applicabilityBasis/*/(legalRequirementId|kind|index|finding)",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Canonical criterion outcomes and applicability-basis coordinates.",
    },
    {
      pathPattern:
        "/ruleDetails/*/decisionReferences/*, /ruleDetails/*/applicabilityBasisReferences/*, /ruleDetails/*/factEvidenceReferences/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation:
        "decisionReferences, applicabilityBasisReferences, factEvidenceReferences",
      notes:
        "Reference provenance arrays with origin tags and IDs. Excluded in B1; add container keys to protectedKeys in C2 for defense-in-depth.",
    },
    {
      pathPattern:
        "/ruleDetails/*/criteriaDecisions/*/criterionId, /ruleDetails/*/criteriaDecisions/*/outcome",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Projected criterion ID and canonical MET/NOT_MET outcome.",
    },
    {
      pathPattern: "/ruleDetails/*/criteriaDecisions/*/rationale",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes:
        "Covered by B1 rationale allowlist; criterion statement lives solely on ruleDetails/*/criteria/*/statement.",
    },
    {
      pathPattern: "/ruleDetails/*/criteriaDecisions/*/references/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Excluded by B1 protectedKeys (references).",
    },
    {
      pathPattern:
        "/ruleDetails/*/narrative/summary, /ruleDetails/*/narrative/recommendations/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes: "Covered by B1 authoredKeys (summary, recommendations).",
    },
    {
      pathPattern: "/ruleDetails/*/sourceRefs/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Excluded by B1 protectedKeys (sourceRefs).",
    },
    {
      pathPattern: "/factIndex/*, /evidenceIndex/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes:
        "Excluded by B1 protectedKeys (factIndex, evidenceIndex); preserves accepted facts, customer answers, commits, hashes, and locators verbatim.",
    },
    {
      pathPattern: "/outcomeSummary/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation: null,
      notes: "Deterministic rule counts.",
    },
    {
      pathPattern:
        "/boundedNarrative/summary, /boundedNarrative/scopeLimitations/*",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE,
      b1AuthoredFieldsIncluded: true,
      c2ProtectedKeysRecommendation: null,
      notes: "Covered by B1 authoredKeys (summary, scopeLimitations).",
    },
    {
      pathPattern:
        "/boundedActionPlan/maxHighlightItems, /boundedActionPlan/totalRecommendations, /boundedActionPlan/omittedCount, /boundedActionPlan/truncated, /boundedActionPlan/items/*/(actionId|assessmentRuleId|ruleDetailRef|recommendationIndex|priority)",
      classification:
        ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE,
      b1AuthoredFieldsIncluded: false,
      c2ProtectedKeysRecommendation:
        "boundedActionPlan, actionId, ruleDetailRef, priority",
      notes:
        "Container key boundedActionPlan is outside authoredKeys and carries pointer/priority metadata only; presentation text is derived from ruleDetails/*/narrative/recommendations/* without duplicating writable prose. Add boundedActionPlan/actionId/ruleDetailRef/priority to protectedKeys in C2 for defense-in-depth.",
    },
  ];

export interface ResolvedV3BoundedActionPlanItem {
  actionId: string;
  assessmentRuleId: string;
  ruleDetailRef: string;
  recommendationIndex: number;
  priority: AssessmentFinalReportV3["boundedActionPlan"]["items"][number]["priority"];
  recommendation: string;
}

/**
 * Business purpose: Derive bounded action-plan presentation text solely from the canonical per-rule recommendations in `ruleDetails`.
 *
 * Business rules:
 * - Action items carry pointer and priority metadata only; recommendation prose is never stored independently on `boundedActionPlan`.
 *
 * Execution flow:
 * 1. Map each rule in `ruleDetails` by `assessmentRuleId`.
 * 2. Resolve each `boundedActionPlan.items` pointer to its canonical or reviewed-localized `rule.narrative.recommendations[recommendationIndex]`.
 *
 * Failure cases:
 * - Dangling rule or recommendation index pointers throw explicitly instead of fabricating placeholder text.
 *
 * Side effects:
 * - None: pure in-memory projection.
 */
export function resolveV3BoundedActionPlanItems(
  report: AssessmentFinalReportV3,
): ResolvedV3BoundedActionPlanItem[] {
  const ruleById = new Map(
    report.ruleDetails.map((rule) => [rule.assessmentRuleId, rule]),
  );
  return report.boundedActionPlan.items.map((item) => {
    const rule = ruleById.get(item.assessmentRuleId);
    const recommendation =
      rule?.narrative.recommendations[item.recommendationIndex];
    if (!rule || recommendation === undefined) {
      throw new Error(
        `Unresolvable boundedActionPlan item ${item.actionId} (${item.ruleDetailRef})`,
      );
    }
    return {
      actionId: item.actionId,
      assessmentRuleId: item.assessmentRuleId,
      ruleDetailRef: item.ruleDetailRef,
      recommendationIndex: item.recommendationIndex,
      priority: item.priority,
      recommendation,
    };
  });
}


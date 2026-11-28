import { z } from "zod";
import { AGENT_EXECUTION_STATES } from "../assessment/agentic-runtime.ts";
import {
  assessmentRuleAuthoringSchema,
  assessmentRuleCriterionSchema,
  assessmentRuleSchema,
  complianceRuleSetPacketSchema,
  legalContextRelationSchema,
  legalRequirementSchema,
} from "../compliance-rule-set/schemas.ts";
import { PREPARATION_SCOPE_STAGES } from "../compliance-rule-set/scope-review.ts";
import { LEGAL_REFERENCE_RESOLUTION_STATES } from "../legal-source/document-graph.ts";

export const LEGAL_RULE_PREPARATION_STATES = {
  NOT_PREPARED: "NOT_PREPARED",
  PREPARED: "PREPARED",
  FAILED: "FAILED",
  RUNNING: "RUNNING",
  STALE: "STALE",
  INELIGIBLE: "INELIGIBLE",
} as const;
export const LEGAL_RULE_SELECTION_MODES = {
  EXPLICIT: "EXPLICIT",
  ALL_MATCHING: "ALL_MATCHING",
} as const;
export const LEGAL_RULE_CATALOG_ERRORS = {
  INVALID: "LEGAL_RULE_CATALOG_REQUEST_INVALID",
  NOT_FOUND: "LEGAL_RULE_CATALOG_NOT_FOUND",
  STALE: "LEGAL_RULE_CATALOG_REVISION_STALE",
  INELIGIBLE: "LEGAL_RULE_SOURCE_INELIGIBLE",
  EMPTY: "LEGAL_RULE_SELECTION_EMPTY",
  CONFLICT: "LEGAL_RULE_PREPARATION_CONFLICT",
  TOO_LARGE: "LEGAL_RULE_SELECTION_TOO_LARGE",
  SOURCE_CONTEXT_TOO_LARGE: "LEGAL_RULE_SOURCE_CONTEXT_TOO_LARGE",
  RESULT_INVALID: "LEGAL_RULE_RESULT_INVALID",
  SCOPE_REVIEW_REQUIRED: "LEGAL_RULE_SCOPE_REVIEW_REQUIRED",
} as const;
// Why: Public validation diagnostics must not expose the nested authoring schema or item indexes.
// How: API responses use this bounded category set while keeping exact paths server-side.
// Invariant: These stable codes are safe to localize without reflecting submitted values.
export const LEGAL_RULE_VALIDATION_ISSUES = {
  OUTPUT_INVALID: "OUTPUT_INVALID",
  SOURCE_REFERENCE_INVALID: "SOURCE_REFERENCE_INVALID",
  REQUIREMENT_LINK_INVALID: "REQUIREMENT_LINK_INVALID",
  IDENTITY_INVALID: "IDENTITY_INVALID",
  APPLICABILITY_INVALID: "APPLICABILITY_INVALID",
} as const;
export const LEGAL_RULE_CATALOG_EVENTS = {
  SAVED: "event.legal-rule-catalog.saved.v1",
  SELECTED: "event.legal-rule-catalog.selected.v1",
  PREPARATION_REQUESTED: "event.legal-rule-catalog.preparation-requested.v1",
  RESULT_RECORDED: "event.legal-rule-catalog.result-recorded.v1",
  RESULT_IMPORTED: "event.legal-rule-catalog.result-imported.v1",
  // Import declarations are audit evidence, not server-approved scope decisions.
  IMPORT_EXCLUSIONS_RECORDED:
    "event.legal-rule-catalog.import-exclusions-recorded.v1",
  SCOPE_AUTHORIZATION_SUBMITTED:
    "event.legal-rule-catalog.scope-authorization-submitted.v1",
  SCOPE_AUTHORIZATION_APPROVED:
    "event.legal-rule-catalog.scope-authorization-approved.v1",
  SCOPE_AUTHORIZATION_REVOKED:
    "event.legal-rule-catalog.scope-authorization-revoked.v1",
  DELETED: "event.legal-rule-catalog.deleted.v1",
} as const;
export const LEGAL_RULE_INELIGIBILITY_REASONS = {
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  INDEX_UNAVAILABLE: "INDEX_UNAVAILABLE",
  CITATION_INVALID: "CITATION_INVALID",
  CATALOG_EMPTY: "CATALOG_EMPTY",
} as const;
export const LEGAL_RULE_LIMITS = {
  catalogRules: 10000,
  pageSize: 50,
  preparedArtifacts: 256,
  // Why: Interactive import validates and locks each selected rule inside one transaction.
  // How: Cap one request below the general prepared-artifact ceiling to bound pool occupancy.
  // Invariant: Dry-run and write payloads share the same transport limit.
  importBatchItems: 100,
} as const;
export const LEGAL_RULE_SOURCE_PROVISION_LEVELS = {
  ARTICLE: "ARTICLE",
  CLAUSE: "CLAUSE",
  POINT: "POINT",
} as const;
export const LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS = {
  CONTEXT_TOO_LARGE: "SOURCE_CONTEXT_TOO_LARGE",
  CONTEXT_UNRESOLVED: "SOURCE_CONTEXT_UNRESOLVED",
  EFFECT_NOT_EFFECTIVE: "EFFECT_NOT_EFFECTIVE",
  STRUCTURAL_ONLY: "STRUCTURAL_ONLY",
  UNCLASSIFIED: "UNCLASSIFIED",
} as const;
const id = z.string().uuid();
const text = z.string().trim().min(1).max(12000);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
export const legalRuleCitationSchema = z.strictObject({
  documentId: z.string().trim().min(1).max(256),
  locator: z.string().trim().min(1).max(512),
});
export const legalRuleWriteSchema = z.strictObject({
  legalRuleId: z.string().trim().min(1).max(128),
  title: text.max(512),
  description: text,
  citationLocatorRefs: z.array(legalRuleCitationSchema).min(1).max(64),
  expectedRevision: z.number().int().positive(),
});
export type LegalRuleWrite = z.infer<typeof legalRuleWriteSchema>;
export const legalRuleSourceProvisionQuerySchema = z.strictObject({
  sourceVersionId: id,
  documentId: z.string().trim().min(1).max(256),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(LEGAL_RULE_LIMITS.pageSize)
    .default(LEGAL_RULE_LIMITS.pageSize),
});
export type LegalRuleSourceProvisionQuery = z.infer<
  typeof legalRuleSourceProvisionQuerySchema
>;
export const legalRuleSourceProvisionImportSchema = z.strictObject({
  documentId: z.string().trim().min(1).max(256),
  locator: z.string().trim().min(1).max(512),
  expectedRevision: z.number().int().positive(),
});
export type LegalRuleSourceProvisionImport = z.infer<
  typeof legalRuleSourceProvisionImportSchema
>;
// Bound preview payloads separately from exact source citations and rule descriptions.
export const LEGAL_RULE_REFERENCE_PREVIEW_LIMITS = {
  references: 8,
  excerptCharacters: 1200,
} as const;
export const legalRuleSourceReferenceContextSchema = z.strictObject({
  referenceId: fingerprint,
  text: z.string().min(1),
  resolutionState: z.enum(LEGAL_REFERENCE_RESOLUTION_STATES),
  target: z
    .strictObject({
      documentId: z.string().min(1),
      documentTitle: z.string(),
      locator: z.string().min(1),
      excerpt: z
        .string()
        .max(LEGAL_RULE_REFERENCE_PREVIEW_LIMITS.excerptCharacters),
      truncated: z.boolean(),
    })
    .nullable(),
});
export type LegalRuleSourceReferenceContext = z.infer<
  typeof legalRuleSourceReferenceContextSchema
>;
export const legalRuleSourceProvisionSchema = z.strictObject({
  sourceVersionId: id,
  documentId: z.string().trim().min(1).max(256),
  documentTitle: z.string().trim().min(1).max(512),
  locator: z.string().trim().min(1).max(512),
  legalRuleId: z.string().trim().min(1).max(128),
  title: text.max(512),
  description: text,
  citationLocatorRefs: z.array(legalRuleCitationSchema).min(1).max(64),
  level: z.enum(LEGAL_RULE_SOURCE_PROVISION_LEVELS),
  // Older responses and fixtures can omit this display-only evidence.
  referenceContext: z
    .array(legalRuleSourceReferenceContextSchema)
    .max(LEGAL_RULE_REFERENCE_PREVIEW_LIMITS.references)
    .optional(),
});
export const legalRuleSourceProvisionLimitationSchema = z.strictObject({
  locator: z.string().trim().min(1).max(512),
  reason: z.enum(LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS),
});
export type LegalRuleSourceProvisionLimitation = z.infer<
  typeof legalRuleSourceProvisionLimitationSchema
>;
export const legalRuleSourceProvisionPageSchema = z.strictObject({
  sourceVersionId: id,
  documentId: z.string().trim().min(1).max(256),
  total: z.number().int().min(0),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  items: z.array(legalRuleSourceProvisionSchema),
  limitations: z.array(legalRuleSourceProvisionLimitationSchema),
});
export type LegalRuleSourceProvisionPage = z.infer<
  typeof legalRuleSourceProvisionPageSchema
>;
export type LegalRuleSourceProvision = z.infer<
  typeof legalRuleSourceProvisionSchema
>;
export const legalRuleCatalogWriteSchema = z.strictObject({
  version: z.string().trim().min(1).max(128),
  legalSourceVersionId: id,
});
export const legalRuleFilterSchema = z.strictObject({
  search: z.string().trim().max(128).default(""),
  state: z.enum(LEGAL_RULE_PREPARATION_STATES).optional(),
  withAssessmentRules: z
    .preprocess(
      (value) => (value === "true" ? true : value === "false" ? false : value),
      z.boolean(),
    )
    .optional(),
});
export const legalRuleListSchema = legalRuleFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LegalRuleFilter = z.infer<typeof legalRuleFilterSchema>;
export type LegalRuleList = z.infer<typeof legalRuleListSchema>;
export const legalRuleSelectionSchema = z.strictObject({
  catalogVersionId: id,
  expectedRevision: z.number().int().positive(),
  mode: z.enum(LEGAL_RULE_SELECTION_MODES),
  filters: legalRuleFilterSchema,
  ruleIds: z.array(id).max(LEGAL_RULE_LIMITS.catalogRules).default([]),
});
export type LegalRuleSelection = z.infer<typeof legalRuleSelectionSchema>;
export const legalRuleBulkSchema = z.strictObject({
  selectionId: id,
  idempotencyKey: id,
});
export const legalRuleRetrySchema = legalRuleBulkSchema.pick({
  idempotencyKey: true,
});
export const legalRuleRegenerateSchema = z.strictObject({
  idempotencyKey: id,
  expectedResultId: id,
  useLatestInputs: z.boolean().default(false),
});
export const preparationRuleInputSchema = z.strictObject({
  ruleId: id,
  legalRuleId: z.string(),
  title: text.max(512),
  description: text,
  catalogVersionId: id,
  catalogVersion: z.string(),
  catalogRevision: z.number().int().positive(),
  legalSourceVersionId: id,
  sourceVersion: z.string(),
  indexId: id,
  indexContentHash: z.string(),
  citations: z
    .array(
      z.strictObject({
        chunkId: z.string(),
        documentId: z.string(),
        locator: z.string(),
        contentSha256: z.string(),
        content: z.string().min(1).max(2000000),
      }),
    )
    .min(1)
    .max(64),
});
export type PreparationRuleInput = z.infer<typeof preparationRuleInputSchema>;
/**
 * Business purpose: Apply the existing downstream authoring contract to one selected LegalRule result.
 * Business rules:
 * - Derived assessment prose comes from canonical parent bindings; coverage and context retain existing validation.
 * Execution flow:
 * 1. Parse the downstream packet with its shared contract.
 * 2. Forward validation issues or return the normalized packet with the analysis.
 * Failure cases:
 * - Invalid coverage or malformed downstream artifacts become schema issues rather than fabricated output.
 * Side effects:
 * - Pure normalization; no source, catalog or assessment state is changed.
 */
function normalizeSelectedRuleOutput(
  payload: {
    analysis: string;
    legalRequirements: unknown[];
    assessmentRules: unknown[];
    contextRelations: unknown[];
  },
  ctx: z.RefinementCtx,
) {
  const { analysis, ...packet } = payload;
  const parsed = complianceRuleSetPacketSchema.safeParse(packet);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    return z.NEVER;
  }
  return { analysis, ...parsed.data };
}
export const preparationRuleOutputSchema = z
  .strictObject({
    analysis: text.max(100000),
    legalRequirements: z
      .array(legalRequirementSchema)
      .max(LEGAL_RULE_LIMITS.preparedArtifacts),
    assessmentRules: z
      .array(assessmentRuleAuthoringSchema)
      .max(LEGAL_RULE_LIMITS.preparedArtifacts),
    contextRelations: z
      .array(legalContextRelationSchema)
      .max(LEGAL_RULE_LIMITS.preparedArtifacts)
      .default([]),
  })
  .transform(normalizeSelectedRuleOutput);
export type PreparationRuleOutput = z.infer<typeof preparationRuleOutputSchema>;
// Source-level semantic authority is separate from a selected-run result or a client
// scope flag. Existing import/worker output schemas remain unchanged. An independent
// reviewer can approve an exact normative candidate once; subsequent identical
// imports/regenerations can consume that authority without a model invocation.
const scopeHash = z.string().regex(/^[a-f0-9]{64}$/);
export const selectedScopeDecisionSchema = z.strictObject({
  legalRequirementId: z.string().min(1).max(128),
  stage: z.enum(PREPARATION_SCOPE_STAGES),
  rationale: z.string().trim().min(8).max(8000),
  technicalDeliverable: z.string().trim().min(1).max(8000).nullable(),
  // Offsets are UTF-16 code units, like other pinned legal source spans.
  sourceSupport: z
    .array(
      z.strictObject({
        chunkId: z.string().min(1),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive(),
        contentSha256: scopeHash,
      }),
    )
    .min(1)
    .max(256),
});
export const selectedScopeAuthorizationSubmitSchema = z.strictObject({
  ruleId: id,
  expectedCatalogRevision: z.number().int().positive(),
  expectedReviewRevision: z.number().int().nonnegative(),
  output: preparationRuleOutputSchema,
  decisions: z
    .array(selectedScopeDecisionSchema)
    .min(1)
    .max(LEGAL_RULE_LIMITS.preparedArtifacts),
});
export const selectedScopeAuthorizationApproveSchema = z.strictObject({
  ruleId: id,
  expectedCatalogRevision: z.number().int().positive(),
  scopeKey: scopeHash,
  expectedReviewRevision: z.number().int().positive(),
  decisionDigest: scopeHash,
  confirmsLegalReview: z.literal(true),
});
export const selectedScopeAuthorizationRevokeSchema = z.strictObject({
  expectedCatalogRevision: z.number().int().positive(),
  scopeKey: scopeHash,
  expectedReviewRevision: z.number().int().positive(),
  reason: text.max(2000),
  confirmsRevocation: z.literal(true),
});
export const SELECTED_SCOPE_AUTHORIZATION_STATES = {
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export const selectedScopeAuthorizationSummarySchema = z.object({
  scopeKey: scopeHash,
  decisionDigest: scopeHash,
  revision: z.number().int().positive(),
  state: z.enum(SELECTED_SCOPE_AUTHORIZATION_STATES),
});
export const selectedScopeAuthorizationListSchema = z.object({
  authorizations: z.array(selectedScopeAuthorizationSummarySchema),
});
export const selectedScopeAuthorizationDetailSchema = z.object({
  scopeKey: scopeHash,
  ruleId: id,
  state: z.enum(SELECTED_SCOPE_AUTHORIZATION_STATES),
  revision: z.number().int().positive(),
  catalogRevision: z.number().int().positive(),
  decisionDigest: scopeHash,
  submittedBy: z.string().min(1),
  approvedBy: z.string().nullable(),
  approvedAt: z.coerce.date().nullable(),
  legalSourceVersionId: id,
  output: preparationRuleOutputSchema,
  decisions: z.array(selectedScopeDecisionSchema),
  citations: z.array(
    z.object({
      chunkId: z.string().min(1),
      documentId: z.string().min(1),
      locator: z.string().min(1),
      contentSha256: z.string().min(1),
      content: z.string(),
    }),
  ),
});
export type SelectedScopeDecision = z.infer<typeof selectedScopeDecisionSchema>;
export type SelectedScopeAuthorizationSubmit = z.infer<
  typeof selectedScopeAuthorizationSubmitSchema
>;
export type SelectedScopeAuthorizationApprove = z.infer<
  typeof selectedScopeAuthorizationApproveSchema
>;
export type SelectedScopeAuthorizationRevoke = z.infer<
  typeof selectedScopeAuthorizationRevokeSchema
>;

/** Version of the externally authored Assessment Rule Import document. */
export const ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION = 1 as const;
/** Why a reviewed Legal Rule (or part of one) was deliberately not imported. */
export const ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS = {
  CONTEXT_ONLY: "CONTEXT_ONLY",
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  NON_ASSESSABLE: "NON_ASSESSABLE",
  NEEDS_REVIEW: "NEEDS_REVIEW",
} as const;
/** Fixed analysis text stored when an import item supplies none. */
export const ASSESSMENT_RULE_IMPORT_DEFAULT_ANALYSIS =
  "Imported via Assessment Rule Import v1.";
const importId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
// The import omits server-derived prose (legalIntent, applicabilityGuidance, criteria[].statement,
// unresolvedConditions, contextRelationIds) so a stray value is rejected instead of silently trusted.
const assessmentRuleImportRuleSchema = assessmentRuleAuthoringSchema
  .omit({
    legalIntent: true,
    applicabilityGuidance: true,
    unresolvedConditions: true,
    contextRelationIds: true,
    semanticAuthority: true,
    criteria: true,
  })
  .extend({
    criteria: z
      .array(
        assessmentRuleCriterionSchema.omit({ statement: true }).extend({
          legalRequirementIds: z.array(importId).min(1).max(64),
        }),
      )
      .min(1)
      .max(64),
  })
  // Agent-oriented investigation hints are optional in v1; the importer stores them empty.
  .partial({
    investigationGoals: true,
    startingNodeTypes: true,
    targetNodeTypes: true,
    edgeStrategies: true,
    graphQueries: true,
    keywords: true,
    commonApis: true,
    commonLibraries: true,
    patterns: true,
    supportingEvidence: true,
    negativeEvidence: true,
  });
export type AssessmentRuleImportRule = z.infer<
  typeof assessmentRuleImportRuleSchema
>;
export const assessmentRuleImportItemSchema = z.strictObject({
  ruleId: id,
  analysis: text.max(100000).optional(),
  legalRequirements: z
    .array(legalRequirementSchema)
    .min(1)
    .max(LEGAL_RULE_LIMITS.preparedArtifacts),
  contextRelations: z
    .array(legalContextRelationSchema)
    .max(LEGAL_RULE_LIMITS.preparedArtifacts)
    .default([]),
  assessmentRules: z
    .array(assessmentRuleImportRuleSchema)
    .min(1)
    .max(LEGAL_RULE_LIMITS.preparedArtifacts),
});
export type AssessmentRuleImportItem = z.infer<
  typeof assessmentRuleImportItemSchema
>;
export const assessmentRuleImportExcludedItemSchema = z.strictObject({
  ruleId: id,
  reasonCode: z.enum(ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS),
  reason: text,
});
export const assessmentRuleImportRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(ASSESSMENT_RULE_IMPORT_SCHEMA_VERSION),
    catalogVersionId: id,
    expectedCatalogRevision: z.number().int().positive(),
    legalSourceVersionId: id,
    // When true the document is fully validated and previewed but nothing is written.
    dryRun: z.boolean().default(false),
    items: z
      .array(assessmentRuleImportItemSchema)
      .max(LEGAL_RULE_LIMITS.importBatchItems),
    excludedItems: z
      .array(assessmentRuleImportExcludedItemSchema)
      .max(LEGAL_RULE_LIMITS.catalogRules)
      .default([]),
  })
  .refine(
    (request) =>
      new Set(request.items.map((item) => item.ruleId)).size ===
      request.items.length,
    { message: "each ruleId may appear once in items", path: ["items"] },
  );
export type AssessmentRuleImportRequest = z.infer<
  typeof assessmentRuleImportRequestSchema
>;
export const assessmentRuleImportResultSchema = z.strictObject({
  catalogVersionId: id,
  catalogRevision: z.number().int().positive(),
  legalSourceVersionId: id,
  dryRun: z.boolean(),
  imported: z.array(
    z.strictObject({
      ruleId: id,
      // Null in a dry run, where no result is recorded; `revision` is then the revision an import would record.
      resultId: id.nullable(),
      revision: z.number().int().positive(),
      assessmentRuleCount: z.number().int().min(0),
      // True when an identical prepared result already existed and nothing was written.
      replayed: z.boolean(),
    }),
  ),
  excludedItems: z.array(assessmentRuleImportExcludedItemSchema),
});
export type AssessmentRuleImportResult = z.infer<
  typeof assessmentRuleImportResultSchema
>;
export const preparationInstructionReceiptSchema = z.strictObject({
  revision: z.string().trim().min(1).max(256),
  content: z.string().min(1).max(200000),
  // Deprecated receipt fields remain optional to read historical result records.
  fingerprint: fingerprint.optional(),
  bundleFingerprint: fingerprint.optional(),
});
export const preparationRuleCompleteSchema = z.strictObject({
  preparationRunId: id,
  executionState: z
    .enum(AGENT_EXECUTION_STATES)
    .extract([
      AGENT_EXECUTION_STATES.SUCCEEDED,
      AGENT_EXECUTION_STATES.FAILED,
      AGENT_EXECUTION_STATES.INTERRUPTED,
      AGENT_EXECUTION_STATES.CANCELLED,
    ]),
  output: preparationRuleOutputSchema.nullable(),
  failureCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,127}$/u)
    .nullable(),
});
export type PreparationRuleComplete = z.infer<
  typeof preparationRuleCompleteSchema
>;
// Dry-run request: the worker asks the API to apply the settlement validation before it accepts a result.
export const preparationRuleValidateSchema = preparationRuleCompleteSchema
  .pick({ preparationRunId: true })
  .extend({ output: preparationRuleOutputSchema });
export type PreparationRuleValidate = z.infer<
  typeof preparationRuleValidateSchema
>;
export const preparationRuleClaimSchema = z.strictObject({
  preparationRunId: id,
});
export const preparationRuleClaimedSchema = z.strictObject({
  preparationRunId: id,
  resultId: id,
  revision: z.number().int().positive(),
  input: preparationRuleInputSchema,
  inputFingerprint: fingerprint,
});
export const preparationRuleRefusedSchema = z.strictObject({
  preparationRunId: id,
  resultId: id,
  refused: z.literal(true),
  failureCode: z.literal(LEGAL_RULE_CATALOG_ERRORS.INELIGIBLE),
});
export const preparationRuleClaimResponseSchema = z.union([
  preparationRuleClaimedSchema,
  preparationRuleRefusedSchema,
]);
export const preparationRuleInstructionsSchema = z.strictObject({
  preparationRunId: id,
  receipt: preparationInstructionReceiptSchema,
});

export const legalRuleCatalogSchema = z.object({
  id,
  version: z.string(),
  revision: z.number().int(),
  legalSourceVersionId: id,
});
export const legalRuleCatalogListSchema = z.array(legalRuleCatalogSchema);
export const legalRuleCatalogDeleteResponseSchema = z.strictObject({
  id,
  deleted: z.literal(true),
});
export type LegalRuleCatalogDeleteResponse = z.infer<
  typeof legalRuleCatalogDeleteResponseSchema
>;
export const legalRuleListItemSchema = z.object({
  id,
  legalRuleId: z.string(),
  title: z.string(),
  description: z.string(),
  citationLocatorRefs: z.array(legalRuleCitationSchema),
  state: z.enum(LEGAL_RULE_PREPARATION_STATES),
  ineligibleReason: z.enum(LEGAL_RULE_INELIGIBILITY_REASONS).nullable(),
  lastResultId: id.nullable(),
  lastRunId: id.nullable(),
  lastResultRevision: z.number().int().positive().nullable(),
  lastOutcome: z.enum(AGENT_EXECUTION_STATES).nullable(),
  assessmentRuleCount: z.number().int().nonnegative(),
});
export type LegalRuleListItem = z.infer<typeof legalRuleListItemSchema>;
export const legalRuleSavedSchema = z.object({
  rule: z.object({ id }),
  catalogRevision: z.number().int(),
});
export const legalRulePageSchema = z.object({
  catalogVersionId: id,
  catalogVersion: z.string(),
  catalogRevision: z.number().int(),
  legalSourceVersionId: id,
  total: z.number().int(),
  eligibleTotal: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  items: z.array(legalRuleListItemSchema),
});
export const legalRuleSelectionResultSchema = z.object({
  selectionId: id,
  selectedCount: z.number().int().positive(),
  ruleIds: z.array(id),
  catalogRevision: z.number().int(),
  scope: legalRuleSelectionSchema,
  fingerprint,
});
export const legalRuleActivationRequestSchema = z
  .strictObject({
    expectedRevision: z.number().int().positive(),
    idempotencyKey: id,
    results: z
      .array(
        z.strictObject({
          ruleId: id,
          resultId: id,
          revision: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(LEGAL_RULE_LIMITS.catalogRules),
  })
  .superRefine((request, context) => {
    const ruleIds = new Set(request.results.map((item) => item.ruleId));
    const resultIds = new Set(request.results.map((item) => item.resultId));
    if (
      ruleIds.size !== request.results.length ||
      resultIds.size !== request.results.length
    )
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "Selected result identities must be unique",
      });
  });
export type LegalRuleActivationRequest = z.infer<
  typeof legalRuleActivationRequestSchema
>;
export const legalRuleActivationResultSchema = z.strictObject({
  activationRecordId: id,
  ruleSetVersionId: id,
  version: z.string().min(1),
  assessmentRuleCount: z.number().int().positive(),
  selectedResultCount: z.number().int().positive(),
  previousActiveRuleSetVersionId: id.nullable(),
  replayed: z.boolean(),
});
export type LegalRuleActivationResult = z.infer<
  typeof legalRuleActivationResultSchema
>;
const preparationRuleBatchItemSchema = z.object({
  ruleId: id,
  resultId: id,
  skipped: z.boolean(),
  legalRuleId: z.string(),
  title: z.string(),
  revision: z.number().int(),
  preparationRunId: id,
  executionState: z.enum(AGENT_EXECUTION_STATES),
  failureCode: z.string().nullable(),
  output: preparationRuleOutputSchema.nullable(),
});
export const preparationRuleBatchSchema = z.object({
  id,
  selectionId: id,
  requestedBy: z.string(),
  createdAt: z.string(),
  scope: legalRuleSelectionSchema,
  selected: z.number().int(),
  prepared: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  complete: z.boolean(),
  items: z.array(preparationRuleBatchItemSchema),
  ruleSet: z.object({
    legalRequirements: z.array(legalRequirementSchema),
    assessmentRules: z.array(assessmentRuleSchema),
    contextRelations: z.array(legalContextRelationSchema).default([]),
  }),
});
export type PreparationRuleBatch = z.infer<typeof preparationRuleBatchSchema>;
export const preparationRuleHistoryQuerySchema = z.strictObject({
  beforeRevision: z.coerce.number().int().positive().optional(),
});
export const preparationRuleHistorySchema = z.object({
  nextBeforeRevision: z.number().int().positive().nullable().default(null),
  ruleId: id,
  currentResultId: id.nullable(),
  latestResultId: id.nullable(),
  results: z.array(
    z.object({
      id,
      revision: z.number().int(),
      batchId: id,
      preparationRunId: id,
      executionState: z.enum(AGENT_EXECUTION_STATES),
      requestedBy: z.string(),
      createdAt: z.string(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
      inputFingerprint: fingerprint,
      input: preparationRuleInputSchema,
      instructionReceipt: preparationInstructionReceiptSchema.nullable(),
      output: preparationRuleOutputSchema.nullable(),
      failureCode: z.string().nullable(),
    }),
  ),
});
export type PreparationRuleHistory = z.infer<
  typeof preparationRuleHistorySchema
>;

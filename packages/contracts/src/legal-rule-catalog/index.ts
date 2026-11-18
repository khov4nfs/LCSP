import { z } from "zod";
import { AGENT_EXECUTION_STATES } from "../assessment/agentic-runtime.ts";
import {
  legalRequirementSchema,
  assessmentRuleSchema,
  assessmentRuleAuthoringSchema,
  legalContextRelationSchema,
  complianceRuleSetPacketSchema,
} from "../compliance-rule-set/schemas.ts";

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
} as const;
export const LEGAL_RULE_CATALOG_EVENTS = {
  SAVED: "event.legal-rule-catalog.saved.v1",
  SELECTED: "event.legal-rule-catalog.selected.v1",
  PREPARATION_REQUESTED: "event.legal-rule-catalog.preparation-requested.v1",
  RESULT_RECORDED: "event.legal-rule-catalog.result-recorded.v1",
  DELETED: "event.legal-rule-catalog.deleted.v1",
} as const;
export const LEGAL_RULE_INELIGIBILITY_REASONS = {
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  INDEX_UNAVAILABLE: "INDEX_UNAVAILABLE",
  CITATION_INVALID: "CITATION_INVALID",
  CATALOG_EMPTY: "CATALOG_EMPTY",
} as const;
export const LEGAL_RULE_LIMITS = { catalogRules: 10000, pageSize: 50 } as const;
export const LEGAL_RULE_SOURCE_PROVISION_LEVELS = {
  ARTICLE: "ARTICLE",
  CLAUSE: "CLAUSE",
  POINT: "POINT",
} as const;
export const LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS = {
  CONTEXT_TOO_LARGE: "SOURCE_CONTEXT_TOO_LARGE",
  CONTEXT_UNRESOLVED: "SOURCE_CONTEXT_UNRESOLVED",
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
  pageSize: z.coerce.number().int().min(1).max(LEGAL_RULE_LIMITS.pageSize).default(LEGAL_RULE_LIMITS.pageSize),
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
    legalRequirements: z.array(legalRequirementSchema).max(256),
    assessmentRules: z.array(assessmentRuleAuthoringSchema).max(256),
    contextRelations: z.array(legalContextRelationSchema).max(256).default([]),
  })
  .transform(normalizeSelectedRuleOutput);
export type PreparationRuleOutput = z.infer<typeof preparationRuleOutputSchema>;
export const preparationInstructionReceiptSchema = z.strictObject({
  revision: z.string().trim().min(1).max(256),
  fingerprint,
  content: z.string().min(1).max(200000),
  bundleFingerprint: fingerprint,
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
  lastOutcome: z.enum(AGENT_EXECUTION_STATES).nullable(),
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

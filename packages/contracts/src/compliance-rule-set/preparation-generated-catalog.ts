import { z } from "zod";
import { ARTIFACT_LIFECYCLE_STATES } from "../assessment/agentic-runtime.ts";
import {
  COMPLIANCE_RULE_SET_LIMITS,
  LEGAL_OPERATIVE_MODALITIES,
} from "./constants.ts";
import { legalRequirementCoverageSchema } from "./schemas.ts";

export const PREPARATION_CATALOG_KINDS = {
  REQUIREMENT: "REQUIREMENT",
  ASSESSMENT_RULE: "ASSESSMENT_RULE",
} as const;

export const PREPARATION_CATALOG_SOURCES = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export const PREPARATION_CATALOG_COMPLETENESS = {
  PARTIAL: "PARTIAL",
  COMPLETE: "COMPLETE",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export const PREPARATION_CATALOG_REFERENCE_STATES = {
  DRAFT_DECLARED: "DRAFT_DECLARED",
  SUBMITTED_VERIFIED: "SUBMITTED_VERIFIED",
  NOT_RECORDED: "NOT_RECORDED",
} as const;

export const PREPARATION_CATALOG_UNAVAILABLE_REASONS = {
  NO_DRAFT_OR_SUBMITTED_RULE_SET: "NO_DRAFT_OR_SUBMITTED_RULE_SET",
} as const;

const catalogId = z
  .string()
  .trim()
  .min(1)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxIdLength);
const catalogText = z.string().max(COMPLIANCE_RULE_SET_LIMITS.maxTextLength);
const catalogShortText = z
  .string()
  .max(COMPLIANCE_RULE_SET_LIMITS.maxShortTextLength);

export const preparationGeneratedCatalogRequestSchema = z.strictObject({
  inventoryRevision: z.coerce.number().int().positive(),
  kind: z.enum(PREPARATION_CATALOG_KINDS),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .optional(),
  search: z.string().trim().max(128).optional(),
});
export type PreparationGeneratedCatalogRequest = z.infer<
  typeof preparationGeneratedCatalogRequestSchema
>;

const catalogSourceReferenceSchema = z.strictObject({
  documentId: catalogId,
  locator: catalogShortText,
  contentSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

const catalogClaimBindingSchema = z.strictObject({
  claimId: catalogId,
  role: catalogShortText,
  index: z.number().int().nonnegative(),
});

const operativePropositionSchema = z.strictObject({
  actor: catalogText,
  modality: z.enum(LEGAL_OPERATIVE_MODALITIES),
  action: catalogText,
  sourceRefs: z.array(catalogSourceReferenceSchema).max(64),
});

const requirementDataSchema = z.strictObject({
  legalRequirementId: catalogId,
  title: catalogShortText,
  proposition: catalogText,
  operativePropositions: z.array(operativePropositionSchema).max(64).nullable(),
  applicabilityConditions: z.array(catalogShortText).max(64),
  qualifiers: z.array(catalogShortText).max(64),
  exceptions: z.array(catalogShortText).max(64),
  nonRepositoryDuty: z.boolean(),
  coverage: legalRequirementCoverageSchema,
  claimBindings: z.array(catalogClaimBindingSchema).max(256),
  claimBindingsState: z.enum(PREPARATION_CATALOG_REFERENCE_STATES),
  sourceReferences: z.array(catalogSourceReferenceSchema).max(64),
  sourceReferencesState: z.enum(PREPARATION_CATALOG_REFERENCE_STATES),
});

const assessmentRuleCriterionSchema = z.strictObject({
  criterionId: catalogId,
  legalRequirementIds: z.array(catalogId).max(64),
  statement: catalogText.nullable(),
  investigationFocus: catalogText.nullable(),
});

const assessmentRuleDataSchema = z.strictObject({
  assessmentRuleId: catalogId,
  concept: catalogShortText,
  legalIntent: catalogText.nullable(),
  applicabilityGuidance: catalogText.nullable(),
  legalRequirementIds: z
    .array(catalogId)
    .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems),
  criteria: z.array(assessmentRuleCriterionSchema).max(64),
  investigationGoals: z.array(catalogText).max(64),
  startingNodeTypes: z.array(catalogShortText).max(64),
  targetNodeTypes: z.array(catalogShortText).max(64),
  edgeStrategies: z.array(catalogShortText).max(64),
  keywords: z.array(catalogShortText).max(64),
  requiredEvidence: z.array(catalogText).max(64),
  supportingEvidence: z.array(catalogText).max(64),
  negativeEvidence: z.array(catalogText).max(64),
  unresolvedConditions: z.array(catalogText).max(64).nullable(),
  sourceReferences: z.array(catalogSourceReferenceSchema).max(64),
  sourceReferencesState: z.enum(PREPARATION_CATALOG_REFERENCE_STATES),
});

const responseIdentitySchema = z.strictObject({
  preparationRunId: z.string().uuid(),
  inventoryRevision: z.number().int().positive(),
  legalSourceVersionId: z.string().uuid(),
  materializationId: catalogId,
  source: z.enum(PREPARATION_CATALOG_SOURCES),
  completeness: z.enum(PREPARATION_CATALOG_COMPLETENESS),
  draftVersion: z.number().int().positive().nullable(),
  ruleSetVersionId: z.string().uuid().nullable(),
  lifecycleState: z.enum(ARTIFACT_LIFECYCLE_STATES).nullable(),
  unavailableReason: z.enum(PREPARATION_CATALOG_UNAVAILABLE_REASONS).nullable(),
  total: z.number().int().nonnegative(),
  filteredTotal: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(4096).nullable(),
});

export const preparationGeneratedCatalogRequirementItemSchema = z.strictObject({
  id: catalogId,
  ordinal: z.number().int().nonnegative().nullable(),
  data: requirementDataSchema,
});

export const preparationGeneratedCatalogAssessmentRuleItemSchema =
  z.strictObject({
    id: catalogId,
    ordinal: z.number().int().nonnegative().nullable(),
    data: assessmentRuleDataSchema,
  });
export type PreparationGeneratedCatalogEntry =
  | z.infer<typeof preparationGeneratedCatalogRequirementItemSchema>
  | z.infer<typeof preparationGeneratedCatalogAssessmentRuleItemSchema>;

export const preparationGeneratedCatalogResponseSchema = z.discriminatedUnion(
  "kind",
  [
    responseIdentitySchema.extend({
      kind: z.literal(PREPARATION_CATALOG_KINDS.REQUIREMENT),
      items: z.array(preparationGeneratedCatalogRequirementItemSchema).max(100),
    }),
    responseIdentitySchema.extend({
      kind: z.literal(PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE),
      items: z
        .array(preparationGeneratedCatalogAssessmentRuleItemSchema)
        .max(100),
    }),
  ],
);
export type PreparationGeneratedCatalogResponse = z.infer<
  typeof preparationGeneratedCatalogResponseSchema
>;

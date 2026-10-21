import { z } from "zod";

export const LEGAL_SEMANTIC_AUTHORITIES = {
  LEGAL_NORMATIVE: "LEGAL_NORMATIVE",
  DEFINITION: "DEFINITION",
  CONTEXT: "CONTEXT",
  ASSESSMENT_GUIDANCE: "ASSESSMENT_GUIDANCE",
  EVIDENCE_GUIDANCE: "EVIDENCE_GUIDANCE",
} as const;
export const LEGAL_ASSESSABILITIES = {
  REPOSITORY_VERIFIABLE: "REPOSITORY_VERIFIABLE",
  EXTERNAL_FULFILLMENT: "EXTERNAL_FULFILLMENT",
  MIXED: "MIXED",
  NON_ASSESSABLE: "NON_ASSESSABLE",
} as const;
export const SEMANTIC_AUDIT_VERDICTS = {
  SUPPORTED: "SUPPORTED",
  CONTRADICTED: "CONTRADICTED",
  INSUFFICIENT_SUPPORT: "INSUFFICIENT_SUPPORT",
  MISSING_ASSERTION: "MISSING_ASSERTION",
  WRONG_ACTOR: "WRONG_ACTOR",
  WRONG_MODALITY: "WRONG_MODALITY",
  WRONG_ACTION: "WRONG_ACTION",
  WRONG_SCOPE: "WRONG_SCOPE",
  WRONG_RELATION: "WRONG_RELATION",
  WRONG_SEMANTIC_AUTHORITY: "WRONG_SEMANTIC_AUTHORITY",
} as const;
export const SEMANTIC_AUDIT = {
  schemaRevision: "SOURCE_SEMANTIC_AUDIT_V42",
  role: "legal-semantic-auditor",
  operation: "SEMANTIC_AUDIT",
  maxContextCharacters: 120000,
  relationBatchSize: 1,
} as const;
/** Verifier vocabulary, not source-law rules. Keep the meaning beside each bounded relation. */
export const SEMANTIC_RELATION_CONTRACTS = {
  DEFINED_BY:
    "The FROM assertion uses an actor, object or other term whose meaning is supplied by the TO definition, including a term within a compound expression or semantic paraphrase. A definition may describe a role without using a formal 'means' formula. The FROM assertion need not itself be a definition; compare the defined term and its use, not whether the whole duty is defined.",
  CONTEXT_FOR:
    "The FROM assertion supplies source-supported explanatory, definitional or instrument-wide background relevant to interpreting the TO assertion. The TO may be an operative norm or assessment/evidence guidance. Context need not modify the target, be indispensable to it, or be repeated verbatim there. Confirm shared scope or subject; unrelated local context is not global. This edge does not incorporate a new duty, change a target or override its commencement.",
  CONDITION_OF:
    "The FROM assertion records the applicability scope, addressee, cohort or trigger of the TO assertion. The predicate may also be retained in the target's qualified action or frame; this is not an invalid duplicate. Scope need not be an if-condition. A target modifier keeps the scope/trigger local to that branch.",
  QUALIFIES:
    "The FROM assertion limits the precise TO operative proposition; compare the source-defined limit and target.",
  EXCEPTION_TO:
    "The FROM exception displaces or derogates from the precise TO operative proposition. A separate duty expressly preserved by the source is not the displaced target.",
  TEMPORALLY_APPLIES_TO:
    "The FROM temporal assertion supplies both cohort and temporal predicate for the precise TO operative proposition. Verify that the source applies this branch to that target; instrument effectiveness alone is not a particular duty's commencement.",
  INCORPORATES:
    "The FROM proposition adopts identified substantive content of the TO into its own meaning: performance content (action, object or deadline), or an expressly applicable normative limit (condition, qualification or exception). A source making the TO exception applicable makes its limit part of the FROM norm. The FROM retains its own actor and conditions. A breach reference triggering a different consequence does not adopt the breached duty; contextual mention alone is CROSS_REFERENCE.",
  PRESERVES:
    "The FROM assertion expressly leaves the TO operative proposition intact, including any source-defined no-removal or no-delay effect.",
  EVIDENCE_SLICE_OF:
    "The FROM assessment/evidence guidance concerns a narrower evidence slice of the TO legal norm, without replacing that norm or creating a new legal obligation.",
  CROSS_REFERENCE:
    "The FROM assertion refers to the TO assertion for relevant context without adopting its substantive content as the FROM's own obligation. A reference to breach/non-performance of the TO duty can be a predicate for a different consequence; that does not condition or modify the referenced TO duty. Judge this exact directed pair, not the FROM's relationship to a different sibling consequence.",
} as const;
export const SEMANTIC_INTEGRITY_GAP_CODES = {
  UNAUDITED: "UNAUDITED",
  STALE_AUDIT: "STALE_AUDIT",
  COMPLETENESS_AUDIT_REQUIRED: "COMPLETENESS_AUDIT_REQUIRED",
  RELATION_AUDIT_REQUIRED: "RELATION_AUDIT_REQUIRED",
  SOURCE_SUPPORT_AND_FRAME_REQUIRED: "SOURCE_SUPPORT_AND_FRAME_REQUIRED",
  SOURCE_SUPPORT_ANCHOR_MISMATCH: "SOURCE_SUPPORT_ANCHOR_MISMATCH",
  MIXED_ASSESSABILITY_ASPECTS_REQUIRED: "MIXED_ASSESSABILITY_ASPECTS_REQUIRED",
  FREE_FLOATING_MODIFIER: "FREE_FLOATING_MODIFIER",
  FREE_FLOATING_GUIDANCE: "FREE_FLOATING_GUIDANCE",
  UNKNOWN_ENDPOINT: "UNKNOWN_ENDPOINT",
  UNANCHORED_MODIFIER: "UNANCHORED_MODIFIER",
  CONFLICTING_CLOSURE_ROLE: "CONFLICTING_CLOSURE_ROLE",
  LEGAL_NORMATIVE_ANCHOR_REQUIRED: "LEGAL_NORMATIVE_ANCHOR_REQUIRED",
  INCOMPATIBLE_OPERATIVE_AGGREGATION: "INCOMPATIBLE_OPERATIVE_AGGREGATION",
  BINDING_OUTSIDE_SEMANTIC_CLOSURE: "BINDING_OUTSIDE_SEMANTIC_CLOSURE",
  INCOMPLETE_SEMANTIC_CLOSURE: "INCOMPLETE_SEMANTIC_CLOSURE",
  EXTERNAL_FULFILLMENT_NOT_REPOSITORY_PROVEN:
    "EXTERNAL_FULFILLMENT_NOT_REPOSITORY_PROVEN",
  UNREACHABLE_RELEVANT_CLAIM: "UNREACHABLE_RELEVANT_CLAIM",
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128);
const text = z.string().trim().min(1).max(8000);
/** UTF-16 code-unit offsets, matching pinned AST retrieval/reference coordinates. */
export const legalSourceSupportSchema = z.strictObject({
  nodeId: hash,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  contentSha256: hash,
});
export const legalSemanticFrameSchema = z.strictObject({
  object: text.nullable(),
  beneficiary: text.nullable(),
  trigger: text.nullable(),
  scope: text.nullable(),
  qualifier: text.nullable(),
  exception: text.nullable(),
  temporalApplicability: text.nullable(),
  repositoryObservableAspect: text.nullable(),
  externalFulfillmentAspect: text.nullable(),
});
const verdict = z.enum(SEMANTIC_AUDIT_VERDICTS);
const gaps = z
  .array(z.strictObject({ code: verdict, detail: text.max(1000) }))
  .max(8192);
const rowVerdict = z.strictObject({
  id,
  fingerprint: hash,
  verdict,
  gapCodes: z.array(verdict).max(10),
});
const assertionVerdict = rowVerdict.extend({
  checks: z.strictObject({
    sourceSupport: verdict,
    actor: verdict,
    modality: verdict,
    action: verdict,
    scope: verdict,
    semanticAuthority: verdict,
    assessability: verdict,
  }),
});
export const SEMANTIC_SOURCE_CONTENT_USES = {
  ADOPTED_PERFORMANCE: "ADOPTED_PERFORMANCE",
  ADOPTED_NORMATIVE_LIMIT: "ADOPTED_NORMATIVE_LIMIT",
  REFERENCE_ONLY: "REFERENCE_ONLY",
  NO_CONTENT_DEPENDENCY: "NO_CONTENT_DEPENDENCY",
  UNDETERMINED: "UNDETERMINED",
} as const;
export const SEMANTIC_TARGET_SCOPE_READINGS = {
  EXACT_SOURCE_TARGET: "EXACT_SOURCE_TARGET",
  SUPPORTED_MEMBER_OF_SOURCE_TARGET_SET: "SUPPORTED_MEMBER_OF_SOURCE_TARGET_SET",
  OUTSIDE_SOURCE_TARGET_SCOPE: "OUTSIDE_SOURCE_TARGET_SCOPE",
  UNDETERMINED: "UNDETERMINED",
} as const;
const relationVerdict = rowVerdict.extend({
  targetScopeReading: z.enum(SEMANTIC_TARGET_SCOPE_READINGS),
  sourceContentReading: z.enum(SEMANTIC_SOURCE_CONTENT_USES).optional(),
  checks: z.strictObject({
    kind: verdict,
    direction: verdict,
    target: verdict,
  }),
});
export const SEMANTIC_SOURCE_DEPENDENCIES = {
  NONE: "NONE",
  CONDITION: "CONDITION",
  QUALIFICATION: "QUALIFICATION",
  EXCEPTION: "EXCEPTION",
  PRESERVATION: "PRESERVATION",
  TEMPORAL_APPLICATION: "TEMPORAL_APPLICATION",
  DEFINED_MEANING: "DEFINED_MEANING",
  SUBSTANTIVE_ADOPTION: "SUBSTANTIVE_ADOPTION",
  REFERENCE: "REFERENCE",
  EVIDENCE_LIMIT: "EVIDENCE_LIMIT",
  EXPLANATION: "EXPLANATION",
} as const;
export const SEMANTIC_SOURCE_MODALITIES = {
  DUTY: "DUTY",
  PERMISSION: "PERMISSION",
  PROHIBITION: "PROHIBITION",
  NON_OPERATIVE: "NON_OPERATIVE",
} as const;
const sourceFact = z.strictObject({
  id: id.max(32),
  dependency: z.enum(SEMANTIC_SOURCE_DEPENDENCIES),
  modality: z.enum(SEMANTIC_SOURCE_MODALITIES),
  semanticAuthority: z.enum(LEGAL_SEMANTIC_AUTHORITIES),
  quote: text.max(4000),
  meaning: text.max(1000),
  sourceSupport: legalSourceSupportSchema,
});
const nonMaterialSpans = z
  .array(z.strictObject({ spanId: id.max(24), reason: text.max(1000) }))
  .max(2048);
export const SEMANTIC_SOURCE_ROLES = {
  ...LEGAL_SEMANTIC_AUTHORITIES,
  REPRESENTATION_GUIDANCE: "REPRESENTATION_GUIDANCE",
} as const;
export const SEMANTIC_SOURCE_OPERATOR_POLARITIES = {
  AFFIRMED: "AFFIRMED",
  DENIED: "DENIED",
} as const;
const sourceReading = z.strictObject({
  verifierOperationId: z.string().uuid(),
  facts: z
    .array(
      sourceFact.omit({
        dependency: true,
        modality: true,
        semanticAuthority: true,
      }),
    )
    .max(256),
  noMaterialReason: text.max(1000).nullable(),
  nonMaterialSpans,
});
export const SEMANTIC_SOURCE_DEPENDENCY_EFFECTS = {
  LEGAL_POSITION_CONTINUES: "LEGAL_POSITION_CONTINUES",
  ACTUAL_PERFORMANCE_NOT_ESTABLISHED: "ACTUAL_PERFORMANCE_NOT_ESTABLISHED",
  ASSESSMENT_SCOPE_ONLY: "ASSESSMENT_SCOPE_ONLY",
  REPRESENTATION_MEANING_RETAINED: "REPRESENTATION_MEANING_RETAINED",
  OTHER: "OTHER",
} as const;
export const semanticSourceCatalogSchema = z.strictObject({
  sourceInputFingerprint: hash,
  verifierOperationId: z.string().uuid(),
  facts: z.array(sourceFact).max(256),
  noMaterialReason: text.max(1000).nullable(),
  nonMaterialSpans,
  initialReading: sourceReading,
  reviewedReading: sourceReading,
  dependencyAudit: z.strictObject({
    verifierOperationId: z.string().uuid(),
    inputFingerprint: hash,
    readings: z.array(z.strictObject({
      id: id.max(32),
      effect: z.enum(SEMANTIC_SOURCE_DEPENDENCY_EFFECTS),
      effectStatement: text.max(300),
    })).max(256),
  }).nullable(),
  classification: z.strictObject({
    verifierOperationId: z.string().uuid(),
    inputFingerprint: hash,
    readings: z
      .array(
        z.strictObject({
          id: id.max(32),
          addressee: text.max(300).nullable(),
          sourceRole: z.enum(SEMANTIC_SOURCE_ROLES),
          modalOperator: z.enum(SEMANTIC_SOURCE_MODALITIES),
          operatorPolarity: z.enum(SEMANTIC_SOURCE_OPERATOR_POLARITIES),
          dependency: z.enum(SEMANTIC_SOURCE_DEPENDENCIES),
        }),
      )
      .max(256),
  }),
});
export const SEMANTIC_SOURCE_REPRESENTATIONS = {
  ASSERTION: "ASSERTION",
  QUALIFIED_ASSERTION: "QUALIFIED_ASSERTION",
  RELATION: "RELATION",
  INCORPORATED_ASSERTION: "INCORPORATED_ASSERTION",
  DEFINITION_BINDING: "DEFINITION_BINDING",
  SEMANTIC_UNIT: "SEMANTIC_UNIT",
  SOURCE_STRUCTURE: "SOURCE_STRUCTURE",
  MISSING: "MISSING",
} as const;
export const semanticSourceCoverageSchema = z
  .array(
    z.strictObject({
      sourceId: id.max(32),
      representation: z.enum(SEMANTIC_SOURCE_REPRESENTATIONS),
      claimIds: z.array(id).max(1024),
      relationIds: z.array(id).max(1024),
      finding: text.max(500).nullable(),
    }),
  )
  .max(256);
export type SemanticSourceCatalog = z.infer<typeof semanticSourceCatalogSchema>;
export type SemanticSourceCoverage = z.infer<
  typeof semanticSourceCoverageSchema
>;
export const SEMANTIC_CONCEPT_USE_MODES = {
  DEFINED_MEANING: "DEFINED_MEANING",
  CONTEXTUAL_ASSOCIATION: "CONTEXTUAL_ASSOCIATION",
} as const;
const sourceConceptAudit = z.strictObject({
  inputFingerprint: hash,
  verifierOperationId: z.string().uuid(),
  definitions: z.array(z.strictObject({ factId: id, definedConcepts: z.array(text.max(160)).max(32) })).max(2048),
  factUses: z.array(z.strictObject({ factId: id, uses: z.array(z.strictObject({
    definitionFactId: id, mode: z.enum(SEMANTIC_CONCEPT_USE_MODES), sourceExpression: text.max(300),
  })).max(256) })).max(2048),
});
export const semanticAuditReceiptSchema = z.strictObject({
  sourceConceptAudit: sourceConceptAudit.nullable().optional(),
  schemaRevision: z.literal(SEMANTIC_AUDIT.schemaRevision),
  sourceNodeId: hash,
  sourceRevision: hash,
  inventoryRevision: z.number().int().positive(),
  assertionFingerprint: hash,
  sourceSupportFingerprint: hash,
  contextFingerprint: hash,
  verifierOperationId: z.string().uuid(),
  verifierRole: z.literal(SEMANTIC_AUDIT.role),
  attestation: z
    .string()
    .regex(/^hmac-sha256:[a-f0-9]{64}$/u)
    .optional(),
  verdict,
  reportedVerdict: verdict,
  gaps,
  assertions: z.array(assertionVerdict).max(256),
  relations: z.array(relationVerdict).max(1024),
  relationAudits: z
    .array(
      z.strictObject({
        relationIds: z.array(id).min(1).max(SEMANTIC_AUDIT.relationBatchSize),
        inputFingerprint: hash,
        verifierOperationId: z.string().uuid(),
        verdict,
        gaps,
      }),
    )
    .max(1024)
    .optional(),
  sourceCatalog: semanticSourceCatalogSchema.nullable().optional(),
  relatedSourceCatalogs: z
    .array(
      z.strictObject({
        sourceNodeId: hash,
        catalog: semanticSourceCatalogSchema,
      }),
    )
    .max(1024)
    .optional(),
  completenessAudit: z
    .strictObject({
      inputFingerprint: hash,
      verifierOperationId: z.string().uuid(),
      verdict,
      gaps,
      coverage: semanticSourceCoverageSchema,
    })
    .nullable()
    .optional(),
  reviewHistory: z
    .array(
      z.strictObject({
        inputFingerprint: hash,
        initialOperationId: z.string().uuid(),
        initialVerdict: verdict,
        initialGaps: gaps,
        reviewOperationId: z.string().uuid(),
        reviewVerdict: verdict,
        reviewGaps: gaps,
      }),
    )
    .max(1026)
    .optional(),
  auditedAt: z.string().datetime(),
});
export type SemanticAuditReceipt = z.infer<typeof semanticAuditReceiptSchema>;

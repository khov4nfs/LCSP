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
  schemaRevision: "SOURCE_SEMANTIC_AUDIT_V6",
  role: "legal-semantic-auditor",
  operation: "SEMANTIC_AUDIT",
  maxContextCharacters: 120000,
  relationBatchSize: 4,
} as const;
/** Verifier vocabulary, not source-law rules. Keep the meaning beside each bounded relation. */
export const SEMANTIC_RELATION_CONTRACTS = {
  DEFINED_BY:
    "The FROM assertion uses an actor, object or other term whose meaning is supplied by the TO definition. The FROM assertion need not itself be a definition. A duty performed by a defined actor can use this relation to that actor's definition; compare the actor/term, not whether the whole duty is defined.",
  CONTEXT_FOR:
    "The FROM assertion supplies relevant context for the TO assertion. The TO assertion may be an operative duty or permission. Both may originate in the same source provision. This relation does not incorporate a new duty, replace a target, or change its commencement.",
  CONDITION_OF:
    "The FROM assertion supplies the applicability scope, addressee, cohort or trigger of the TO assertion. Scope need not be an if-condition. A target modifier keeps the scope/trigger local to that branch.",
  QUALIFIES:
    "The FROM assertion limits the precise TO operative proposition; compare the source-defined limit and target.",
  EXCEPTION_TO:
    "The FROM exception displaces or derogates from the precise TO operative proposition. A separate duty expressly preserved by the source is not the displaced target.",
  TEMPORALLY_APPLIES_TO:
    "The FROM temporal assertion supplies both cohort and temporal predicate for the precise TO operative proposition. Verify that the source applies this branch to that target; instrument effectiveness alone is not a particular duty's commencement.",
  INCORPORATES:
    "The FROM assertion expressly borrows identified substantive content of the TO assertion, such as an action, object or deadline. The FROM actor/conditions remain its own. A contextual citation alone is CROSS_REFERENCE.",
  PRESERVES:
    "The FROM assertion expressly leaves the TO operative proposition intact, including any source-defined no-removal or no-delay effect.",
  EVIDENCE_SLICE_OF:
    "The FROM assessment/evidence guidance concerns a narrower evidence slice of the TO legal norm, without replacing that norm or creating a new legal obligation.",
  CROSS_REFERENCE:
    "The FROM assertion refers to the TO assertion for relevant context without claiming that it borrows all the target's substantive content.",
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
  .max(64);
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
const relationVerdict = rowVerdict.extend({
  checks: z.strictObject({
    kind: verdict,
    direction: verdict,
    target: verdict,
  }),
});
export const semanticAuditReceiptSchema = z.strictObject({
  schemaRevision: z.literal(SEMANTIC_AUDIT.schemaRevision),
  sourceNodeId: hash,
  sourceRevision: hash,
  inventoryRevision: z.number().int().positive(),
  assertionFingerprint: hash,
  sourceSupportFingerprint: hash,
  contextFingerprint: hash,
  verifierOperationId: z.string().uuid(),
  verifierRole: z.literal(SEMANTIC_AUDIT.role),
  attestation: z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/u).optional(),
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
    .max(1024),
  completenessAudit: z
    .strictObject({
      inputFingerprint: hash,
      verifierOperationId: z.string().uuid(),
      verdict,
      gaps,
    })
    .nullable(),
  auditedAt: z.string().datetime(),
});
export type SemanticAuditReceipt = z.infer<typeof semanticAuditReceiptSchema>;

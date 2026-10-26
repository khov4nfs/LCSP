import { z } from "zod";
import { LEGAL_APPLICABILITY_MODES } from "./constants.ts";

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
/** Author relation vocabulary, not source-law rules. Keep the meaning beside each bounded relation. */
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
  WRONG_SEMANTIC_AUTHORITY: "WRONG_SEMANTIC_AUTHORITY",
  WRONG_RELATION: "WRONG_RELATION",
  SOURCE_SUPPORT_AND_FRAME_REQUIRED: "SOURCE_SUPPORT_AND_FRAME_REQUIRED",
  SOURCE_SUPPORT_ANCHOR_MISMATCH: "SOURCE_SUPPORT_ANCHOR_MISMATCH",
  MIXED_ASSESSABILITY_ASPECTS_REQUIRED: "MIXED_ASSESSABILITY_ASPECTS_REQUIRED",
  REPOSITORY_ASSESSABLE_DUTY_NOT_COVERED:
    "REPOSITORY_ASSESSABLE_DUTY_NOT_COVERED",
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
const text = z.string().trim().min(1).max(8000);
/** UTF-16 code-unit offsets, matching pinned AST retrieval/reference coordinates. */
export const legalSourceSupportSchema = z.strictObject({
  nodeId: hash,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  contentSha256: hash,
});
export const LEGAL_EFFECT_KINDS = {
  AMENDS: "AMENDS", REPEALS: "REPEALS", REPLACES: "REPLACES",
  SUPPLEMENTS: "SUPPLEMENTS", SUSPENDS: "SUSPENDS", REFERENCES: "REFERENCES",
} as const;
export const LEGAL_EFFECT_TARGET_SCOPES = {EXACT: "EXACT", SUBTREE: "SUBTREE"} as const;
export const legalEffectSchema = z.strictObject({
  kind: z.enum(LEGAL_EFFECT_KINDS),
  targets: z.array(z.strictObject({nodeId: hash, scope: z.enum(LEGAL_EFFECT_TARGET_SCOPES)})).max(128),
  unresolvedTargets: z.array(z.strictObject({documentIdentifier: text.max(500), locator: text.max(500), reason: text})).max(128),
  effectiveFrom: z.string().date().nullable(),
  effectiveUntil: z.string().date().nullable(),
  conditions: text.nullable(),
}).refine((v) => v.targets.length + v.unresolvedTargets.length > 0, "An effect needs an identified or explicitly unresolved target")
  .refine((v) => !v.effectiveFrom || !v.effectiveUntil || v.effectiveFrom < v.effectiveUntil, "Effect end must follow its start");
export const legalSemanticFrameSchema = z.strictObject({
  applicabilityMode: z.enum(LEGAL_APPLICABILITY_MODES).optional(),
  object: text.nullable(),
  beneficiary: text.nullable(),
  trigger: text.nullable(),
  scope: text.nullable(),
  qualifier: text.nullable(),
  exception: text.nullable(),
  temporalApplicability: text.nullable(),
  repositoryObservableAspect: text.nullable(),
  externalFulfillmentAspect: text.nullable(),
  legalEffect: legalEffectSchema.optional(),
});

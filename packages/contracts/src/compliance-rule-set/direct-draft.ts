import { z } from "zod";
import { LEGAL_OPERATIVE_MODALITIES, LEGAL_APPLICABILITY_MODES } from "./constants.ts";
import { LEGAL_ASSESSABILITIES, legalEffectSchema } from "./semantic-support.ts";
import { LEGAL_SEMANTIC_RELATION_KINDS } from "./semantic-graph.ts";

export const PREPARATION_EXECUTION_CONTRACTS = {
  CLAIM_INVENTORY_V1: "CLAIM_INVENTORY_V1",
  DIRECT_DRAFT_V1: "DIRECT_DRAFT_V1",
} as const;
export const RULE_SET_PREPARATION_STAGES = {
  CORPUS_READY: "CORPUS_READY",
  PREPARING_RULE_SET: "PREPARING_RULE_SET",
  VALIDATION_REQUIRED: "VALIDATION_REQUIRED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  RULE_SET_READY: "RULE_SET_READY",
  ACTIVE: "ACTIVE",
} as const;
export const DIRECT_SOURCE_DISPOSITIONS = {
  ANALYZED: "ANALYZED",
  NO_REQUIREMENT: "NO_REQUIREMENT",
  BLOCKED: "BLOCKED",
} as const;

const text = z.string().trim().min(1).max(8000);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const directSourceEvidenceSchema = z.strictObject({
  nodeId: hash,
  quote: text,
});
export const directLegalFindingSchema = z.strictObject({
  statement: text,
  support: z.array(directSourceEvidenceSchema).min(1).max(64),
});
export const directRuleSetCandidateSchema = z.strictObject({
  candidateId: id,
  title: text.max(512),
  obligations: z.array(directLegalFindingSchema.extend({
    actor: text,
    modality: z.enum(LEGAL_OPERATIVE_MODALITIES),
    action: text,
  })).min(1).max(64),
  applicability: z.strictObject({
    mode: z.enum(LEGAL_APPLICABILITY_MODES),
    conditions: z.array(directLegalFindingSchema).max(64),
  }).refine(
    (v) => v.mode === LEGAL_APPLICABILITY_MODES.UNCONDITIONAL
      ? v.conditions.length === 0 : v.conditions.length > 0,
    "Unconditional applicability has no extra conditions; conditional applicability needs source-backed conditions",
  ),
  qualifiers: z.array(directLegalFindingSchema).max(64),
  exceptions: z.array(directLegalFindingSchema).max(64),
  definitions: z.array(directLegalFindingSchema).max(64),
  repositoryAssessability: z.enum(LEGAL_ASSESSABILITIES),
  repositoryObservableAspect: text.nullable().optional(),
  externalFulfillmentAspect: text.nullable().optional(),
  nonAssessableReason: text.nullable(),
  assessmentRule: z.strictObject({
    assessmentRuleId: id,
    concept: text.max(512),
    investigationFocus: text.nullable(),
  }).nullable(),
}).superRefine((v, ctx) => {
  if (v.repositoryAssessability === LEGAL_ASSESSABILITIES.MIXED) {
    if (!v.repositoryObservableAspect || !v.externalFulfillmentAspect)
      ctx.addIssue({ code: "custom", message: "Mixed duties must preserve both the repository-observable and external fulfillment aspects" });
    if (!v.assessmentRule || v.nonAssessableReason !== null)
      ctx.addIssue({ code: "custom", message: "Mixed duties must provide an assessment rule for their repository-verifiable portion and null nonAssessableReason" });
  } else if (v.repositoryAssessability === LEGAL_ASSESSABILITIES.REPOSITORY_VERIFIABLE) {
    if (!v.assessmentRule || v.nonAssessableReason !== null)
      ctx.addIssue({ code: "custom", message: "Repository-verifiable duties need a rule and null nonAssessableReason" });
  } else {
    if (v.assessmentRule !== null || !v.nonAssessableReason)
      ctx.addIssue({ code: "custom", message: "Non-repository duties need an explicit non-assessable reason and no fabricated rule" });
  }
});
export const directDraftSubmissionSchema = z.strictObject({
  packageId: hash,
  candidates: z.array(directRuleSetCandidateSchema).max(32),
  // Updates replace only the named candidate. Deletions must be explicit.
  removeCandidateIds: z.array(id).max(32).default([]),
  legalEffects: z.array(directLegalFindingSchema.extend({
    effectId: id,
    legalEffect: legalEffectSchema,
  })).max(32),
  sourceUnits: z.array(z.strictObject({
    sourceNodeId: hash,
    disposition: z.enum(DIRECT_SOURCE_DISPOSITIONS),
    reason: text.max(2000).nullable(),
  })).min(1).max(32),
  references: z.array(z.strictObject({
    referenceId: hash,
    material: z.boolean(),
    reason: text.max(2000).nullable(),
    fromCandidateId: id.nullable(),
    targetNodeId: hash.nullable(),
    kind: z.enum(LEGAL_SEMANTIC_RELATION_KINDS).nullable(),
  })).max(128),
});
export type DirectRuleSetCandidate = z.infer<typeof directRuleSetCandidateSchema>;
export type DirectDraftSubmission = z.infer<typeof directDraftSubmissionSchema>;

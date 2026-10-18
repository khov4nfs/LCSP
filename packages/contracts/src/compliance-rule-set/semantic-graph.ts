import { z } from "zod";
import { reviewFrontierBindingSchema } from "../legal-source/review-frontier.ts";
import {
  legalSourceSupportSchema,
  legalSemanticFrameSchema,
  LEGAL_ASSESSABILITIES,
  LEGAL_SEMANTIC_AUTHORITIES,
  semanticAuditReceiptSchema,
} from "./semantic-support.ts";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_OPERATIVE_MODALITIES,
} from "./constants.ts";

export const LEGAL_SEMANTIC_CLAIM_TYPES = {
  ...LEGAL_OPERATIVE_MODALITIES,
  ...LEGAL_CONTEXT_RELATION_KINDS,
  CONDITION: "CONDITION",
  TEMPORAL_RULE: "TEMPORAL_RULE",
  TRANSITION_RULE: "TRANSITION_RULE",
  CONTEXT: "CONTEXT",
} as const;
export const LEGAL_CLAIM_ACCOUNTING_ROLES = {
  OPERATIVE_PROPOSITION: "OPERATIVE_PROPOSITION",
  APPLICABILITY_CONDITION: "APPLICABILITY_CONDITION",
  QUALIFIER: "QUALIFIER",
  EXCEPTION: "EXCEPTION",
  CONTEXT: "CONTEXT",
  DEFINITION: "DEFINITION",
} as const;
export const LEGAL_CLAIM_STATES = {
  RELEVANT: "RELEVANT",
  INTENTIONALLY_NON_OPERATIVE: "INTENTIONALLY_NON_OPERATIVE",
} as const;
export const LEGAL_SEMANTIC_RELATION_KINDS = {
  ...LEGAL_CONTEXT_RELATION_KINDS,
  CONDITION: "CONDITION",
  INCORPORATES: "INCORPORATES",
  TEMPORALLY_LIMITS: "TEMPORALLY_LIMITS",
  CONDITION_OF: "CONDITION_OF",
  QUALIFIES: "QUALIFIES",
  EXCEPTION_TO: "EXCEPTION_TO",
  TEMPORALLY_APPLIES_TO: "TEMPORALLY_APPLIES_TO",
  DEFINED_BY: "DEFINED_BY",
  PRESERVES: "PRESERVES",
  EVIDENCE_SLICE_OF: "EVIDENCE_SLICE_OF",
  CONTEXT_FOR: "CONTEXT_FOR",
} as const;
export const LEGAL_SEMANTIC_GRAPH_VERSION = "LEGAL_GRAPH_V3";
export const DOWNSTREAM_SEMANTIC_AUTHORITIES = {
  CLAIM_DERIVED: "CLAIM_DERIVED",
} as const;
export const LEGAL_EVIDENCE_REQUEST_KINDS = {
  REQUIRED: "REQUIRED",
  SUPPORTING: "SUPPORTING",
  NEGATIVE: "NEGATIVE",
} as const;

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(8000);
export const legalClaimBindingSchema = z.strictObject({
  claimId: id,
  role: z.enum(LEGAL_CLAIM_ACCOUNTING_ROLES),
  index: z.number().int().nonnegative(),
});
export const legalSemanticClaimSchema = z.strictObject({
  claimId: id,
  legalSourceVersionId: z.string().uuid(),
  sourceNodeIds: z.array(hash).min(1).max(64),
  // Optional only for immutable historical V2 reads. New inventory gates require all four.
  sourceSupport: z.array(legalSourceSupportSchema).min(1).max(64).optional(),
  semanticAuthority: z.enum(LEGAL_SEMANTIC_AUTHORITIES).optional(),
  semanticFrame: legalSemanticFrameSchema.optional(),
  assessability: z.enum(LEGAL_ASSESSABILITIES).optional(),
  claimType: z.enum(LEGAL_SEMANTIC_CLAIM_TYPES),
  statement: text,
  operative: z
    .strictObject({
      actor: text,
      modality: z.enum(LEGAL_OPERATIVE_MODALITIES),
      action: text,
    })
    .nullable(),
  state: z.enum(LEGAL_CLAIM_STATES),
  nonOperativeReason: text.nullable(),
});
export const legalSemanticGraphSchema = z.strictObject({
  contractVersion: z.enum(["LEGAL_GRAPH_V2", LEGAL_SEMANTIC_GRAPH_VERSION]),
  semanticAudits: z.array(semanticAuditReceiptSchema).max(40000).optional(),
  reviewFrontier: reviewFrontierBindingSchema.optional(),
  materializationId: hash,
  legalSourceVersionId: z.string().uuid(),
  claims: z.array(legalSemanticClaimSchema).max(20000),
  relations: z
    .array(
      z.strictObject({
        relationId: id,
        kind: z.enum(LEGAL_SEMANTIC_RELATION_KINDS),
        fromClaimId: id,
        toClaimId: id,
        referenceId: hash.nullable(),
      }),
    )
    .max(40000),
  sourceAccounting: z
    .array(
      z.strictObject({
        sourceNodeId: hash,
        claimIds: z.array(id).max(128),
        nonSemanticReason: text.nullable(),
      }),
    )
    .max(40000)
    .describe(
      "Explicit Agent inspection of every source node containing text: list ALL identified claims, or a reason that it contains no relevant semantic material. One context claim does not account for another duty in the same node.",
    ),
  referenceAccounting: z
    .array(
      z.strictObject({
        referenceId: hash,
        material: z.boolean(),
        relationIds: z.array(id).max(128),
        nonMaterialReason: text.nullable(),
      }),
    )
    .max(40000)
    .describe(
      "Inspect explicit references. Every material reference requires resolved targets and directed semantic dependencies. Non-material references require an Agent-authored reason.",
    ),
});
export type LegalSemanticGraph = z.infer<typeof legalSemanticGraphSchema>;
export type LegalSemanticClaim = z.infer<typeof legalSemanticClaimSchema>;
export type LegalClaimBinding = z.infer<typeof legalClaimBindingSchema>;
export const legalEvidenceBindingSchema = z.strictObject({
  criterionId: id,
  kind: z.enum(LEGAL_EVIDENCE_REQUEST_KINDS),
});
export type LegalEvidenceBinding = z.infer<typeof legalEvidenceBindingSchema>;

/** A request proves a legal criterion; it cannot author an independent technical obligation. */
export function deriveEvidenceRequests(
  criteria: readonly { criterionId: string; statement: string }[],
  bindings: readonly LegalEvidenceBinding[],
  kind: LegalEvidenceBinding["kind"],
): string[] {
  const byId = new Map(criteria.map((c) => [c.criterionId, c.statement]));
  return bindings
    .filter((b) => b.kind === kind)
    .flatMap((b) => {
      const statement = byId.get(b.criterionId);
      return statement
        ? [`${b.kind} evidence for ${b.criterionId}: ${statement}`]
        : [];
    });
}

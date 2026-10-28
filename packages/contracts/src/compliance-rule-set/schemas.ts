import { LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES } from "../legal-source/management.ts";
import { PREPARATION_EXECUTION_CONTRACTS, RULE_SET_PREPARATION_STAGES } from "./direct-draft.ts";
import { z } from "zod";
import {
  claimInventoryBindingSchema,
  type ClaimInventoryBinding,
  CLAIM_PREPARATION_PHASES,
} from "./preparation-inventory.ts";
import { legalDocumentGraphSchema } from "../legal-source/document-graph.ts";
import {
  legalClaimBindingSchema,
  legalSemanticGraphSchema,
  legalEvidenceBindingSchema,
  DOWNSTREAM_SEMANTIC_AUTHORITIES,
  LEGAL_EVIDENCE_REQUEST_KINDS,
  deriveEvidenceRequests,
  type LegalSemanticGraph,
} from "./semantic-graph.ts";
import {
  deriveAssessmentApplicabilityGuidance,
  assessmentSemanticContext,
  deriveAssessmentLegalIntent,
  resolveAssessmentContextBinding,
} from "./applicability.ts";

import {
  agentExecutionStateSchema,
  artifactLifecycleStateSchema,
} from "../assessment/agentic-runtime.ts";
import {
  ENGINEERING_GRAPH_QUERY_DIRECTIONS,
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  LEGAL_OPERATIVE_MODALITIES,
  LEGAL_APPLICABILITY_MODES,
  LEGAL_REQUIREMENT_CONTEXT_FIELDS,
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  COMPLIANCE_RULE_SET_LIMITS,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  RULE_SET_PREPARATION_FAILURE_REASONS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
} from "./constants.ts";
import {
  LEGAL_SOURCE_CHUNK_STATUSES,
  type LegalSourceChunkStatus,
} from "../legal-source/management.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** Source content hashes use the legalSource representation: `sha256:<64 hex>`. */
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const idSchema = z
  .string()
  .min(1)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxIdLength)
  .regex(ID_PATTERN);
const shortTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxShortTextLength);
const textSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxTextLength);
const shortTextListSchema = z
  .array(shortTextSchema)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems);
// Parent text is already bounded; rendering its binding identity must not truncate that text.
const derivedTextListSchema = z
  .array(z.string().trim().min(1))
  .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems);
/** Raw hex digest computed by the server (rule set digest, source fingerprint). */
const sha256Schema = z.string().regex(SHA256_PATTERN);
/** Source content hash exactly as stored on the pinned legalSource chunk. */
const contentHashSchema = z.string().regex(CONTENT_HASH_PATTERN);

/**
 * Opaque source claim authored by the agent. The server resolves it against
 * the one pinned legalSource and derives the trusted chunk/hash binding; a claim is
 * never trusted identity.
 */
export const complianceRuleSetSourceRefSchema = z
  .object({
    documentId: idSchema,
    locator: shortTextSchema,
    contentSha256: contentHashSchema,
  })
  .strict();
export type ComplianceRuleSetSourceRef = z.infer<
  typeof complianceRuleSetSourceRefSchema
>;

const sourceRefListSchema = z
  .array(complianceRuleSetSourceRefSchema)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxSourceRefsPerRule)
  .default([]);

export const legalOperativePropositionSchema = z
  .object({
    actor: textSchema.describe(
      "The source's actual addressee/subject, including a defined role's criteria. Non-repository and public-body duties still have an actor.",
    ),
    modality: z
      .enum(LEGAL_OPERATIVE_MODALITIES)
      .describe(
        "Agent's interpretation of the normative force, not repository assessability.",
      ),
    action: textSchema.describe(
      "The operative action and object/scope: what must, must not, or may be done. Preserve distinct propositions; do not describe citation coverage or generic context.",
    ),
    sourceRefs: sourceRefListSchema.describe(
      "Optional exact legacy retrieval citations, also declared in the owning LegalRequirement sourceRefs. Claim bindings to immutable source nodes are the canonical provenance; use [] when a structural node has no legacy chunk.",
    ),
  })
  .strict();

/**
 * Structural invariant shared with the database CHECK LegalRequirement_coverage_reason_check:
 * a rule covered by assessment rules carries no reason; a non-assessable rule carries a
 * non-blank one. The refinement checks structure only and never judges the legal meaning.
 */
export const legalRequirementCoverageSchema = z
  .object({
    state: z
      .enum(LEGAL_REQUIREMENT_COVERAGE_STATES)
      .describe(
        "COVERED_BY_ASSESSMENT_RULES requires at least one AssessmentRule legalRequirementIds reference; NON_ASSESSABLE requires none. The model decides legal assessability.",
      ),
    nonAssessableReason: z
      .string()
      .trim()
      .max(COMPLIANCE_RULE_SET_LIMITS.maxTextLength)
      .nullable()
      .describe(
        "Must be null when state is COVERED_BY_ASSESSMENT_RULES; must be a non-blank reason when state is NON_ASSESSABLE.",
      ),
  })
  .strict()
  .superRefine((coverage, context) => {
    const { COVERED_BY_ASSESSMENT_RULES, NON_ASSESSABLE } =
      LEGAL_REQUIREMENT_COVERAGE_STATES;
    if (
      coverage.state === COVERED_BY_ASSESSMENT_RULES &&
      coverage.nonAssessableReason !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["nonAssessableReason"],
        message: `${COVERED_BY_ASSESSMENT_RULES} requires nonAssessableReason to be null`,
      });
    }
    if (
      coverage.state === NON_ASSESSABLE &&
      (coverage.nonAssessableReason === null ||
        coverage.nonAssessableReason.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nonAssessableReason"],
        message: `${NON_ASSESSABLE} requires a non-blank nonAssessableReason`,
      });
    }
  });

/** Agent-authored legal proposition with its context. Meaning only. */
export const legalRequirementSchema = z
  .object({
    legalRequirementId: idSchema,
    applicabilityMode: z.enum(LEGAL_APPLICABILITY_MODES).optional(),
    claimInventoryRevision: z.number().int().positive().optional(),
    claimBindings: z.array(legalClaimBindingSchema).max(256).optional(),
    semanticContext: shortTextListSchema.optional(),
    title: shortTextSchema,
    proposition: textSchema,
    // Historical read models omit this field; new authoring is enforced by the deterministic Gate.
    operativePropositions: z
      .array(legalOperativePropositionSchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems)
      .optional()
      .describe(
        "Required for new Rule Set authoring, including NON_ASSESSABLE duties: at least one explicit actor/modality/action with pinned source bindings. Multiple propositions may be aggregated in one LegalRequirement. Context-only sources belong in typed contextRelations, never a placeholder requirement. Missing structure returns OPERATIVE_PROPOSITION_REQUIRED.",
      ),
    applicabilityConditions: shortTextListSchema.describe(
      "Whom or what the source applies this provision to and what triggers it, as facts that evidence can establish or refute, in the source's own terms (any-of / all-of exactly as written). When the source names a role, class, category, status, threshold or sector and defines or enumerates its criteria, unpack those criteria here and cite the defining provision in sourceRefs; a label is never its own explanation. Required (at least one) when assessment rules cover the requirement; if the source adds no further condition, state the addressee it names.",
    ),
    qualifiers: shortTextListSchema.describe(
      "Timing, actor, modality or degree limits the source places on the duty itself.",
    ),
    exceptions: shortTextListSchema.describe(
      "Each exemption, exclusion or carve-out the source gives for THIS duty, with its own limiting words and the facts that would establish it. Empty when the source gives none.",
    ),
    /** True for organizational/document duties that repository evidence cannot establish. */
    nonRepositoryDuty: z
      .boolean()
      .describe(
        "Whether the duty requires organizational, human, physical or external action that repository/software evidence cannot establish. A software record of an action does not establish performance of that action or create a software obligation absent from the source.",
      ),
    sourceRefs: sourceRefListSchema,
    coverage: legalRequirementCoverageSchema,
  })
  .strict();
export type LegalRequirementInput = z.infer<typeof legalRequirementSchema>;

export const engineeringGraphQuerySchema = z
  .object({
    name: shortTextSchema,
    startNodeTypes: shortTextListSchema,
    direction: z.enum(ENGINEERING_GRAPH_QUERY_DIRECTIONS),
    followEdges: shortTextListSchema,
    stopNodeTypes: shortTextListSchema,
    semanticTypes: shortTextListSchema,
  })
  .strict();

export const assessmentRuleCriterionSchema = z
  .object({
    criterionId: idSchema,
    // Optional only for historical read models; the Gate requires explicit bindings for new authoring.
    legalRequirementIds: z
      .array(idSchema)
      .min(1)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems)
      .optional()
      .describe(
        "Required for new authoring: parent LegalRequirement IDs whose complete normative propositions this criterion evaluates. Must be a subset of the AssessmentRule legalRequirementIds. All parent scope, purpose, conditions and exceptions are inherited; never independently rewrite a broader obligation.",
      ),
    statement: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Canonical normative statement derived from this criterion's legalRequirementIds, including the complete parent predicate and its limits. Not an independently authored technical obligation.",
      ),
    investigationFocus: textSchema
      .optional()
      .describe(
        "Optional narrower evidence focus within the inherited normative statement, such as one storage surface or control. An investigation strategy, never a replacement legal predicate or a new obligation, exception or threshold.",
      ),
  })
  .strict();

/** Agent-authored assessable contract for one or more legal propositions. */
export const assessmentRuleSchema = z
  .object({
    assessmentRuleId: idSchema,
    evidenceBindings: z.array(legalEvidenceBindingSchema).max(256).optional(),
    semanticAuthority: z
      .literal(DOWNSTREAM_SEMANTIC_AUTHORITIES.CLAIM_DERIVED)
      .optional(),
    /** Every AssessmentRule belongs to at least one submitted LegalRequirement. */
    legalRequirementIds: z
      .array(idSchema)
      .min(1)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems)
      .describe(
        "LegalRequirement IDs covered by this AssessmentRule; never reference a LegalRequirement declared NON_ASSESSABLE.",
      ),
    concept: shortTextSchema,
    legalIntent: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Canonical intent from linked parent propositions; not independently reinterpreted.",
      ),
    contextRelationIds: z
      .array(idSchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxContextRelations)
      .optional()
      .describe(
        "Canonical inherited directed context dependency IDs, including incorporation. Omit to derive; supplied omissions or reversals return APPLICABILITY_BINDING_MISMATCH.",
      ),
    unresolvedConditionBindings: z
      .array(
        z
          .object({
            legalRequirementId: idSchema,
            field: z.enum(LEGAL_REQUIREMENT_CONTEXT_FIELDS),
            index: z.number().int().min(0),
          })
          .strict(),
      )
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems)
      .optional()
      .describe(
        "Select parent context facts that require external/customer evidence using stable requirement ID, field and zero-based index. The server renders unresolvedConditions from these facts; no independently paraphrased actor, trigger, qualifier or exception.",
      ),
    // Derived output is bounded by its parent fields, not a second lossy text cap.
    applicabilityGuidance: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Canonical rendering of linked LegalRequirement actor/action/condition/qualifier/exception bindings; never independently paraphrased. Evidence strategy belongs in investigationGoals and evidence fields.",
      ),
    criteria: z
      .array(assessmentRuleCriterionSchema)
      .min(1)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems),
    investigationGoals: derivedTextListSchema,
    startingNodeTypes: shortTextListSchema,
    targetNodeTypes: shortTextListSchema,
    edgeStrategies: shortTextListSchema,
    graphQueries: z
      .array(engineeringGraphQuerySchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems),
    keywords: shortTextListSchema,
    commonApis: shortTextListSchema,
    commonLibraries: shortTextListSchema,
    patterns: shortTextListSchema,
    requiredEvidence: derivedTextListSchema,
    supportingEvidence: derivedTextListSchema,
    negativeEvidence: derivedTextListSchema,
    unresolvedConditions: derivedTextListSchema.describe(
      "Applicability conditions that repository evidence cannot establish, phrased as customer-answerable facts (never as a legal verdict).",
    ),
    sourceRefs: sourceRefListSchema,
  })
  .strict();
export type AssessmentRuleInput = z.infer<typeof assessmentRuleSchema>;

const assessmentRuleAuthoringSchema = assessmentRuleSchema.extend({
  legalIntent: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Omit. Server derives intent from linked parent propositions; supplied contradictions return APPLICABILITY_BINDING_MISMATCH.",
    ),
  unresolvedConditions: derivedTextListSchema
    .optional()
    .describe(
      "Omit. Select unresolvedConditionBindings instead; server renders the exact parent facts. An empty binding list means no separate unresolved facts, not unconditional applicability; complete parent context remains mandatory.",
    ),
  criteria: z
    .array(
      assessmentRuleCriterionSchema.extend({
        statement: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Omit this field. The server derives the complete normative statement from this criterion's legalRequirementIds, retaining purpose/scope restrictions, conditions and exceptions. Supplied text must equal that rendering or returns APPLICABILITY_BINDING_MISMATCH. Put a narrower technical evidence focus in investigationFocus.",
          ),
      }),
    )
    .min(1)
    .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems),
  applicabilityGuidance: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Omit this field. The server derives guidance from all linked legalRequirementIds, preserving their actors, direction, conditions, qualifiers and exceptions. Supplied text must equal that canonical rendering or returns APPLICABILITY_BINDING_MISMATCH; it is never silently replaced.",
    ),
});

/** Relationship meaning between a rule and its context (definition, scope, qualifier, exception, cross-reference). */
export const legalContextRelationSchema = z
  .object({
    relationId: idSchema,
    kind: z.enum(LEGAL_CONTEXT_RELATION_KINDS),
    fromLegalRequirementId: idSchema,
    /** Exactly one of toLegalRequirementId / toSourceRef. */
    toLegalRequirementId: idSchema
      .nullable()
      .describe(
        "Target an independently operative LegalRequirement only. For a context-only provision use toSourceRef and set this field to explicit JSON null; never create a LegalRequirement merely as a relation target.",
      ),
    toSourceRef: complianceRuleSetSourceRefSchema
      .nullable()
      .describe(
        "Exact pinned source reference for a context-only definition, scope, qualifier, exception or cross-reference. Set toLegalRequirementId to explicit JSON null. When targeting an independently operative LegalRequirement, this field is explicit JSON null.",
      ),
  })
  .strict()
  .refine(
    (relation) =>
      (relation.toLegalRequirementId === null) !==
      (relation.toSourceRef === null),
    {
      message: "exactly one of toLegalRequirementId or toSourceRef is required",
    },
  );
export type LegalContextRelationInput = z.infer<
  typeof legalContextRelationSchema
>;

/** Partial authoring state is durable, but each candidate retains the packet's typed contract. */
export const ruleSetPreparationAuthoringDraftSchema = z
  .strictObject({
    legalRequirements: z.record(idSchema, legalRequirementSchema),
    assessmentRules: z.record(idSchema, assessmentRuleAuthoringSchema),
    contextRelations: z.record(idSchema, legalContextRelationSchema),
  })
  .superRefine((draft, context) => {
    for (const [section, rows, idField] of [
      ["legalRequirements", draft.legalRequirements, "legalRequirementId"],
      ["assessmentRules", draft.assessmentRules, "assessmentRuleId"],
      ["contextRelations", draft.contextRelations, "relationId"],
    ] as const)
      for (const [id, row] of Object.entries(rows))
        if ((row as Record<string, unknown>)[idField] !== id)
          context.addIssue({
            code: "custom",
            path: [section, id, idField],
            message: "Candidate identity must equal its draft key",
          });
  });

export const complianceRuleSetPacketSchema = z
  .object({
    semanticGraph: legalSemanticGraphSchema.optional(),
    claimInventory: claimInventoryBindingSchema.optional(),
    legalRequirements: z
      .array(legalRequirementSchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxLegalRequirements)
      .describe(
        "Operative duties, prohibitions or permissions only. Context-only definitions, scope, exceptions and interpretive cross-references belong in contextRelations with toSourceRef, not standalone LegalRequirements. Source coverage does not require a LegalRequirement for every provision.",
      ),
    assessmentRules: z
      .array(assessmentRuleAuthoringSchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxAssessmentRules),
    contextRelations: z
      .array(legalContextRelationSchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxContextRelations),
  })
  .strict()
  .superRefine((packet, context) => {
    const { COVERED_BY_ASSESSMENT_RULES, NON_ASSESSABLE } =
      LEGAL_REQUIREMENT_COVERAGE_STATES;
    const legalRequirements = new Map(
      packet.legalRequirements.map((rule) => [rule.legalRequirementId, rule]),
    );
    const coveredIds = new Set<string>();
    packet.assessmentRules.forEach((rule, ruleIndex) => {
      rule.legalRequirementIds.forEach((legalRequirementId, referenceIndex) => {
        coveredIds.add(legalRequirementId);
        if (
          legalRequirements.get(legalRequirementId)?.coverage.state ===
          NON_ASSESSABLE
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "assessmentRules",
              ruleIndex,
              "legalRequirementIds",
              referenceIndex,
            ],
            message:
              "Referenced LegalRequirement declares NON_ASSESSABLE, remove this AssessmentRule coverage or correct the LegalRequirement coverage declaration",
          });
        }
      });
    });
    packet.legalRequirements.forEach((rule, ruleIndex) => {
      if (
        rule.coverage.state === COVERED_BY_ASSESSMENT_RULES &&
        !coveredIds.has(rule.legalRequirementId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["legalRequirements", ruleIndex, "coverage", "state"],
          message:
            "COVERED_BY_ASSESSMENT_RULES requires at least one AssessmentRule legalRequirementIds reference to this LegalRequirement",
        });
      }
    });
  })
  .transform(
    (
      packet,
    ): {
      legalRequirements: LegalRequirementInput[];
      assessmentRules: AssessmentRuleInput[];
      contextRelations: LegalContextRelationInput[];
      semanticGraph?: LegalSemanticGraph;
      claimInventory?: ClaimInventoryBinding;
    } => ({
      ...packet,
      assessmentRules: packet.assessmentRules.map((rule) => ({
        ...rule,
        legalIntent:
          rule.legalIntent ??
          deriveAssessmentLegalIntent(
            packet.legalRequirements.filter((parent) =>
              rule.legalRequirementIds.includes(parent.legalRequirementId),
            ),
          ),
        contextRelationIds:
          rule.contextRelationIds ??
          assessmentSemanticContext(
            packet.legalRequirements.filter((parent) =>
              rule.legalRequirementIds.includes(parent.legalRequirementId),
            ),
            packet.contextRelations,
            packet.legalRequirements,
          ).relations.map((edge) => edge.relationId),
        unresolvedConditions:
          rule.unresolvedConditions ??
          (rule.unresolvedConditionBindings ?? []).flatMap((binding) => {
            const context = assessmentSemanticContext(
              packet.legalRequirements.filter((parent) =>
                rule.legalRequirementIds.includes(parent.legalRequirementId),
              ),
              packet.contextRelations,
              packet.legalRequirements,
            );
            const value = resolveAssessmentContextBinding(
              binding,
              context.requirements,
            );
            return value === null ? [] : [value];
          }),
        criteria: rule.criteria.map((criterion) => ({
          ...criterion,
          statement:
            criterion.statement ??
            deriveAssessmentApplicabilityGuidance(
              (criterion.legalRequirementIds ?? []).flatMap((id) => {
                const parent = packet.legalRequirements.find(
                  (item) => item.legalRequirementId === id,
                );
                return parent ? [parent] : [];
              }),
              packet.contextRelations,
              packet.legalRequirements,
              packet.semanticGraph,
            ),
        })),
        applicabilityGuidance:
          rule.applicabilityGuidance ??
          deriveAssessmentApplicabilityGuidance(
            rule.legalRequirementIds.flatMap((id) => {
              const parent = packet.legalRequirements.find(
                (item) => item.legalRequirementId === id,
              );
              return parent ? [parent] : [];
            }),
            packet.contextRelations,
            packet.legalRequirements,
            packet.semanticGraph,
          ),
      })),
    }),
  )
  .transform((packet) => ({
    ...packet,
    assessmentRules: packet.assessmentRules.map((rule) => {
      if (!packet.semanticGraph) return rule;
      return {
        ...rule,
        semanticAuthority:
          rule.semanticAuthority ??
          DOWNSTREAM_SEMANTIC_AUTHORITIES.CLAIM_DERIVED,
        requiredEvidence: rule.requiredEvidence.length
          ? rule.requiredEvidence
          : deriveEvidenceRequests(
              rule.criteria,
              rule.evidenceBindings ?? [],
              LEGAL_EVIDENCE_REQUEST_KINDS.REQUIRED,
            ),
        supportingEvidence: rule.supportingEvidence.length
          ? rule.supportingEvidence
          : deriveEvidenceRequests(
              rule.criteria,
              rule.evidenceBindings ?? [],
              LEGAL_EVIDENCE_REQUEST_KINDS.SUPPORTING,
            ),
        negativeEvidence: rule.negativeEvidence.length
          ? rule.negativeEvidence
          : deriveEvidenceRequests(
              rule.criteria,
              rule.evidenceBindings ?? [],
              LEGAL_EVIDENCE_REQUEST_KINDS.NEGATIVE,
            ),
        investigationGoals: rule.investigationGoals.length
          ? rule.investigationGoals
          : rule.criteria.map((c) => c.statement),
      };
    }),
  }));
export type ComplianceRuleSetPacket = z.infer<
  typeof complianceRuleSetPacketSchema
>;

/**
 * Internal command input that starts one Rule Set Preparation run for one Legal Source Version.
 * It is never an HTTP body: activation, Admin preparation and retry derive this input on the server.
 */
export const ruleSetPreparationStartRequestSchema = z
  .object({
    legalSourceVersionId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();
export type RuleSetPreparationStartRequest = z.infer<
  typeof ruleSetPreparationStartRequestSchema
>;

export const ruleSetPreparationRunSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    legalSourceVersionId: z.string().uuid(),
    executionState: agentExecutionStateSchema,
    ruleSetVersionId: z.string().uuid().nullable(),
  })
  .strict();
export type RuleSetPreparationRun = z.infer<typeof ruleSetPreparationRunSchema>;

/**
 * Admin supplies no source, idempotency key or generated rule-set content. `replaceActive` is the
 * explicit intent to author a NEW version that supersedes the ACTIVE one once it validates and is
 * submitted; without it Prepare keeps refusing while a rule set is ACTIVE, so a stale click or a
 * racing request can never start paid work by accident. Retry of a failed run is a different
 * operation and never needs it.
 */
export const ruleSetPreparationAdminRequestSchema = z
  .strictObject({
    replaceActive: z.boolean().optional(),
    /**
     * The Legal Source Version the operator is looking at. Preparation always targets the active
     * version; naming it makes the request refuse (instead of silently preparing another version)
     * when the active version changed in the meantime.
     */
    legalSourceVersionId: z.uuid().optional(),
  })
  .default({});
export type RuleSetPreparationAdminRequest = z.infer<
  typeof ruleSetPreparationAdminRequestSchema
>;

export const ruleSetPreparationAvailabilitySchema = z.strictObject({
  legalSourceVersionId: z.uuid().nullable(),
  legalSourceVersion: z.string().min(1).nullable(),
  /** The ACTIVE rule set of the current source, which stays ACTIVE until a replacement activates. */
  activeRuleSetVersionId: z.uuid().nullable(),
  /** A first preparation may start: no ACTIVE rule set and nothing in progress. */
  canStart: z.boolean(),
  /** An explicit replacement may start: an ACTIVE rule set exists and nothing is in progress. */
  canReplace: z.boolean(),
  refusalReason: z.enum(RULE_SET_PREPARATION_REFUSAL_REASONS).nullable(),
  currentRun: ruleSetPreparationRunSchema.nullable(),
});
export type RuleSetPreparationAvailability = z.infer<
  typeof ruleSetPreparationAvailabilitySchema
>;

/**
 * One complete packet for one run. LegalSource identity, idempotency and digests are
 * server context; the agent supplies meaning only.
 */
export const complianceRuleSetSubmitRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(128),
    packet: complianceRuleSetPacketSchema,
  })
  .strict();
export type ComplianceRuleSetSubmitRequest = z.infer<
  typeof complianceRuleSetSubmitRequestSchema
>;

export const complianceRuleSetValidationFailureSchema = z
  .object({
    code: z.enum(COMPLIANCE_RULE_SET_FAILURE_CODES),
    /** Packet-local reference (rule/relation/locator id) the failure concerns. */
    ref: z
      .string()
      .max(COMPLIANCE_RULE_SET_LIMITS.maxShortTextLength)
      .nullable(),
    detail: z
      .string()
      .max(COMPLIANCE_RULE_SET_LIMITS.maxShortTextLength)
      .nullable(),
  })
  .strict();
export type ComplianceRuleSetValidationFailure = z.infer<
  typeof complianceRuleSetValidationFailureSchema
>;

export const complianceRuleSetSubmitResultSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    ruleSetVersionId: z.string().uuid(),
    version: z.string().min(1),
    lifecycleState: artifactLifecycleStateSchema,
    validation: z
      .object({
        outcome: z.enum(COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES),
        failures: z.array(complianceRuleSetValidationFailureSchema),
      })
      .strict(),
    activationRecordId: z.string().uuid(),
    previousActiveRuleSetVersionId: z.string().uuid().nullable(),
    replayed: z.boolean(),
  })
  .strict();
export type ComplianceRuleSetSubmitResult = z.infer<
  typeof complianceRuleSetSubmitResultSchema
>;

/** Server-resolved source binding exposed to the runtime reader. */
export const complianceRuleSetResolvedSourceSchema = z
  .object({
    chunkId: z.string().min(1),
    documentId: idSchema,
    locator: shortTextSchema,
    contentSha256: contentHashSchema,
    sourceEffectStatus: z.string().min(1),
    legalEffectStatus: z.enum(
      Object.values(LEGAL_SOURCE_CHUNK_STATUSES) as [
        LegalSourceChunkStatus,
        ...LegalSourceChunkStatus[],
      ],
    ),
    legalStatusSourceRef: z.string().nullable(),
  })
  .strict();

/** The single runtime reader contract: the explicit ACTIVE rule set. */
export const complianceRuleSetReadModelSchema = z
  .object({
    claimInventory: claimInventoryBindingSchema.optional(),
    semanticGraph: legalSemanticGraphSchema.optional(),
    ruleSetVersionId: z.string().uuid(),
    version: z.string().min(1),
    legalSourceVersionId: z.string().uuid(),
    ruleSetDigest: sha256Schema,
    lifecycleState: artifactLifecycleStateSchema,
    activatedAt: z.string().nullable(),
    legalRequirements: z.array(
      legalRequirementSchema
        .omit({ sourceRefs: true })
        .extend({ sources: z.array(complianceRuleSetResolvedSourceSchema) }),
    ),
    assessmentRules: z.array(
      assessmentRuleSchema.omit({ sourceRefs: true }).extend({
        assessmentRuleVersion: z.string().min(1),
        sourceFingerprint: sha256Schema,
        sources: z.array(complianceRuleSetResolvedSourceSchema),
      }),
    ),
    contextRelations: z.array(legalContextRelationSchema),
  })
  .strict();
export type ComplianceRuleSetReadModel = z.infer<
  typeof complianceRuleSetReadModelSchema
>;

/** Same mechanical validation as submit; records phase readiness without publishing authority. */
export const complianceRuleSetValidateRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    packet: complianceRuleSetPacketSchema,
  })
  .strict();
export type ComplianceRuleSetValidateRequest = z.infer<
  typeof complianceRuleSetValidateRequestSchema
>;

export const complianceRuleSetValidateResultSchema = z
  .object({
    outcome: z.enum(COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES),
    failures: z.array(complianceRuleSetValidationFailureSchema),
    coverage: z
      .strictObject({
        retrieval: z.strictObject({
          total: z.number().int(),
          cited: z.number().int(),
          derivedUnits: z.number().int(),
        }),
        structuralSource: z.strictObject({
          total: z.number().int(),
          accounted: z.number().int(),
        }),
        semanticClaims: z.strictObject({
          relevant: z.number().int(),
          accounted: z.number().int(),
          unaccounted: z.number().int(),
        }),
      })
      .optional(),
  })
  .strict();
export type ComplianceRuleSetValidateResult = z.infer<
  typeof complianceRuleSetValidateResultSchema
>;

export const ruleSetPreparationClaimRequestSchema = z
  .object({ preparationRunId: z.string().uuid(), supportedExecutionContracts: z.array(z.enum(PREPARATION_EXECUTION_CONTRACTS)).min(1).optional() })
  .strict();
export type RuleSetPreparationClaimRequest = z.infer<
  typeof ruleSetPreparationClaimRequestSchema
>;

/**
 * The one pinned immutable legalSource a Rule Set Preparation run is allowed to read.
 * Server-derived from the run; the agent never chooses a legalSource.
 */
export const ruleSetPreparationLegalSourceBundleSchema = z
  .object({
    documentGraph: legalDocumentGraphSchema,
    executionContract: z.enum(PREPARATION_EXECUTION_CONTRACTS).default(PREPARATION_EXECUTION_CONTRACTS.CLAIM_INVENTORY_V1),
    targetDate: z.string().date().optional(),
    preparationRunId: z.string().uuid(),
    executionState: agentExecutionStateSchema,
    claimInventoryRevision: z.number().int().positive(),
    claimPhase: z.enum(CLAIM_PREPARATION_PHASES),
    frozenInventory: z
      .strictObject({
        revision: z.number().int().positive(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        graph: legalSemanticGraphSchema,
        identities: z.record(z.string(), z.string()),
      })
      .nullable(),
    legalSourceVersionId: z.string().uuid(),
    legalSourceVersion: z.string().min(1),
    documents: z.array(
      z
        .object({
          documentId: idSchema,
          title: z.string(),
          sourceUrl: z.string(),
          sourceSha256: z.string(),
          sourceEffectStatus: z.string(),
          corpusRole: z
            .enum(LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES)
            .default(LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.OPERATIVE),
          chunks: z.array(
            z
              .object({
                chunkId: z.string().min(1),
                locator: z.string().min(1),
                content: z.string(),
                contentSha256: contentHashSchema,
                legalStatus: z.string(),
                legalEffectStatus: z.enum(
                  Object.values(LEGAL_SOURCE_CHUNK_STATUSES) as [
                    LegalSourceChunkStatus,
                    ...LegalSourceChunkStatus[],
                  ],
                ),
                legalStatusSourceRef: z.string().nullable(),
                hierarchy: z.unknown(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type RuleSetPreparationLegalSourceBundle = z.infer<
  typeof ruleSetPreparationLegalSourceBundleSchema
>;

/**
 * Marks a run FAILED when the agent could not produce a submission. NO_OPERATIVE_OBLIGATIONS is not reportable here:
 * only the validated claim-inventory conclusion may record it.
 */
export const ruleSetPreparationFailRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    reason: z
      .enum(RULE_SET_PREPARATION_FAILURE_REASONS)
      .exclude([RULE_SET_PREPARATION_FAILURE_REASONS.NO_OPERATIVE_OBLIGATIONS]),
  })
  .strict();
export type RuleSetPreparationFailRequest = z.infer<
  typeof ruleSetPreparationFailRequestSchema
>;

/**
 * Operations view of the shared Compliance Rule Sets: the current ACTIVE version, its history and
 * preparations, and server-resolved eligibility for an explicit Admin start. No publish/approve
 * authority is exposed: preparation and retry both use the canonical command workflow.
 */
export const complianceRuleSetHistorySchema = z.strictObject({
  preparation: ruleSetPreparationAvailabilitySchema,
  ruleSets: z.array(
    complianceRuleSetReadModelSchema
      .pick({
        ruleSetVersionId: true,
        version: true,
        legalSourceVersionId: true,
        ruleSetDigest: true,
        lifecycleState: true,
        activatedAt: true,
      })
      .extend({
        legalSourceVersion: z.string().min(1),
        createdAt: z.iso.datetime(),
        supersededAt: z.iso.datetime().nullable(),
        legalRequirementCount: z.number().int().nonnegative(),
        assessmentRuleCount: z.number().int().nonnegative(),
      }),
  ),
  preparations: z.array(
    ruleSetPreparationRunSchema.extend({
      executionContract: z.enum(PREPARATION_EXECUTION_CONTRACTS).optional(),
      resumable: z.boolean().optional(),
      draft: z.strictObject({
        stage: z.enum(RULE_SET_PREPARATION_STAGES),
        sourceDocuments: z.array(z.strictObject({ documentId: z.string(), title: z.string() })),
        coverage: z.strictObject({ total: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), blocked: z.number().int().nonnegative() }),
        requirementCount: z.number().int().nonnegative(),
        assessmentRuleCount: z.number().int().nonnegative(),
        requirements: z.array(z.strictObject({ legalRequirementId: idSchema, title: z.string() })).max(20),
        assessmentRules: z.array(z.strictObject({ assessmentRuleId: idSchema, concept: z.string() })).max(20),
        validation: complianceRuleSetValidateResultSchema.nullable(),
        assessmentsCanUseRuleSet: z.boolean(),
        unresolvedReferences: z.array(z.strictObject({ referenceId: sha256Schema, sourceNodeId: sha256Schema, reason: z.string().nullable() })).max(20),
      }).optional(),
      legalSourceVersion: z.string().min(1),
      createdAt: z.iso.datetime(),
      completedAt: z.iso.datetime().nullable(),
      failureReason: z.enum(RULE_SET_PREPARATION_FAILURE_REASONS).nullable(),
      attempt: z.number().int().positive(),
      requestedBy: z.string().min(1),
      retryable: z.boolean(),
    }),
  ),
});
export type ComplianceRuleSetHistory = z.infer<
  typeof complianceRuleSetHistorySchema
>;

/**
 * Admin "View result": the stored rule set version exactly as persisted (requirements, assessment
 * rules, context relations, source provenance) plus where it came from. A read-only projection of
 * the canonical rows; it is never a second copy of rule-set state.
 */
export const complianceRuleSetResultSchema = z.strictObject({
  ruleSet: complianceRuleSetReadModelSchema,
  preparationRunId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  supersededAt: z.iso.datetime().nullable(),
  legalSourceVersion: z.strictObject({
    legalSourceVersionId: z.uuid(),
    version: z.string().min(1),
    documents: z.array(
      z.strictObject({
        documentId: z.string().min(1),
        title: z.string(),
        sourceEffectStatus: z.string(),
        chunkCount: z.number().int().nonnegative(),
      }),
    ),
  }),
});
export type ComplianceRuleSetResult = z.infer<
  typeof complianceRuleSetResultSchema
>;

import { z } from "zod";

import {
  agentExecutionStateSchema,
  artifactLifecycleStateSchema,
} from "../assessment/agentic-runtime.ts";
import {
  ENGINEERING_GRAPH_QUERY_DIRECTIONS,
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  COMPLIANCE_RULE_SET_LIMITS,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  RULE_SET_PREPARATION_FAILURE_REASONS,
} from "./constants.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** Source content hashes use the corpus representation: `sha256:<64 hex>`. */
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
/** Raw hex digest computed by the server (rule set digest, source fingerprint). */
const sha256Schema = z.string().regex(SHA256_PATTERN);
/** Source content hash exactly as stored on the pinned corpus chunk. */
const contentHashSchema = z.string().regex(CONTENT_HASH_PATTERN);

/**
 * Opaque source claim authored by the agent. The server resolves it against
 * the one pinned corpus and derives the trusted chunk/hash binding; a claim is
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
  .min(1)
  .max(COMPLIANCE_RULE_SET_LIMITS.maxSourceRefsPerRule);

/**
 * Structural invariant shared with the database CHECK LegalPortfolioRule_coverage_reason_check:
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
    title: shortTextSchema,
    proposition: textSchema,
    applicabilityConditions: shortTextListSchema,
    qualifiers: shortTextListSchema,
    exceptions: shortTextListSchema,
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
    statement: textSchema,
  })
  .strict();

/** Agent-authored assessable contract for one or more legal propositions. */
export const assessmentRuleSchema = z
  .object({
    assessmentRuleId: idSchema,
    /** Every AssessmentRule belongs to at least one submitted LegalRequirement. */
    legalRequirementIds: z
      .array(idSchema)
      .min(1)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems)
      .describe(
        "LegalRequirement IDs covered by this AssessmentRule; never reference a LegalRequirement declared NON_ASSESSABLE.",
      ),
    concept: shortTextSchema,
    legalIntent: textSchema,
    applicabilityGuidance: textSchema,
    criteria: z
      .array(assessmentRuleCriterionSchema)
      .min(1)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems),
    investigationGoals: shortTextListSchema,
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
    requiredEvidence: shortTextListSchema,
    supportingEvidence: shortTextListSchema,
    negativeEvidence: shortTextListSchema,
    unresolvedConditions: shortTextListSchema,
    sourceRefs: sourceRefListSchema,
  })
  .strict();
export type AssessmentRuleInput = z.infer<typeof assessmentRuleSchema>;

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
      (relation.toLegalRequirementId === null) !== (relation.toSourceRef === null),
    {
      message: "exactly one of toLegalRequirementId or toSourceRef is required",
    },
  );
export type LegalContextRelationInput = z.infer<
  typeof legalContextRelationSchema
>;

export const complianceRuleSetPacketSchema = z
  .object({
    legalRequirements: z
      .array(legalRequirementSchema)
      .max(COMPLIANCE_RULE_SET_LIMITS.maxLegalRequirements)
      .describe(
        "Operative duties, prohibitions or permissions only. Context-only definitions, scope, exceptions and interpretive cross-references belong in contextRelations with toSourceRef, not standalone LegalRequirements. Source coverage does not require a LegalRequirement for every provision.",
      ),
    assessmentRules: z
      .array(assessmentRuleSchema)
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
        if (legalRequirements.get(legalRequirementId)?.coverage.state === NON_ASSESSABLE) {
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
  });
export type ComplianceRuleSetPacket = z.infer<typeof complianceRuleSetPacketSchema>;

/**
 * Internal command input that starts one Rule Set Preparation run for one Legal Source Version.
 * It is never an HTTP body: the only callers are the Legal Source activation consumer and the
 * operator retry of a failed run, and the key derives from the authoritative source identity.
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
 * One complete packet for one run. Corpus identity, idempotency and digests are
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
    ref: z.string().max(COMPLIANCE_RULE_SET_LIMITS.maxShortTextLength).nullable(),
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
  })
  .strict();

/** The single runtime reader contract: the explicit ACTIVE rule set. */
export const complianceRuleSetReadModelSchema = z
  .object({
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

/** Dry-run: same mechanical validation as submit, nothing is persisted. */
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
  })
  .strict();
export type ComplianceRuleSetValidateResult = z.infer<
  typeof complianceRuleSetValidateResultSchema
>;

export const ruleSetPreparationClaimRequestSchema = z
  .object({ preparationRunId: z.string().uuid() })
  .strict();
export type RuleSetPreparationClaimRequest = z.infer<
  typeof ruleSetPreparationClaimRequestSchema
>;

/**
 * The one pinned immutable corpus a Rule Set Preparation run is allowed to read.
 * Server-derived from the run; the agent never chooses a corpus.
 */
export const ruleSetPreparationCorpusBundleSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    executionState: agentExecutionStateSchema,
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
          chunks: z.array(
            z
              .object({
                chunkId: z.string().min(1),
                locator: z.string().min(1),
                content: z.string(),
                contentSha256: contentHashSchema,
                legalStatus: z.string(),
                hierarchy: z.unknown(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type RuleSetPreparationCorpusBundle = z.infer<
  typeof ruleSetPreparationCorpusBundleSchema
>;

/** Marks a run FAILED when the agent could not produce a submission. */
export const ruleSetPreparationFailRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    reason: z.enum(RULE_SET_PREPARATION_FAILURE_REASONS),
  })
  .strict();
export type RuleSetPreparationFailRequest = z.infer<
  typeof ruleSetPreparationFailRequestSchema
>;

/**
 * Operations view of the shared Compliance Rule Sets: the current ACTIVE version, its history and
 * every automatic preparation. It carries no start/publish/approve authority; the only operator
 * action is retrying a failed preparation of the same Legal Source Version.
 */
export const complianceRuleSetHistorySchema = z.strictObject({
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
export type ComplianceRuleSetHistory = z.infer<typeof complianceRuleSetHistorySchema>;

import { z } from "zod";

import {
  agentExecutionStateSchema,
  artifactLifecycleStateSchema,
} from "../assessment/agentic-runtime.ts";
import {
  ENGINEERING_GRAPH_QUERY_DIRECTIONS,
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_PORTFOLIO_COVERAGE_STATES,
  LEGAL_PORTFOLIO_FAILURE_CODES,
  LEGAL_PORTFOLIO_LIMITS,
  LEGAL_PORTFOLIO_VALIDATION_OUTCOMES,
  LEGAL_PREPARATION_FAILURE_REASONS,
} from "./constants.ts";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** Source content hashes use the corpus representation: `sha256:<64 hex>`. */
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const idSchema = z
  .string()
  .min(1)
  .max(LEGAL_PORTFOLIO_LIMITS.maxIdLength)
  .regex(ID_PATTERN);
const shortTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(LEGAL_PORTFOLIO_LIMITS.maxShortTextLength);
const textSchema = z
  .string()
  .trim()
  .min(1)
  .max(LEGAL_PORTFOLIO_LIMITS.maxTextLength);
const shortTextListSchema = z
  .array(shortTextSchema)
  .max(LEGAL_PORTFOLIO_LIMITS.maxListItems);
/** Raw hex digest computed by the server (portfolio digest, source fingerprint). */
const sha256Schema = z.string().regex(SHA256_PATTERN);
/** Source content hash exactly as stored on the pinned corpus chunk. */
const contentHashSchema = z.string().regex(CONTENT_HASH_PATTERN);

/**
 * Opaque source claim authored by the agent. The server resolves it against
 * the one pinned corpus and derives the trusted chunk/hash binding; a claim is
 * never trusted identity.
 */
export const legalPortfolioSourceRefSchema = z
  .object({
    documentId: idSchema,
    locator: shortTextSchema,
    contentSha256: contentHashSchema,
  })
  .strict();
export type LegalPortfolioSourceRef = z.infer<
  typeof legalPortfolioSourceRefSchema
>;

const sourceRefListSchema = z
  .array(legalPortfolioSourceRefSchema)
  .min(1)
  .max(LEGAL_PORTFOLIO_LIMITS.maxSourceRefsPerRule);

/**
 * Structural invariant shared with the database CHECK LegalPortfolioRule_coverage_reason_check:
 * a rule covered by engineering rules carries no reason; a non-assessable rule carries a
 * non-blank one. The refinement checks structure only and never judges the legal meaning.
 */
export const legalPortfolioCoverageSchema = z
  .object({
    state: z
      .enum(LEGAL_PORTFOLIO_COVERAGE_STATES)
      .describe(
        "COVERED_BY_ENGINEERING_RULES requires at least one EngineeringRule legalRuleIds reference; NON_ASSESSABLE requires none. The model decides legal assessability.",
      ),
    nonAssessableReason: z
      .string()
      .trim()
      .max(LEGAL_PORTFOLIO_LIMITS.maxTextLength)
      .nullable()
      .describe(
        "Must be null when state is COVERED_BY_ENGINEERING_RULES; must be a non-blank reason when state is NON_ASSESSABLE.",
      ),
  })
  .strict()
  .superRefine((coverage, context) => {
    const { COVERED_BY_ENGINEERING_RULES, NON_ASSESSABLE } =
      LEGAL_PORTFOLIO_COVERAGE_STATES;
    if (
      coverage.state === COVERED_BY_ENGINEERING_RULES &&
      coverage.nonAssessableReason !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["nonAssessableReason"],
        message: `${COVERED_BY_ENGINEERING_RULES} requires nonAssessableReason to be null`,
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
export const legalPortfolioRuleSchema = z
  .object({
    legalRuleId: idSchema,
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
    coverage: legalPortfolioCoverageSchema,
  })
  .strict();
export type LegalPortfolioRuleInput = z.infer<typeof legalPortfolioRuleSchema>;

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

export const engineeringRuleCriterionSchema = z
  .object({
    criterionId: idSchema,
    statement: textSchema,
  })
  .strict();

/** Agent-authored assessable contract for one or more legal propositions. */
export const engineeringRuleSchema = z
  .object({
    engineeringRuleId: idSchema,
    /** Every EngineeringRule belongs to at least one submitted LegalRule. */
    legalRuleIds: z
      .array(idSchema)
      .min(1)
      .max(LEGAL_PORTFOLIO_LIMITS.maxListItems)
      .describe(
        "LegalRule IDs covered by this EngineeringRule; never reference a LegalRule declared NON_ASSESSABLE.",
      ),
    concept: shortTextSchema,
    legalIntent: textSchema,
    applicabilityGuidance: textSchema,
    criteria: z
      .array(engineeringRuleCriterionSchema)
      .min(1)
      .max(LEGAL_PORTFOLIO_LIMITS.maxListItems),
    investigationGoals: shortTextListSchema,
    startingNodeTypes: shortTextListSchema,
    targetNodeTypes: shortTextListSchema,
    edgeStrategies: shortTextListSchema,
    graphQueries: z
      .array(engineeringGraphQuerySchema)
      .max(LEGAL_PORTFOLIO_LIMITS.maxListItems),
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
export type EngineeringRuleInput = z.infer<typeof engineeringRuleSchema>;

/** Relationship meaning between a rule and its context (definition, scope, qualifier, exception, cross-reference). */
export const legalContextRelationSchema = z
  .object({
    relationId: idSchema,
    kind: z.enum(LEGAL_CONTEXT_RELATION_KINDS),
    fromLegalRuleId: idSchema,
    /** Exactly one of toLegalRuleId / toSourceRef. */
    toLegalRuleId: idSchema
      .nullable()
      .describe(
        "Target an independently operative LegalRule only. For a context-only provision use toSourceRef and set this field to explicit JSON null; never create a LegalRule merely as a relation target.",
      ),
    toSourceRef: legalPortfolioSourceRefSchema
      .nullable()
      .describe(
        "Exact pinned source reference for a context-only definition, scope, qualifier, exception or cross-reference. Set toLegalRuleId to explicit JSON null. When targeting an independently operative LegalRule, this field is explicit JSON null.",
      ),
  })
  .strict()
  .refine(
    (relation) =>
      (relation.toLegalRuleId === null) !== (relation.toSourceRef === null),
    {
      message: "exactly one of toLegalRuleId or toSourceRef is required",
    },
  );
export type LegalContextRelationInput = z.infer<
  typeof legalContextRelationSchema
>;

export const legalPortfolioPacketSchema = z
  .object({
    legalRules: z
      .array(legalPortfolioRuleSchema)
      .max(LEGAL_PORTFOLIO_LIMITS.maxLegalRules)
      .describe(
        "Operative duties, prohibitions or permissions only. Context-only definitions, scope, exceptions and interpretive cross-references belong in contextRelations with toSourceRef, not standalone LegalRules. Source coverage does not require a LegalRule for every provision.",
      ),
    engineeringRules: z
      .array(engineeringRuleSchema)
      .max(LEGAL_PORTFOLIO_LIMITS.maxEngineeringRules),
    contextRelations: z
      .array(legalContextRelationSchema)
      .max(LEGAL_PORTFOLIO_LIMITS.maxContextRelations),
  })
  .strict()
  .superRefine((packet, context) => {
    const { COVERED_BY_ENGINEERING_RULES, NON_ASSESSABLE } =
      LEGAL_PORTFOLIO_COVERAGE_STATES;
    const legalRules = new Map(
      packet.legalRules.map((rule) => [rule.legalRuleId, rule]),
    );
    const coveredIds = new Set<string>();
    packet.engineeringRules.forEach((rule, ruleIndex) => {
      rule.legalRuleIds.forEach((legalRuleId, referenceIndex) => {
        coveredIds.add(legalRuleId);
        if (legalRules.get(legalRuleId)?.coverage.state === NON_ASSESSABLE) {
          context.addIssue({
            code: "custom",
            path: [
              "engineeringRules",
              ruleIndex,
              "legalRuleIds",
              referenceIndex,
            ],
            message:
              "Referenced LegalRule declares NON_ASSESSABLE, remove this EngineeringRule coverage or correct the LegalRule coverage declaration",
          });
        }
      });
    });
    packet.legalRules.forEach((rule, ruleIndex) => {
      if (
        rule.coverage.state === COVERED_BY_ENGINEERING_RULES &&
        !coveredIds.has(rule.legalRuleId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["legalRules", ruleIndex, "coverage", "state"],
          message:
            "COVERED_BY_ENGINEERING_RULES requires at least one EngineeringRule legalRuleIds reference to this LegalRule",
        });
      }
    });
  });
export type LegalPortfolioPacket = z.infer<typeof legalPortfolioPacketSchema>;

/** Idempotent request that starts one Legal Preparation run for one pinned corpus. */
export const legalPreparationStartRequestSchema = z
  .object({
    legalCorpusVersionId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();
export type LegalPreparationStartRequest = z.infer<
  typeof legalPreparationStartRequestSchema
>;

export const legalPreparationRunSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    legalCorpusVersionId: z.string().uuid(),
    executionState: agentExecutionStateSchema,
    portfolioVersionId: z.string().uuid().nullable(),
  })
  .strict();
export type LegalPreparationRun = z.infer<typeof legalPreparationRunSchema>;

/**
 * One complete packet for one run. Corpus identity, idempotency and digests are
 * server context; the agent supplies meaning only.
 */
export const legalPortfolioSubmitRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(128),
    packet: legalPortfolioPacketSchema,
  })
  .strict();
export type LegalPortfolioSubmitRequest = z.infer<
  typeof legalPortfolioSubmitRequestSchema
>;

export const legalPortfolioValidationFailureSchema = z
  .object({
    code: z.enum(LEGAL_PORTFOLIO_FAILURE_CODES),
    /** Packet-local reference (rule/relation/locator id) the failure concerns. */
    ref: z.string().max(LEGAL_PORTFOLIO_LIMITS.maxShortTextLength).nullable(),
    detail: z
      .string()
      .max(LEGAL_PORTFOLIO_LIMITS.maxShortTextLength)
      .nullable(),
  })
  .strict();
export type LegalPortfolioValidationFailure = z.infer<
  typeof legalPortfolioValidationFailureSchema
>;

export const legalPortfolioSubmitResultSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    portfolioVersionId: z.string().uuid(),
    version: z.string().min(1),
    lifecycleState: artifactLifecycleStateSchema,
    validation: z
      .object({
        outcome: z.enum(LEGAL_PORTFOLIO_VALIDATION_OUTCOMES),
        failures: z.array(legalPortfolioValidationFailureSchema),
      })
      .strict(),
    activationRecordId: z.string().uuid(),
    previousActivePortfolioVersionId: z.string().uuid().nullable(),
    replayed: z.boolean(),
  })
  .strict();
export type LegalPortfolioSubmitResult = z.infer<
  typeof legalPortfolioSubmitResultSchema
>;

/** Server-resolved source binding exposed to the runtime reader. */
export const legalPortfolioResolvedSourceSchema = z
  .object({
    chunkId: z.string().min(1),
    documentId: idSchema,
    locator: shortTextSchema,
    contentSha256: contentHashSchema,
    sourceEffectStatus: z.string().min(1),
  })
  .strict();

/** The single runtime reader contract: the explicit ACTIVE portfolio. */
export const legalPortfolioReadModelSchema = z
  .object({
    portfolioVersionId: z.string().uuid(),
    version: z.string().min(1),
    legalCorpusVersionId: z.string().uuid(),
    portfolioDigest: sha256Schema,
    lifecycleState: artifactLifecycleStateSchema,
    activatedAt: z.string().nullable(),
    legalRules: z.array(
      legalPortfolioRuleSchema
        .omit({ sourceRefs: true })
        .extend({ sources: z.array(legalPortfolioResolvedSourceSchema) }),
    ),
    engineeringRules: z.array(
      engineeringRuleSchema.omit({ sourceRefs: true }).extend({
        engineeringRuleVersion: z.string().min(1),
        sourceFingerprint: sha256Schema,
        sources: z.array(legalPortfolioResolvedSourceSchema),
      }),
    ),
    contextRelations: z.array(legalContextRelationSchema),
  })
  .strict();
export type LegalPortfolioReadModel = z.infer<
  typeof legalPortfolioReadModelSchema
>;

/** Dry-run: same mechanical validation as submit, nothing is persisted. */
export const legalPortfolioValidateRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    packet: legalPortfolioPacketSchema,
  })
  .strict();
export type LegalPortfolioValidateRequest = z.infer<
  typeof legalPortfolioValidateRequestSchema
>;

export const legalPortfolioValidateResultSchema = z
  .object({
    outcome: z.enum(LEGAL_PORTFOLIO_VALIDATION_OUTCOMES),
    failures: z.array(legalPortfolioValidationFailureSchema),
  })
  .strict();
export type LegalPortfolioValidateResult = z.infer<
  typeof legalPortfolioValidateResultSchema
>;

export const legalPreparationClaimRequestSchema = z
  .object({ preparationRunId: z.string().uuid() })
  .strict();
export type LegalPreparationClaimRequest = z.infer<
  typeof legalPreparationClaimRequestSchema
>;

/**
 * The one pinned immutable corpus a Legal Preparation run is allowed to read.
 * Server-derived from the run; the agent never chooses a corpus.
 */
export const legalPreparationCorpusBundleSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    executionState: agentExecutionStateSchema,
    legalCorpusVersionId: z.string().uuid(),
    corpusVersion: z.string().min(1),
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
export type LegalPreparationCorpusBundle = z.infer<
  typeof legalPreparationCorpusBundleSchema
>;

/** Marks a run FAILED when the agent could not produce a submission. */
export const legalPreparationFailRequestSchema = z
  .object({
    preparationRunId: z.string().uuid(),
    reason: z.enum(LEGAL_PREPARATION_FAILURE_REASONS),
  })
  .strict();
export type LegalPreparationFailRequest = z.infer<
  typeof legalPreparationFailRequestSchema
>;

/** Admin history of automatic activation. No publish/discard or approval authority. */
export const legalPortfolioHistorySchema = z.strictObject({
  portfolios: z.array(
    legalPortfolioReadModelSchema
      .pick({
        portfolioVersionId: true,
        version: true,
        legalCorpusVersionId: true,
        lifecycleState: true,
        activatedAt: true,
      })
      .extend({
        createdAt: z.iso.datetime(),
        legalRuleCount: z.number().int().nonnegative(),
        engineeringRuleCount: z.number().int().nonnegative(),
      }),
  ),
  preparations: z.array(
    legalPreparationRunSchema.extend({ createdAt: z.iso.datetime() }),
  ),
  corpora: z.array(
    z.strictObject({
      legalCorpusVersionId: z.uuid(),
      version: z.string().min(1),
    }),
  ),
});
export type LegalPortfolioHistory = z.infer<typeof legalPortfolioHistorySchema>;

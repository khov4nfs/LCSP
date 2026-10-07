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

export const legalPortfolioCoverageSchema = z
  .object({
    state: z.enum(LEGAL_PORTFOLIO_COVERAGE_STATES),
    /** Required when state is NON_ASSESSABLE (agent-declared, server-checked for presence only). */
    nonAssessableReason: textSchema.nullable(),
  })
  .strict();

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
    nonRepositoryDuty: z.boolean(),
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
      .max(LEGAL_PORTFOLIO_LIMITS.maxListItems),
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
    toLegalRuleId: idSchema.nullable(),
    toSourceRef: legalPortfolioSourceRefSchema.nullable(),
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
      .max(LEGAL_PORTFOLIO_LIMITS.maxLegalRules),
    engineeringRules: z
      .array(engineeringRuleSchema)
      .max(LEGAL_PORTFOLIO_LIMITS.maxEngineeringRules),
    contextRelations: z
      .array(legalContextRelationSchema)
      .max(LEGAL_PORTFOLIO_LIMITS.maxContextRelations),
  })
  .strict();
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

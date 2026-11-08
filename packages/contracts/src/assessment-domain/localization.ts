import { z } from "zod";
import { LOCALES } from "../shared/locale.ts";

export const AUTHORED_SOURCE_LANGUAGES = {
  EN: "EN",
  VI: "VI",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
} as const;
export const AUTHORED_LANGUAGE_REVIEW_CODES = {
  SOURCE_REQUIRED: "AUTHORED_SOURCE_LANGUAGE_REVIEW_REQUIRED",
  OUTPUT_REQUIRED: "AUTHORED_OUTPUT_LANGUAGE_REVIEW_REQUIRED",
} as const;
export const authoredSourceReviewSchema = z.strictObject({
  originSha256: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalRevision: z.string().min(1),
  sourceLanguage: z.enum(AUTHORED_SOURCE_LANGUAGES),
  evidence: z.string().trim().min(10).max(4000),
});
export const authoredOutputReviewSchema = z.strictObject({
  originSha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  confirmsTargetLanguageAndMeaning: z.literal(true),
  evidence: z.string().trim().min(10).max(4000),
  normalizedContent: z.string().min(1).max(200000).optional(),
});

export const AUTHORED_LOCALIZATION_STATES = {
  PENDING: "PENDING",
  READY: "READY",
  FAILED: "FAILED",
} as const;
export const AUTHORED_LOCALIZATION_OPERATIONAL_STATES = {
  UNKNOWN_SOURCE: "UNKNOWN_SOURCE",
  MIXED_SOURCE: "MIXED_SOURCE",
  SOURCE_REVIEW_REQUIRED: "SOURCE_REVIEW_REQUIRED",
  PROVIDER_PENDING: "PROVIDER_PENDING",
  PROVIDER_FAILED: "PROVIDER_FAILED",
  OUTPUT_REVIEW_REQUIRED: "OUTPUT_REVIEW_REQUIRED",
  READY: "READY",
  FAILED: "FAILED",
} as const;
export type AuthoredLocalizationOperationalState =
  (typeof AUTHORED_LOCALIZATION_OPERATIONAL_STATES)[keyof typeof AUTHORED_LOCALIZATION_OPERATIONAL_STATES];
export const AUTHORED_LOCALIZATION_READINESS_STATES = {
  READY: "READY",
  PENDING: "PENDING",
  FAILED: "FAILED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
} as const;
export type AuthoredLocalizationReadinessState =
  (typeof AUTHORED_LOCALIZATION_READINESS_STATES)[keyof typeof AUTHORED_LOCALIZATION_READINESS_STATES];
export const AUTHORED_CANDIDATE_ACTIONS = {
  REJECT: "REJECT",
  RETRY: "RETRY",
} as const;
export type AuthoredCandidateActionKind =
  (typeof AUTHORED_CANDIDATE_ACTIONS)[keyof typeof AUTHORED_CANDIDATE_ACTIONS];
export const authoredBatchSourceReviewSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        requestId: z.string().min(1),
        originSha256: z.string().regex(/^[a-f0-9]{64}$/),
        canonicalRevision: z.string().min(1),
        sourceLanguage: z.enum(AUTHORED_SOURCE_LANGUAGES),
      }),
    )
    .min(1)
    .max(50),
  confirmsIndividualFieldReview: z.literal(true),
  evidence: z.string().trim().min(10).max(4000),
});
export type AuthoredBatchSourceReview = z.infer<
  typeof authoredBatchSourceReviewSchema
>;
export const authoredBatchOutputReviewSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        requestId: z.string().min(1),
        originSha256: z.string().regex(/^[a-f0-9]{64}$/),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
        normalizedContent: z.string().min(1).max(200000).optional(),
      }),
    )
    .min(1)
    .max(50),
  confirmsTargetLanguageAndMeaning: z.literal(true),
  evidence: z.string().trim().min(10).max(4000),
});
export type AuthoredBatchOutputReview = z.infer<
  typeof authoredBatchOutputReviewSchema
>;
export const authoredCandidateActionSchema = z.strictObject({
  action: z.enum(AUTHORED_CANDIDATE_ACTIONS),
  originSha256: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalRevision: z.string().min(1),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  evidence: z.string().trim().min(10).max(4000),
});
export type AuthoredCandidateAction = z.infer<
  typeof authoredCandidateActionSchema
>;
export const authoredBatchReviewResultSchema = z.strictObject({
  scopeId: z.string().min(1),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  results: z.array(
    z.strictObject({
      requestId: z.string().min(1),
      accepted: z.boolean(),
      errorCode: z.string().nullable(),
    }),
  ),
});
export type AuthoredBatchReviewResult = z.infer<
  typeof authoredBatchReviewResultSchema
>;
export const AUTHORED_LOCALIZATION_CODES = {
  INCOMPLETE: "AUTHORED_LOCALIZATION_INCOMPLETE",
  PROVIDER_UNAVAILABLE: "TRANSLATION_PROVIDER_UNAVAILABLE",
  PROVIDER_INVALID: "TRANSLATION_PROVIDER_INVALID",
  TRANSLATION_FAILED: "TRANSLATION_FAILED",
} as const;
export const AUTHORED_LOCALIZATION_ENTITIES = {
  LEGAL_REQUIREMENT: "LEGAL_REQUIREMENT",
  ASSESSMENT_RULE: "ASSESSMENT_RULE",
  DECISION: "DECISION",
  HUMAN_REQUEST: "HUMAN_REQUEST",
  EVENT: "EVENT",
  REPORT: "REPORT",
} as const;
export const LOCALIZED_REPORT_SCHEMA_VERSION =
  "LCSP_LOCALIZED_REPORT_V1" as const;
export const localizedReportArtifactSchema = z.strictObject({
  schemaVersion: z.literal(LOCALIZED_REPORT_SCHEMA_VERSION),
  localizedArtifactId: z.uuid(),
  sourceArtifactId: z.uuid(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  locale: z.enum(LOCALES),
  translationRevision: z.number().int().positive(),
  localizedFields: z.record(z.string(), z.string()),
});
export type AuthoredLocalizationEntity =
  (typeof AUTHORED_LOCALIZATION_ENTITIES)[keyof typeof AUTHORED_LOCALIZATION_ENTITIES];
export const authoredLocalizationStatusSchema = z.strictObject({
  state: z.enum(AUTHORED_LOCALIZATION_STATES),
  locale: z.enum(LOCALES),
  canonicalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  translationRevision: z.number().int().positive(),
});
export const authoredTranslationResponseSchema = z.strictObject({
  originSha256: z.string().regex(/^[a-f0-9]{64}$/),
  locale: z.enum(LOCALES),
  content: z.string().min(1),
  engine: z.string().min(1),
  engineVersion: z.string().min(1),
});
export const authoredLocalizationCountsSchema = z.strictObject({
  UNKNOWN_SOURCE: z.number().int().nonnegative(),
  MIXED_SOURCE: z.number().int().nonnegative(),
  SOURCE_REVIEW_REQUIRED: z.number().int().nonnegative(),
  PROVIDER_PENDING: z.number().int().nonnegative(),
  PROVIDER_FAILED: z.number().int().nonnegative(),
  OUTPUT_REVIEW_REQUIRED: z.number().int().nonnegative(),
  READY: z.number().int().nonnegative(),
  FAILED: z.number().int().nonnegative(),
});
export type AuthoredLocalizationCounts = z.infer<
  typeof authoredLocalizationCountsSchema
>;
export const authoredLocalizationOperationsSchema = z.strictObject({
  pendingJobCount: z.number().int().nonnegative(),
  oldestPendingAgeSeconds: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  failedJobCount: z.number().int().nonnegative(),
  candidateReviewsAwaitingAction: z.number().int().nonnegative(),
  sourceReviewsAwaitingAction: z.number().int().nonnegative(),
  workerEnabled: z.boolean(),
  providerConfigured: z.boolean(),
  batchLimit: z.number().int().positive(),
  workerLeaseLimit: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  reviewSlaTargetMinutes: z.number().int().positive(),
  processingSlaTargetMinutes: z.number().int().positive(),
});
export type AuthoredLocalizationOperations = z.infer<
  typeof authoredLocalizationOperationsSchema
>;
export const authoredLocalizationBacklogScopeSchema = z.strictObject({
  scopeId: z.string().min(1),
  entityTypes: z.array(z.enum(AUTHORED_LOCALIZATION_ENTITIES)),
  counts: authoredLocalizationCountsSchema,
  readiness: z.strictObject({
    en: z.enum(AUTHORED_LOCALIZATION_READINESS_STATES),
    vi: z.enum(AUTHORED_LOCALIZATION_READINESS_STATES),
  }),
  pendingJobCount: z.number().int().nonnegative(),
  oldestPendingAgeSeconds: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
});
export type AuthoredLocalizationBacklogScope = z.infer<
  typeof authoredLocalizationBacklogScopeSchema
>;
export const authoredLocalizationBacklogResponseSchema = z.strictObject({
  counts: authoredLocalizationCountsSchema,
  operations: authoredLocalizationOperationsSchema,
  scopes: z.array(authoredLocalizationBacklogScopeSchema),
  nextAfterScopeId: z.string().nullable(),
});
export type AuthoredLocalizationBacklogResponse = z.infer<
  typeof authoredLocalizationBacklogResponseSchema
>;
export const authoredLocalizationQueueItemSchema = z.object({
  id: z.string().min(1),
  scopeId: z.string().min(1),
  entityType: z.enum(AUTHORED_LOCALIZATION_ENTITIES),
  entityId: z.string().min(1),
  canonicalRevision: z.string().min(1),
  canonicalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  fieldPath: z.string().min(1),
  translationRevision: z.number().int().positive(),
  createdAt: z.union([z.string(), z.date()]),
  locale: z.enum(LOCALES),
  originalLanguage: z.enum(LOCALES).nullable(),
  originalContent: z.string(),
  originSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceLanguage: z.enum(AUTHORED_SOURCE_LANGUAGES),
  sourceReviewedBy: z.string().nullable(),
  sourceReviewedAt: z.union([z.string(), z.date()]).nullable(),
  translationReviewedBy: z.string().nullable(),
  translationReviewedAt: z.union([z.string(), z.date()]).nullable(),
  state: z.enum(AUTHORED_LOCALIZATION_STATES),
  operationalState: z
    .enum(AUTHORED_LOCALIZATION_OPERATIONAL_STATES)
    .default(AUTHORED_LOCALIZATION_OPERATIONAL_STATES.SOURCE_REVIEW_REQUIRED),
  errorCode: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.union([z.string(), z.date()]),
  candidate: z
    .object({
      content: z.string(),
      contentSha256: z.string(),
      engine: z.string(),
      engineVersion: z.string(),
    })
    .nullable(),
  revision: z
    .object({
      content: z.string(),
      contentSha256: z.string(),
      engine: z.string(),
      engineVersion: z.string(),
    })
    .nullable(),
  reviews: z
    .array(
      z.object({
        id: z.string(),
        actorId: z.string(),
        evidence: z.string(),
        binding: z.unknown(),
        createdAt: z.union([z.string(), z.date()]),
      }),
    )
    .default([]),
});
export type AuthoredLocalizationQueueItem = z.infer<
  typeof authoredLocalizationQueueItemSchema
>;
export const authoredLocalizationQueueResponseSchema = z.array(
  authoredLocalizationQueueItemSchema,
);

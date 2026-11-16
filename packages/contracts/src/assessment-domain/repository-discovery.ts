import { createHash } from "node:crypto";
import { z } from "zod";

import { repositorySourcePathPrefixSchema } from "../github-integration/source-scope.ts";
import {
  REPOSITORY_SCANNER_VERSIONS,
  type RepositoryScannerVersion,
} from "./repository-profile.ts";

export const REPOSITORY_DISCOVERY_VERSIONS = {
  v1: "LCSP_DISCOVERY_V1",
} as const;
export type RepositoryDiscoveryVersion =
  (typeof REPOSITORY_DISCOVERY_VERSIONS)[keyof typeof REPOSITORY_DISCOVERY_VERSIONS];

export const DISCOVERY_OBSERVATION_STATUSES = {
  observedSourceFact: "OBSERVED_SOURCE_FACT",
  candidateFinding: "CANDIDATE_FINDING",
  inferredHypothesis: "INFERRED_HYPOTHESIS",
  customerConfirmedFact: "CUSTOMER_CONFIRMED_FACT",
  unknown: "UNKNOWN",
} as const;

export const DISCOVERY_SOURCE_CLASSIFICATIONS = {
  productionCandidate: "PRODUCTION_CANDIDATE",
  reachableProduction: "REACHABLE_PRODUCTION",
  testOnly: "TEST_ONLY",
  exampleOnly: "EXAMPLE_ONLY",
  generated: "GENERATED",
  configuration: "CONFIGURATION",
  unknown: "UNKNOWN",
} as const;

export const DISCOVERY_REACHABILITY_STATES = {
  confirmed: "CONFIRMED",
  candidate: "CANDIDATE",
  notEstablished: "NOT_ESTABLISHED",
  unresolved: "UNRESOLVED",
} as const;

export const DISCOVERY_SIGNAL_TYPES = {
  aiSdkImport: "AI_SDK_IMPORT",
  aiSdkCall: "AI_SDK_CALL",
  rawAiHttpCall: "RAW_AI_HTTP_CALL",
  aiWrapper: "AI_WRAPPER",
  dataFlow: "DATA_FLOW",
  control: "CONTROL",
  configuration: "CONFIGURATION",
} as const;

export const DISCOVERY_TECHNOLOGY_RELEVANCE = {
  aiInvocation: "AI_INVOCATION",
  aiOrchestration: "AI_ORCHESTRATION",
  modelConfiguration: "MODEL_CONFIGURATION",
  aiDataFlow: "AI_DATA_FLOW",
  aiControl: "AI_CONTROL",
  relatedLogic: "RELATED_LOGIC",
} as const;

export const DISCOVERY_EVIDENCE_STRENGTHS = {
  directSource: "DIRECT_SOURCE",
  structural: "STRUCTURAL",
  heuristic: "HEURISTIC",
  unknown: "UNKNOWN",
} as const;

export const DISCOVERY_EXPANSION_STATES = {
  notRequested: "NOT_REQUESTED",
  permitted: "PERMITTED",
  expanded: "EXPANDED",
  blocked: "BLOCKED",
} as const;

export const DISCOVERY_RULE_CANDIDATE_STATES = {
  candidate: "CANDIDATE",
  needsContext: "NEEDS_CONTEXT",
  recommended: "RECOMMENDED",
  selected: "SELECTED",
  notSelected: "NOT_SELECTED",
} as const;

export const DISCOVERY_GAP_REASONS = {
  unsupportedLanguage: "UNSUPPORTED_LANGUAGE",
  fileSizeLimitExceeded: "FILE_SIZE_LIMIT_EXCEEDED",
  totalByteBudgetReached: "TOTAL_BYTE_BUDGET_REACHED",
  fileCountLimitReached: "FILE_COUNT_LIMIT_REACHED",
  unreadableOrMalformed: "UNREADABLE_OR_MALFORMED",
  skippedPath: "SKIPPED_PATH",
  unresolvedCall: "UNRESOLVED_CALL",
  unresolvedReachability: "UNRESOLVED_REACHABILITY",
  dynamicConfiguration: "DYNAMIC_CONFIGURATION",
  graphUnavailable: "GRAPH_UNAVAILABLE",
  incompleteCoverage: "INCOMPLETE_COVERAGE",
} as const;

export const DISCOVERY_DETAIL_COLLECTIONS = {
  aiUseCases: "AI_USE_CASES",
  knownGaps: "KNOWN_GAPS",
  unsupportedLanguages: "UNSUPPORTED_LANGUAGES",
  unresolvedCalls: "UNRESOLVED_CALLS",
} as const;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\0") &&
      !value.split("/").includes(".."),
    { message: "Path must be repository-relative without traversal" },
  );

export const repositoryDiscoveryGapSchema = z.strictObject({
  path: z.string().trim().max(1024),
  reason: z.enum(DISCOVERY_GAP_REASONS),
  detail: z.string().trim().min(1).max(1000),
});

export const repositoryDiscoverySourceRangeSchema = z
  .strictObject({
    rangeId: sha256Schema,
    path: pathSchema,
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    sourceDigest: sha256Schema,
    symbol: z.string().trim().min(1).max(500).nullable(),
    signalType: z.enum(DISCOVERY_SIGNAL_TYPES),
    sourceClassification: z.enum(DISCOVERY_SOURCE_CLASSIFICATIONS),
    reachability: z.enum(DISCOVERY_REACHABILITY_STATES),
    observationStatus: z.enum(DISCOVERY_OBSERVATION_STATUSES),
    technologyRelevance: z
      .array(z.enum(DISCOVERY_TECHNOLOGY_RELEVANCE))
      .max(10),
    useCaseIds: z.array(sha256Schema).max(100),
    ruleRelevance: z
      .array(
        z.strictObject({
          assessmentRuleId: z.string().trim().min(1).max(500),
          evidenceNeed: z.string().trim().min(1).max(1000).nullable(),
          rationale: z.string().trim().min(1).max(2000),
        }),
      )
      .max(1000),
    evidenceStrength: z.enum(DISCOVERY_EVIDENCE_STRENGTHS),
    explanation: z.string().trim().min(1).max(2000),
    callers: z.array(z.string().trim().min(1).max(500)).max(100),
    callees: z.array(z.string().trim().min(1).max(500)).max(100),
    unresolvedEdges: z.array(z.string().trim().min(1).max(1000)).max(100),
    coverageGaps: z.array(z.string().trim().min(1).max(1000)).max(100),
    expansionState: z.enum(DISCOVERY_EXPANSION_STATES),
  })
  .refine((range) => range.endLine >= range.startLine, {
    message: "endLine must not precede startLine",
  });

export const repositoryDiscoveryResourceLedgerSchema = z.strictObject({
  budget: z.strictObject({
    maxFiles: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
    maxRanges: z.number().int().positive(),
  }),
  usage: z.strictObject({
    filesScanned: z.number().int().nonnegative(),
    bytesInspected: z.number().int().nonnegative(),
    rangesProduced: z.number().int().nonnegative(),
  }),
  remaining: z.strictObject({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    ranges: z.number().int().nonnegative(),
  }),
  coverageImpact: z.strictObject({
    knownGapCount: z.number().int().nonnegative(),
    unresolvedCallCount: z.number().int().nonnegative(),
    unsupportedLanguageCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  expansionHistory: z
    .array(
      z.strictObject({
        expansionId: sha256Schema,
        requestedAt: z.iso.datetime(),
        reason: z.string().trim().min(1).max(1000),
        addedRangeIds: z.array(sha256Schema).max(10_000),
        resourceUsage: z.strictObject({
          filesScanned: z.number().int().nonnegative(),
          bytesInspected: z.number().int().nonnegative(),
          rangesProduced: z.number().int().nonnegative(),
        }),
        remainingBudget: z.strictObject({
          files: z.number().int().nonnegative(),
          bytes: z.number().int().nonnegative(),
          ranges: z.number().int().nonnegative(),
        }),
        coverageImpact: z.string().trim().min(1).max(2000),
      }),
    )
    .max(1000),
});

export const repositoryAiUseCaseSchema = z.strictObject({
  useCaseId: sha256Schema,
  name: z.string().trim().min(1).max(300),
  observationStatus: z.enum(DISCOVERY_OBSERVATION_STATUSES),
  providerOrFramework: z.string().trim().min(1).max(200).nullable(),
  invocationRangeIds: z.array(sha256Schema).min(1).max(500),
  inputRangeIds: z.array(sha256Schema).max(500),
  outputRangeIds: z.array(sha256Schema).max(500),
  controlRangeIds: z.array(sha256Schema).max(500),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(1000)).max(100),
});

export const repositoryRuleCandidateSchema = z.strictObject({
  assessmentRuleId: z.string().trim().min(1).max(500),
  assessmentRuleVersion: z.string().trim().min(1).max(200),
  state: z.enum(DISCOVERY_RULE_CANDIDATE_STATES),
  supportingUseCaseIds: z.array(sha256Schema).max(500),
  supportingRangeIds: z.array(sha256Schema).max(1000),
  matchedTerms: z.array(z.string().trim().min(1).max(200)).max(100),
  unresolvedConditions: z.array(z.string().trim().min(1).max(1000)).max(100),
  rationale: z.string().trim().min(1).max(4000),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(100),
  authorizesAssessment: z.literal(false),
});

export const repositoryDiscoverySchema = z.strictObject({
  discoveryId: sha256Schema,
  repositoryId: z.string().trim().min(1).max(200),
  commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  sourcePathPrefix: repositorySourcePathPrefixSchema.nullable(),
  scannerVersion: z.enum(REPOSITORY_SCANNER_VERSIONS),
  discoveryVersion: z.enum(REPOSITORY_DISCOVERY_VERSIONS),
  scannerSignature: sha256Schema,
  graphIndexVersion: z.string().trim().min(1).max(200),
  cacheIdentity: sha256Schema,
  contentDigest: sha256Schema,
  sourceRanges: z.array(repositoryDiscoverySourceRangeSchema).max(10_000),
  aiUseCases: z.array(repositoryAiUseCaseSchema).max(2_000),
  ruleCandidates: z.array(repositoryRuleCandidateSchema).max(10_000),
  knownGaps: z.array(repositoryDiscoveryGapSchema).max(2_000),
  unsupportedLanguages: z.array(z.string().trim().min(1).max(100)).max(100),
  skippedPaths: z.array(pathSchema).max(2_000),
  unresolvedCalls: z.array(z.string().trim().min(1).max(1000)).max(2_000),
  resourceLedger: repositoryDiscoveryResourceLedgerSchema,
  scannedFileCount: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});
export type RepositoryDiscovery = z.infer<typeof repositoryDiscoverySchema>;

export const submitRepositoryDiscoverySchema = repositoryDiscoverySchema;
export type SubmitRepositoryDiscovery = z.infer<
  typeof submitRepositoryDiscoverySchema
>;

export const repositoryDiscoverySaveResultSchema = z.strictObject({
  recordId: z.uuid(),
  cacheIdentity: sha256Schema,
  contentDigest: sha256Schema,
  replayed: z.boolean(),
});
export type RepositoryDiscoverySaveResult = z.infer<
  typeof repositoryDiscoverySaveResultSchema
>;

const repositoryDiscoverySummaryDetailSchema = z.strictObject({
  recordId: z.uuid(),
  repositorySnapshotId: z.string().min(1),
  repositoryId: z.string().min(1).max(200),
  repositoryCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  sourcePathPrefix: repositorySourcePathPrefixSchema.nullable(),
  scannerVersion: z.enum(REPOSITORY_SCANNER_VERSIONS),
  discoveryVersion: z.enum(REPOSITORY_DISCOVERY_VERSIONS),
  scannerSignature: sha256Schema,
  graphIndexVersion: z.string().trim().min(1).max(200),
  cacheIdentity: sha256Schema,
  contentDigest: sha256Schema,
  sourceRangeCount: z.number().int().nonnegative(),
  aiUseCaseCount: z.number().int().nonnegative(),
  knownGapCount: z.number().int().nonnegative(),
  unsupportedLanguageCount: z.number().int().nonnegative(),
  unresolvedCallCount: z.number().int().nonnegative(),
  resourceBudget: repositoryDiscoveryResourceLedgerSchema.shape.budget,
  resourceUsage: repositoryDiscoveryResourceLedgerSchema.shape.usage,
  remainingBudget: repositoryDiscoveryResourceLedgerSchema.shape.remaining,
  coverageImpact: repositoryDiscoveryResourceLedgerSchema.shape.coverageImpact,
  expansionCount: z.number().int().nonnegative(),
  preview: z.strictObject({
    ranges: z
      .array(
        z.strictObject({
          rangeId: sha256Schema,
          path: pathSchema,
          startLine: z.number().int().min(1),
          endLine: z.number().int().min(1),
          symbol: z.string().trim().min(1).max(500).nullable(),
          signalType: z.enum(DISCOVERY_SIGNAL_TYPES),
          sourceClassification: z.enum(DISCOVERY_SOURCE_CLASSIFICATIONS),
          reachability: z.enum(DISCOVERY_REACHABILITY_STATES),
          observationStatus: z.enum(DISCOVERY_OBSERVATION_STATUSES),
          evidenceStrength: z.enum(DISCOVERY_EVIDENCE_STRENGTHS),
          explanation: z.string().trim().min(1).max(500),
          useCaseIds: z.array(sha256Schema).max(5),
        }),
      )
      .max(5),
    aiUseCases: z
      .array(
        z.strictObject({
          useCaseId: sha256Schema,
          name: z.string().trim().min(1).max(300),
          observationStatus: z.enum(DISCOVERY_OBSERVATION_STATUSES),
          providerOrFramework: z.string().trim().min(1).max(200).nullable(),
          invocationRangeIds: z.array(sha256Schema).max(10),
          unresolvedQuestions: z
            .array(z.string().trim().min(1).max(1000))
            .max(5),
        }),
      )
      .max(5),
    knownGaps: z.array(repositoryDiscoveryGapSchema).max(5),
    unsupportedLanguages: z
      .array(z.string().trim().min(1).max(100))
      .max(5),
    unresolvedCalls: z
      .array(z.string().trim().min(1).max(1000))
      .max(5),
  }),
  createdAt: z.iso.datetime(),
});

export const repositoryDiscoverySummarySchema = z.discriminatedUnion(
  "available",
  [
    z.strictObject({ available: z.literal(false), discovery: z.null() }),
    z.strictObject({
      available: z.literal(true),
      discovery: repositoryDiscoverySummaryDetailSchema,
    }),
  ],
);
export type RepositoryDiscoverySummary = z.infer<
  typeof repositoryDiscoverySummarySchema
>;

export const repositoryDiscoveryRangePageQuerySchema = z.strictObject({
  recordId: z.uuid(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type RepositoryDiscoveryRangePageQuery = z.infer<
  typeof repositoryDiscoveryRangePageQuerySchema
>;

export const repositoryDiscoveryRangePageSchema = z.strictObject({
  recordId: z.uuid(),
  contentDigest: sha256Schema,
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
  ranges: z.array(repositoryDiscoverySourceRangeSchema).max(100),
});
export type RepositoryDiscoveryRangePage = z.infer<
  typeof repositoryDiscoveryRangePageSchema
>;

export const repositoryDiscoveryDetailPageQuerySchema = z.strictObject({
  recordId: z.uuid(),
  collection: z.enum(DISCOVERY_DETAIL_COLLECTIONS),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type RepositoryDiscoveryDetailPageQuery = z.infer<
  typeof repositoryDiscoveryDetailPageQuerySchema
>;

const repositoryDiscoveryDetailPageBaseSchema = z.strictObject({
  recordId: z.uuid(),
  contentDigest: sha256Schema,
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  nextOffset: z.number().int().nonnegative().nullable(),
});

export const repositoryDiscoveryDetailPageSchema = z.discriminatedUnion(
  "collection",
  [
    repositoryDiscoveryDetailPageBaseSchema.extend({
      collection: z.literal(DISCOVERY_DETAIL_COLLECTIONS.aiUseCases),
      items: z.array(repositoryAiUseCaseSchema).max(100),
    }),
    repositoryDiscoveryDetailPageBaseSchema.extend({
      collection: z.literal(DISCOVERY_DETAIL_COLLECTIONS.knownGaps),
      items: z.array(repositoryDiscoveryGapSchema).max(100),
    }),
    repositoryDiscoveryDetailPageBaseSchema.extend({
      collection: z.literal(DISCOVERY_DETAIL_COLLECTIONS.unsupportedLanguages),
      items: z.array(z.string().trim().min(1).max(100)).max(100),
    }),
    repositoryDiscoveryDetailPageBaseSchema.extend({
      collection: z.literal(DISCOVERY_DETAIL_COLLECTIONS.unresolvedCalls),
      items: z.array(z.string().trim().min(1).max(1000)).max(100),
    }),
  ],
);
export type RepositoryDiscoveryDetailPage = z.infer<
  typeof repositoryDiscoveryDetailPageSchema
>;

/**
 * Business purpose: Normalize discovery values into a stable object-key order for integrity hashing.
 *
 * Business rules:
 * - Preserve array order because ranked observations and history are ordered business records.
 * - Recursively sort plain object keys without changing scalar values.
 *
 * Execution flow:
 * 1. Recursively canonicalize each array item in place order.
 * 2. Sort object entries by key and canonicalize their values.
 * 3. Return scalar values unchanged.
 *
 * Failure cases:
 * - Cyclic or non-serializable inputs fail later during JSON serialization; no fallback representation is invented.
 *
 * Side effects:
 * - Pure in-memory transformation without persistence or authorization changes.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/**
 * Business purpose: Compute the reusable cache partition for one scanner and graph-index view of a pinned repository.
 *
 * Business rules:
 * - Repository identity, lowercase commit, exact source scope, scanner/discovery versions, scanner signature, and graph index version all participate.
 * - The cache identity grants no assessment authority and cannot replace server-owned snapshot validation.
 *
 * Execution flow:
 * 1. Normalize only the commit SHA to lowercase while preserving the exact nullable source scope.
 * 2. Serialize the ordered coordinate tuple using compact JSON.
 * 3. Return the prefixed SHA-256 digest.
 *
 * Failure cases:
 * - Non-serializable coordinate input throws rather than creating a partial identity.
 *
 * Side effects:
 * - Pure calculation without cache, persistence, or authorization changes.
 */
export function computeRepositoryDiscoveryCacheIdentity(input: {
  repositoryId: string;
  commitSha: string;
  sourcePathPrefix: string | null;
  scannerVersion: RepositoryScannerVersion;
  discoveryVersion: RepositoryDiscoveryVersion;
  scannerSignature: string;
  graphIndexVersion: string;
}): string {
  const canonical = JSON.stringify([
    input.repositoryId,
    input.commitSha.toLowerCase(),
    input.sourcePathPrefix,
    input.scannerVersion,
    input.discoveryVersion,
    input.scannerSignature,
    input.graphIndexVersion,
  ]);
  return `sha256:${createHash("sha256").update(canonical, "utf-8").digest("hex")}`;
}

/**
 * Business purpose: Bind a discovery artifact to its complete deterministic observation payload.
 *
 * Business rules:
 * - Volatile generatedAt and the self-referential discoveryId/contentDigest fields are excluded.
 * - Array order remains meaningful and object keys are recursively canonicalized.
 * - The digest does not grant audit-scope authority or convert candidates into accepted facts.
 *
 * Execution flow:
 * 1. Remove volatile and self-referential fields.
 * 2. Recursively sort object keys while retaining ordered collections.
 * 3. Hash canonical UTF-8 JSON and return the sha256-prefixed digest.
 *
 * Failure cases:
 * - Non-serializable values throw during JSON serialization rather than producing an ambiguous digest.
 *
 * Side effects:
 * - Pure calculation without persistence, network access, or authorization changes.
 */
export function computeRepositoryDiscoveryDigest(
  discovery:
    | RepositoryDiscovery
    | Omit<
        RepositoryDiscovery,
        "contentDigest" | "discoveryId" | "generatedAt"
      >,
): string {
  const digestInput = Object.fromEntries(
    Object.entries(discovery).filter(
      ([key]) =>
        key !== "contentDigest" &&
        key !== "discoveryId" &&
        key !== "generatedAt",
    ),
  );
  const canonical = JSON.stringify(canonicalize(digestInput));
  return `sha256:${createHash("sha256").update(canonical, "utf-8").digest("hex")}`;
}

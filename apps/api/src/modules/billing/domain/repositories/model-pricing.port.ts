import type {
  CustomerTariffDraftStatus,
  MicrocreditTariffRates,
  ModelPricingScope,
  OperationalAssumptions,
  TokenBucketPolicy,
} from "@lcsp/contracts/billing";

export const MODEL_PRICING_REPOSITORY = Symbol("MODEL_PRICING_REPOSITORY");

/**
 * Pure domain record representing a mutable `CustomerModelTariffDraft` row.
 */
export type ModelTariffDraftRecord = {
  id: string;
  scope: ModelPricingScope;
  provider: string | null;
  resolvedModel: string | null;
  normalizedScopeKey: string;
  status: CustomerTariffDraftStatus;
  version: number;
  inputMicrocreditsPerMillion: bigint;
  outputMicrocreditsPerMillion: bigint;
  reasoningPolicy: TokenBucketPolicy;
  reasoningMicrocreditsPerMillion: bigint | null;
  cachedInputPolicy: TokenBucketPolicy;
  cachedInputMicrocreditsPerMillion: bigint | null;
  cacheWritePolicy: TokenBucketPolicy;
  cacheWriteMicrocreditsPerMillion: bigint | null;
  cacheWrite5mMicrocreditsPerMillion: bigint | null;
  cacheWrite1hMicrocreditsPerMillion: bigint | null;
  operationalAssumptions: OperationalAssumptions | null;
  publishedSnapshotId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Pure domain record representing an immutable append-only `CustomerModelTariffSnapshot` row.
 */
export type ModelTariffSnapshotRecord = {
  id: string;
  sourceDraftId: string | null;
  scope: ModelPricingScope;
  provider: string | null;
  resolvedModel: string | null;
  normalizedScopeKey: string;
  version: number;
  accountingUnitVersion: number;
  inputMicrocreditsPerMillion: bigint;
  outputMicrocreditsPerMillion: bigint;
  reasoningPolicy: TokenBucketPolicy;
  reasoningMicrocreditsPerMillion: bigint | null;
  cachedInputPolicy: TokenBucketPolicy;
  cachedInputMicrocreditsPerMillion: bigint | null;
  cacheWritePolicy: TokenBucketPolicy;
  cacheWriteMicrocreditsPerMillion: bigint | null;
  cacheWrite5mMicrocreditsPerMillion: bigint | null;
  cacheWrite1hMicrocreditsPerMillion: bigint | null;
  idempotencyKey: string;
  requestFingerprint: string;
  publishedBy: string;
  auditReason: string;
  publishedAt: Date;
  createdAt: Date;
};

/**
 * Pure domain record representing a versioned half-open `[effectiveFrom, effectiveTo)` assignment row.
 */
export type ModelTariffAssignmentRecord = {
  id: string;
  tariffSnapshotId: string;
  scope: ModelPricingScope;
  normalizedScopeKey: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  supersededByAssignmentId: string | null;
  supersededBy: string | null;
  supersededAt: Date | null;
  cancelledAt: Date | null;
  supersedeIdempotencyKey: string | null;
  supersedeRequestFingerprint: string | null;
  version: number;
  auditReason: string | null;
  createdBy: string;
  createdAt: Date;
};

/**
 * Active tariff candidate projected from `CustomerModelTariffAssignment` + `CustomerModelTariffSnapshot`
 * for `ModelPricingCalculatorService` precedence resolution.
 */
export type ActiveModelTariffCandidateRecord = {
  assignmentId: string;
  snapshotId: string;
  scope: ModelPricingScope;
  normalizedScopeKey: string;
  version: number;
  ratesMicrocreditsPerMillion: MicrocreditTariffRates;
};

export type ModelPricingOverviewFilter = {
  provider?: string;
  resolvedModel?: string;
  scope?: ModelPricingScope;
};

export type ModelPricingOverviewData = {
  dbUtcNow: Date;
  drafts: readonly ModelTariffDraftRecord[];
  snapshots: readonly ModelTariffSnapshotRecord[];
  assignments: readonly ModelTariffAssignmentRecord[];
};

export type CreateModelTariffDraftRepoInput = {
  scope: ModelPricingScope;
  provider: string | null;
  resolvedModel: string | null;
  normalizedScopeKey: string;
  inputMicrocreditsPerMillion: bigint;
  outputMicrocreditsPerMillion: bigint;
  reasoningPolicy: TokenBucketPolicy;
  reasoningMicrocreditsPerMillion: bigint | null;
  cachedInputPolicy: TokenBucketPolicy;
  cachedInputMicrocreditsPerMillion: bigint | null;
  cacheWritePolicy: TokenBucketPolicy;
  cacheWriteMicrocreditsPerMillion: bigint | null;
  cacheWrite5mMicrocreditsPerMillion: bigint | null;
  cacheWrite1hMicrocreditsPerMillion: bigint | null;
  operationalAssumptions: OperationalAssumptions | null;
  actorId: string;
  correlationId: string;
};

export type UpdateModelTariffDraftRepoInput = {
  draftId: string;
  expectedVersion: number;
  scope?: ModelPricingScope;
  provider?: string | null;
  resolvedModel?: string | null;
  inputMicrocreditsPerMillion?: bigint;
  outputMicrocreditsPerMillion?: bigint;
  reasoningPolicy?: TokenBucketPolicy;
  reasoningMicrocreditsPerMillion?: bigint | null;
  cachedInputPolicy?: TokenBucketPolicy;
  cachedInputMicrocreditsPerMillion?: bigint | null;
  cacheWritePolicy?: TokenBucketPolicy;
  cacheWriteMicrocreditsPerMillion?: bigint | null;
  cacheWrite5mMicrocreditsPerMillion?: bigint | null;
  cacheWrite1hMicrocreditsPerMillion?: bigint | null;
  operationalAssumptions?: OperationalAssumptions | null;
  actorId: string;
  correlationId: string;
};

export type PublishModelTariffDraftRepoInput = {
  draftId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  auditReason: string;
  expectedDraftVersion: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  actorId: string;
  correlationId: string;
};

export type PublishModelTariffDraftRepoResult = {
  draft: ModelTariffDraftRecord;
  snapshot: ModelTariffSnapshotRecord;
  assignment: ModelTariffAssignmentRecord;
  auditEventId: string;
  dbUtcNow: Date;
  idempotentReplay: boolean;
};

export type SupersedeModelTariffAssignmentRepoInput = {
  assignmentId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  auditReason: string;
  expectedAssignmentVersion?: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  replacementDraftId?: string;
  expectedDraftVersion?: number;
  replacementSnapshotId?: string;
  actorId: string;
  correlationId: string;
};

export type SupersedeModelTariffAssignmentRepoResult = {
  supersededAssignment: ModelTariffAssignmentRecord;
  replacementAssignment: ModelTariffAssignmentRecord;
  replacementSnapshot: ModelTariffSnapshotRecord;
  auditEventId: string;
  dbUtcNow: Date;
  idempotentReplay: boolean;
};

/**
 * Port interface isolating Admin model pricing persistence, DB UTC clock reads,
 * advisory scope locking, and transactional audit logging from NestJS CQRS handlers.
 */
export interface ModelPricingRepositoryPort {
  getDbUtcNow(): Promise<Date>;
  findDraftById(draftId: string): Promise<ModelTariffDraftRecord | null>;
  findSnapshotById(
    snapshotId: string,
  ): Promise<ModelTariffSnapshotRecord | null>;
  findAssignmentById(
    assignmentId: string,
  ): Promise<ModelTariffAssignmentRecord | null>;
  listOverviewData(
    filter?: ModelPricingOverviewFilter,
  ): Promise<ModelPricingOverviewData>;
  listActiveAssignmentsAt(
    effectiveAt: Date,
  ): Promise<readonly ActiveModelTariffCandidateRecord[]>;
  createDraft(
    input: CreateModelTariffDraftRepoInput,
  ): Promise<ModelTariffDraftRecord>;
  updateDraft(
    input: UpdateModelTariffDraftRepoInput,
  ): Promise<ModelTariffDraftRecord>;
  publishDraft(
    input: PublishModelTariffDraftRepoInput,
  ): Promise<PublishModelTariffDraftRepoResult>;
  supersedeAssignment(
    input: SupersedeModelTariffAssignmentRepoInput,
  ): Promise<SupersedeModelTariffAssignmentRepoResult>;
}

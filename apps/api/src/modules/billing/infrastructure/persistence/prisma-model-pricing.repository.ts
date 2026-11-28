import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  AUDIT_DECISIONS,
  AUDIT_EVENT_RESULTS,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_AUDIT_EVENT_TYPES,
  MODEL_PRICING_SCOPES,
  normalizeModelPricingScopeKey,
  type ModelPricingScope,
  type OperationalAssumptions,
} from "@lcsp/contracts/billing";
import {
  Prisma,
  type CustomerModelTariffAssignment,
  type CustomerModelTariffDraft,
  type CustomerModelTariffSnapshot,
} from "@prisma/client";
import {
  fromPrismaCustomerTariffDraftStatus,
  fromPrismaModelPricingScope,
  fromPrismaTokenBucketPolicy,
  toPrismaCustomerTariffDraftStatus,
  toPrismaModelPricingScope,
  toPrismaTokenBucketPolicy,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { toMicrocreditTariffRates } from "../../application/mappers/model-pricing-view.mapper.js";
import { ModelPricingCalculatorService } from "../../application/shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../application/shared/runtime-model-allowlist.service.js";
import {
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  ModelPricingImmutableSnapshotError,
  ModelPricingInvalidIntervalError,
  ModelPricingInvalidStateError,
  ModelPricingNotFoundError,
  ModelPricingStaleDraftError,
} from "../../domain/billing.errors.js";
import {
  MODEL_PRICING_FINGERPRINT_ACTIONS,
  computeModelPricingRequestFingerprint,
} from "../../domain/model-pricing-fingerprint.js";
import type {
  ActiveModelTariffCandidateRecord,
  CreateModelTariffDraftRepoInput,
  ModelPricingOverviewData,
  ModelPricingOverviewFilter,
  ModelPricingRepositoryPort,
  ModelTariffAssignmentRecord,
  ModelTariffDraftRecord,
  ModelTariffSnapshotRecord,
  PublishModelTariffDraftRepoInput,
  PublishModelTariffDraftRepoResult,
  SupersedeModelTariffAssignmentRepoInput,
  SupersedeModelTariffAssignmentRepoResult,
  UpdateModelTariffDraftRepoInput,
} from "../../domain/repositories/model-pricing.port.js";
import {
  isRetryableTransactionConflict,
  mapPrismaModelPricingPersistenceError,
} from "./prisma-model-pricing-error.js";

const MAX_TX_RETRIES = 3;

function computeDeterministicAuditId(idempotencyKey: string): string {
  return `audit:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

function toDraftRecord(row: CustomerModelTariffDraft): ModelTariffDraftRecord {
  return {
    id: row.id,
    scope: fromPrismaModelPricingScope(row.scope),
    provider: row.provider,
    resolvedModel: row.resolvedModel,
    normalizedScopeKey: row.normalizedScopeKey,
    status: fromPrismaCustomerTariffDraftStatus(row.status),
    version: row.version,
    inputMicrocreditsPerMillion: row.inputMicrocreditsPerMillion,
    outputMicrocreditsPerMillion: row.outputMicrocreditsPerMillion,
    reasoningPolicy: fromPrismaTokenBucketPolicy(row.reasoningPolicy),
    reasoningMicrocreditsPerMillion: row.reasoningMicrocreditsPerMillion,
    cachedInputPolicy: fromPrismaTokenBucketPolicy(row.cachedInputPolicy),
    cachedInputMicrocreditsPerMillion: row.cachedInputMicrocreditsPerMillion,
    cacheWritePolicy: fromPrismaTokenBucketPolicy(row.cacheWritePolicy),
    cacheWriteMicrocreditsPerMillion: row.cacheWriteMicrocreditsPerMillion,
    cacheWrite5mMicrocreditsPerMillion: row.cacheWrite5mMicrocreditsPerMillion,
    cacheWrite1hMicrocreditsPerMillion: row.cacheWrite1hMicrocreditsPerMillion,
    operationalAssumptions:
      (row.operationalAssumptions as OperationalAssumptions | null) ?? null,
    publishedSnapshotId: row.publishedSnapshotId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSnapshotRecord(
  row: CustomerModelTariffSnapshot,
): ModelTariffSnapshotRecord {
  return {
    id: row.id,
    sourceDraftId: row.sourceDraftId,
    scope: fromPrismaModelPricingScope(row.scope),
    provider: row.provider,
    resolvedModel: row.resolvedModel,
    normalizedScopeKey: row.normalizedScopeKey,
    version: row.version,
    accountingUnitVersion: row.accountingUnitVersion,
    inputMicrocreditsPerMillion: row.inputMicrocreditsPerMillion,
    outputMicrocreditsPerMillion: row.outputMicrocreditsPerMillion,
    reasoningPolicy: fromPrismaTokenBucketPolicy(row.reasoningPolicy),
    reasoningMicrocreditsPerMillion: row.reasoningMicrocreditsPerMillion,
    cachedInputPolicy: fromPrismaTokenBucketPolicy(row.cachedInputPolicy),
    cachedInputMicrocreditsPerMillion: row.cachedInputMicrocreditsPerMillion,
    cacheWritePolicy: fromPrismaTokenBucketPolicy(row.cacheWritePolicy),
    cacheWriteMicrocreditsPerMillion: row.cacheWriteMicrocreditsPerMillion,
    cacheWrite5mMicrocreditsPerMillion: row.cacheWrite5mMicrocreditsPerMillion,
    cacheWrite1hMicrocreditsPerMillion: row.cacheWrite1hMicrocreditsPerMillion,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    publishedBy: row.publishedBy,
    auditReason: row.auditReason,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function toAssignmentRecord(
  row: CustomerModelTariffAssignment,
): ModelTariffAssignmentRecord {
  return {
    id: row.id,
    tariffSnapshotId: row.tariffSnapshotId,
    scope: fromPrismaModelPricingScope(row.scope),
    normalizedScopeKey: row.normalizedScopeKey,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    supersededByAssignmentId: row.supersededByAssignmentId,
    supersededBy: row.supersededBy,
    supersededAt: row.supersededAt,
    cancelledAt: row.cancelledAt,
    supersedeIdempotencyKey: row.supersedeIdempotencyKey,
    supersedeRequestFingerprint: row.supersedeRequestFingerprint,
    version: row.version,
    auditReason: row.auditReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function normalizeScopeColumns(
  scope: ModelPricingScope,
  provider?: string | null,
  resolvedModel?: string | null,
): {
  provider: string | null;
  resolvedModel: string | null;
  normalizedScopeKey: string;
} {
  let normalizedScopeKey: string;
  try {
    normalizedScopeKey = normalizeModelPricingScopeKey(
      scope,
      provider,
      resolvedModel,
    );
  } catch (error) {
    throw new InvalidBillingInputError(
      error instanceof Error ? error.message : "Invalid tariff scope identity",
    );
  }

  return {
    provider:
      scope === MODEL_PRICING_SCOPES.globalDefault
        ? null
        : provider!.trim().toLowerCase(),
    resolvedModel:
      scope === MODEL_PRICING_SCOPES.exactModel ? resolvedModel!.trim() : null,
    normalizedScopeKey,
  };
}

@Injectable()
export class PrismaModelPricingRepository implements ModelPricingRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly allowlistService: RuntimeModelAllowlistService,
    private readonly calculatorService: ModelPricingCalculatorService,
  ) {}

  /**
   * Business purpose: Query the authoritative PostgreSQL database UTC clock for assignment lifecycle comparisons.
   *
   * Business rules:
   * - Effective interval boundaries are always evaluated against database UTC `NOW()`, never local Node wall-clock skew.
   *
   * Execution flow:
   * 1. Execute `SELECT NOW() AS "dbUtcNow"` through Prisma.
   * 2. Return the returned `Date` instance.
   *
   * Failure cases:
   * - Propagates translated persistence errors if the database query fails.
   *
   * Side effects:
   * - None: read-only SQL clock query.
   */
  async getDbUtcNow(): Promise<Date> {
    try {
      return await this.readDbUtcNow(this.prisma);
    } catch (error) {
      mapPrismaModelPricingPersistenceError(error);
    }
  }

  /**
   * Business purpose: Retrieve a single `CustomerModelTariffDraft` domain record by identifier.
   *
   * Business rules:
   * - Translates Prisma enums strictly through `prisma-enum-mappers.ts`.
   *
   * Execution flow:
   * 1. Query `customerModelTariffDraft.findUnique` by `draftId`.
   * 2. Map the row to `ModelTariffDraftRecord` or return `null`.
   *
   * Failure cases:
   * - Maps unexpected database errors via `mapPrismaModelPricingPersistenceError`.
   *
   * Side effects:
   * - None: read-only query.
   */
  async findDraftById(draftId: string): Promise<ModelTariffDraftRecord | null> {
    try {
      const row = await this.prisma.customerModelTariffDraft.findUnique({
        where: { id: draftId },
      });
      return row ? toDraftRecord(row) : null;
    } catch (error) {
      mapPrismaModelPricingPersistenceError(error);
    }
  }

  /**
   * Business purpose: Retrieve a single immutable `CustomerModelTariffSnapshot` domain record by identifier.
   *
   * Business rules:
   * - Translates Prisma enums strictly through `prisma-enum-mappers.ts`.
   *
   * Execution flow:
   * 1. Query `customerModelTariffSnapshot.findUnique` by `snapshotId`.
   * 2. Map the row to `ModelTariffSnapshotRecord` or return `null`.
   *
   * Failure cases:
   * - Maps unexpected database errors via `mapPrismaModelPricingPersistenceError`.
   *
   * Side effects:
   * - None: read-only query.
   */
  async findSnapshotById(
    snapshotId: string,
  ): Promise<ModelTariffSnapshotRecord | null> {
    try {
      const row = await this.prisma.customerModelTariffSnapshot.findUnique({
        where: { id: snapshotId },
      });
      return row ? toSnapshotRecord(row) : null;
    } catch (error) {
      mapPrismaModelPricingPersistenceError(error);
    }
  }

  /**
   * Business purpose: Retrieve a single `CustomerModelTariffAssignment` domain record by identifier.
   *
   * Business rules:
   * - Translates Prisma enums strictly through `prisma-enum-mappers.ts`.
   *
   * Execution flow:
   * 1. Query `customerModelTariffAssignment.findUnique` by `assignmentId`.
   * 2. Map the row to `ModelTariffAssignmentRecord` or return `null`.
   *
   * Failure cases:
   * - Maps unexpected database errors via `mapPrismaModelPricingPersistenceError`.
   *
   * Side effects:
   * - None: read-only query.
   */
  async findAssignmentById(
    assignmentId: string,
  ): Promise<ModelTariffAssignmentRecord | null> {
    try {
      const row = await this.prisma.customerModelTariffAssignment.findUnique({
        where: { id: assignmentId },
      });
      return row ? toAssignmentRecord(row) : null;
    } catch (error) {
      mapPrismaModelPricingPersistenceError(error);
    }
  }

  /**
   * Business purpose: Fetch DB UTC timestamp alongside drafts, immutable snapshots, and assignments for the Admin pricing overview.
   *
   * Business rules:
   * - Runs reads consistently inside a single read-only query sequence with DB UTC `NOW()` so status derivation matches DB state.
   * - Optional `scope` filter narrows rows cleanly without dropping records needed for coverage calculations when unfiltered.
   *
   * Execution flow:
   * 1. Query `SELECT NOW() AS "dbUtcNow"`.
   * 2. Load drafts, snapshots, and assignments ordered deterministically by recency and version.
   * 3. Translate all rows to pure domain records.
   *
   * Failure cases:
   * - Maps persistence failures via `mapPrismaModelPricingPersistenceError`.
   *
   * Side effects:
   * - None: read-only query.
   */
  async listOverviewData(
    filter: ModelPricingOverviewFilter = {},
  ): Promise<ModelPricingOverviewData> {
    try {
      const scopeWhere = filter.scope
        ? { scope: toPrismaModelPricingScope(filter.scope) }
        : {};
      const [dbUtcNow, draftRows, snapshotRows, assignmentRows] =
        await Promise.all([
          this.readDbUtcNow(this.prisma),
          this.prisma.customerModelTariffDraft.findMany({
            where: scopeWhere,
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          }),
          this.prisma.customerModelTariffSnapshot.findMany({
            where: scopeWhere,
            orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
          }),
          this.prisma.customerModelTariffAssignment.findMany({
            where: scopeWhere,
            orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
          }),
        ]);

      return {
        dbUtcNow,
        drafts: draftRows.map(toDraftRecord),
        snapshots: snapshotRows.map(toSnapshotRecord),
        assignments: assignmentRows.map(toAssignmentRecord),
      };
    } catch (error) {
      mapPrismaModelPricingPersistenceError(error);
    }
  }

  /**
   * Business purpose: List active half-open `[effectiveFrom, effectiveTo)` assignments and their immutable snapshots at a UTC instant.
   *
   * Business rules:
   * - Excludes cancelled assignments (`cancelledAt IS NULL`) and half-open expired/future windows (`effectiveFrom <= effectiveAt` and `effectiveTo IS NULL OR effectiveTo > effectiveAt`).
   *
   * Execution flow:
   * 1. Query active `CustomerModelTariffAssignment` rows joined with `tariffSnapshot` at `effectiveAt`.
   * 2. Project each row into `ActiveModelTariffCandidateRecord`.
   *
   * Failure cases:
   * - Maps database errors via `mapPrismaModelPricingPersistenceError`.
   *
   * Side effects:
   * - None: read-only query.
   */
  async listActiveAssignmentsAt(
    effectiveAt: Date,
  ): Promise<readonly ActiveModelTariffCandidateRecord[]> {
    try {
      const rows = await this.prisma.customerModelTariffAssignment.findMany({
        where: {
          cancelledAt: null,
          effectiveFrom: { lte: effectiveAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveAt } }],
        },
        include: {
          tariffSnapshot: true,
        },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      });

      return rows.map((row) => {
        const snapshot = toSnapshotRecord(row.tariffSnapshot);
        return {
          assignmentId: row.id,
          snapshotId: snapshot.id,
          scope: snapshot.scope,
          normalizedScopeKey: snapshot.normalizedScopeKey,
          version: snapshot.version,
          ratesMicrocreditsPerMillion: toMicrocreditTariffRates(snapshot),
        };
      });
    } catch (error) {
      mapPrismaModelPricingPersistenceError(error);
    }
  }

  /**
   * Business purpose: Persist a new mutable `DRAFT` tariff together with its `MODEL_PRICING_DRAFT_CREATED` audit event atomically.
   *
   * Business rules:
   * - Draft starts at `status = DRAFT` and `version = 1` with `createdBy = updatedBy = actorId`.
   * - Writes `AuditEvent` inside the same database transaction with `AuditSanitizer`-safe payload keys.
   *
   * Execution flow:
   * 1. Insert `CustomerModelTariffDraft` inside a retry-wrapped Prisma transaction.
   * 2. Write `AuditEvent` (`MODEL_PRICING_DRAFT_CREATED`, `AUDIT_RESOURCE_TYPES.customerModelTariff`) in the same transaction.
   * 3. Return the created `ModelTariffDraftRecord`.
   *
   * Failure cases:
   * - Translates `23514` CHECK violations or concurrency conflicts into typed domain errors and rolls back the transaction.
   *
   * Side effects:
   * - Inserts one `CustomerModelTariffDraft` row and one `AuditEvent` row atomically.
   */
  async createDraft(
    input: CreateModelTariffDraftRepoInput,
  ): Promise<ModelTariffDraftRecord> {
    return this.runTxWithRetry(async (tx) => {
      const draftRow = await tx.customerModelTariffDraft.create({
        data: {
          scope: toPrismaModelPricingScope(input.scope),
          provider: input.provider,
          resolvedModel: input.resolvedModel,
          normalizedScopeKey: input.normalizedScopeKey,
          status: toPrismaCustomerTariffDraftStatus(
            CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
          ),
          version: 1,
          inputMicrocreditsPerMillion: input.inputMicrocreditsPerMillion,
          outputMicrocreditsPerMillion: input.outputMicrocreditsPerMillion,
          reasoningPolicy: toPrismaTokenBucketPolicy(input.reasoningPolicy),
          reasoningMicrocreditsPerMillion:
            input.reasoningMicrocreditsPerMillion,
          cachedInputPolicy: toPrismaTokenBucketPolicy(input.cachedInputPolicy),
          cachedInputMicrocreditsPerMillion:
            input.cachedInputMicrocreditsPerMillion,
          cacheWritePolicy: toPrismaTokenBucketPolicy(input.cacheWritePolicy),
          cacheWriteMicrocreditsPerMillion:
            input.cacheWriteMicrocreditsPerMillion,
          cacheWrite5mMicrocreditsPerMillion:
            input.cacheWrite5mMicrocreditsPerMillion,
          cacheWrite1hMicrocreditsPerMillion:
            input.cacheWrite1hMicrocreditsPerMillion,
          operationalAssumptions:
            input.operationalAssumptions === null
              ? undefined
              : (input.operationalAssumptions as unknown as Prisma.InputJsonValue),
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });

      const record = toDraftRecord(draftRow);
      // Why: Audit payloads must avoid `*Key` property names other than `idempotencyKey` so `AuditSanitizer`
      // never strips `scopeKey` or emits redaction warnings, and `bigint` rates must serialize as base-10 strings.
      await this.auditWriter.writeInTxReturningId(
        {
          eventType: MODEL_PRICING_AUDIT_EVENT_TYPES.draftCreated,
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.customerModelTariff,
          resourceId: record.id,
          correlationId: input.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: AUDIT_EVENT_RESULTS.success,
          payload: {
            action: MODEL_PRICING_AUDIT_EVENT_TYPES.draftCreated,
            draftId: record.id,
            scope: record.scope,
            scopeKey: record.normalizedScopeKey,
            provider: record.provider,
            resolvedModel: record.resolvedModel,
            version: record.version,
            inputMicrocreditsPerMillion:
              record.inputMicrocreditsPerMillion.toString(),
            outputMicrocreditsPerMillion:
              record.outputMicrocreditsPerMillion.toString(),
          },
        },
        tx,
      );

      return record;
    });
  }

  /**
   * Business purpose: Atomically validate, merge, and update a mutable `DRAFT` tariff using optimistic `expectedVersion` locking.
   *
   * Business rules:
   * - Rejects non-existent drafts (`404`), `PUBLISHED` drafts (`409` immutable), `ABANDONED` drafts (`409` invalid state), and stale versions (`409`).
   * - Re-validates merged scope identity, `EXACT_MODEL` runtime allowlist, and rate completeness before persisting.
   * - Uses compare-and-swap `updateMany` with `version: { increment: 1 }` and logs `MODEL_PRICING_DRAFT_UPDATED` in the same transaction.
   *
   * Execution flow:
   * 1. Load target draft inside a transaction and verify `status === DRAFT` and `version === expectedVersion`.
   * 2. Merge patched fields onto the draft, recompute normalized scope columns, and validate allowlist + rates on the merged state.
   * 3. Execute atomic CAS `updateMany`, reload updated row, and write `AuditEvent`.
   *
   * Failure cases:
   * - Throws `ModelPricingNotFoundError`, `ModelPricingImmutableSnapshotError`, `ModelPricingInvalidStateError`, `ModelPricingStaleDraftError`, `ModelPricingUnlistedModelError`, `ModelPricingIncompleteRatesError`, or `InvalidBillingInputError`.
   *
   * Side effects:
   * - Increments `CustomerModelTariffDraft.version` and inserts one `AuditEvent` row atomically.
   */
  async updateDraft(
    input: UpdateModelTariffDraftRepoInput,
  ): Promise<ModelTariffDraftRecord> {
    return this.runTxWithRetry(async (tx) => {
      const existingRow = await tx.customerModelTariffDraft.findUnique({
        where: { id: input.draftId },
      });
      if (!existingRow) {
        throw new ModelPricingNotFoundError(
          `Model tariff draft '${input.draftId}' was not found`,
        );
      }

      const existing = toDraftRecord(existingRow);
      if (existing.status === CUSTOMER_TARIFF_DRAFT_STATUSES.published) {
        throw new ModelPricingImmutableSnapshotError(
          "Published model tariff drafts cannot be modified",
        );
      }
      if (existing.status !== CUSTOMER_TARIFF_DRAFT_STATUSES.draft) {
        throw new ModelPricingInvalidStateError(
          `Draft '${input.draftId}' is in non-editable status '${existing.status}'`,
        );
      }
      if (existing.version !== input.expectedVersion) {
        throw new ModelPricingStaleDraftError(
          `Draft '${input.draftId}' version ${existing.version} does not match expectedVersion ${input.expectedVersion}`,
        );
      }

      const nextScope = input.scope ?? existing.scope;
      const rawProvider =
        input.provider !== undefined
          ? input.provider
          : nextScope === MODEL_PRICING_SCOPES.globalDefault
            ? null
            : existing.provider;
      const rawModel =
        input.resolvedModel !== undefined
          ? input.resolvedModel
          : nextScope === MODEL_PRICING_SCOPES.exactModel
            ? existing.resolvedModel
            : null;
      const normalizedScope = normalizeScopeColumns(
        nextScope,
        rawProvider,
        rawModel,
      );

      if (nextScope === MODEL_PRICING_SCOPES.exactModel) {
        this.allowlistService.assertAllowlisted(
          normalizedScope.provider ?? "",
          normalizedScope.resolvedModel ?? "",
        );
      }

      const mergedRates = {
        inputMicrocreditsPerMillion:
          input.inputMicrocreditsPerMillion ??
          existing.inputMicrocreditsPerMillion,
        outputMicrocreditsPerMillion:
          input.outputMicrocreditsPerMillion ??
          existing.outputMicrocreditsPerMillion,
        reasoningPolicy: input.reasoningPolicy ?? existing.reasoningPolicy,
        reasoningMicrocreditsPerMillion:
          input.reasoningMicrocreditsPerMillion !== undefined
            ? input.reasoningMicrocreditsPerMillion
            : existing.reasoningMicrocreditsPerMillion,
        cachedInputPolicy:
          input.cachedInputPolicy ?? existing.cachedInputPolicy,
        cachedInputMicrocreditsPerMillion:
          input.cachedInputMicrocreditsPerMillion !== undefined
            ? input.cachedInputMicrocreditsPerMillion
            : existing.cachedInputMicrocreditsPerMillion,
        cacheWritePolicy: input.cacheWritePolicy ?? existing.cacheWritePolicy,
        cacheWriteMicrocreditsPerMillion:
          input.cacheWriteMicrocreditsPerMillion !== undefined
            ? input.cacheWriteMicrocreditsPerMillion
            : existing.cacheWriteMicrocreditsPerMillion,
        cacheWrite5mMicrocreditsPerMillion:
          input.cacheWrite5mMicrocreditsPerMillion !== undefined
            ? input.cacheWrite5mMicrocreditsPerMillion
            : existing.cacheWrite5mMicrocreditsPerMillion,
        cacheWrite1hMicrocreditsPerMillion:
          input.cacheWrite1hMicrocreditsPerMillion !== undefined
            ? input.cacheWrite1hMicrocreditsPerMillion
            : existing.cacheWrite1hMicrocreditsPerMillion,
      };

      this.calculatorService.assertCompleteTariffRates(
        toMicrocreditTariffRates(mergedRates),
      );

      const nextAssumptions =
        input.operationalAssumptions !== undefined
          ? input.operationalAssumptions
          : existing.operationalAssumptions;

      const cas = await tx.customerModelTariffDraft.updateMany({
        where: {
          id: existing.id,
          status: toPrismaCustomerTariffDraftStatus(
            CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
          ),
          version: input.expectedVersion,
        },
        data: {
          scope: toPrismaModelPricingScope(nextScope),
          provider: normalizedScope.provider,
          resolvedModel: normalizedScope.resolvedModel,
          normalizedScopeKey: normalizedScope.normalizedScopeKey,
          inputMicrocreditsPerMillion: mergedRates.inputMicrocreditsPerMillion,
          outputMicrocreditsPerMillion:
            mergedRates.outputMicrocreditsPerMillion,
          reasoningPolicy: toPrismaTokenBucketPolicy(
            mergedRates.reasoningPolicy,
          ),
          reasoningMicrocreditsPerMillion:
            mergedRates.reasoningMicrocreditsPerMillion,
          cachedInputPolicy: toPrismaTokenBucketPolicy(
            mergedRates.cachedInputPolicy,
          ),
          cachedInputMicrocreditsPerMillion:
            mergedRates.cachedInputMicrocreditsPerMillion,
          cacheWritePolicy: toPrismaTokenBucketPolicy(
            mergedRates.cacheWritePolicy,
          ),
          cacheWriteMicrocreditsPerMillion:
            mergedRates.cacheWriteMicrocreditsPerMillion,
          cacheWrite5mMicrocreditsPerMillion:
            mergedRates.cacheWrite5mMicrocreditsPerMillion,
          cacheWrite1hMicrocreditsPerMillion:
            mergedRates.cacheWrite1hMicrocreditsPerMillion,
          operationalAssumptions:
            nextAssumptions === null
              ? Prisma.DbNull
              : (nextAssumptions as unknown as Prisma.InputJsonValue),
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });

      if (cas.count !== 1) {
        throw new ModelPricingStaleDraftError(
          `Draft '${input.draftId}' was concurrently modified`,
        );
      }

      const updatedRow = await tx.customerModelTariffDraft.findUniqueOrThrow({
        where: { id: existing.id },
      });
      const updated = toDraftRecord(updatedRow);

      await this.auditWriter.writeInTxReturningId(
        {
          eventType: MODEL_PRICING_AUDIT_EVENT_TYPES.draftUpdated,
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.customerModelTariff,
          resourceId: updated.id,
          correlationId: input.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: AUDIT_EVENT_RESULTS.success,
          payload: {
            action: MODEL_PRICING_AUDIT_EVENT_TYPES.draftUpdated,
            draftId: updated.id,
            scope: updated.scope,
            scopeKey: updated.normalizedScopeKey,
            previousVersion: existing.version,
            nextVersion: updated.version,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Business purpose: Atomically publish a `DRAFT` tariff into an immutable `CustomerModelTariffSnapshot`, a half-open `CustomerModelTariffAssignment`, and an `AuditEvent`.
   *
   * Business rules:
   * - Checks `idempotencyKey` BEFORE draft status/version checks so exact retries succeed with `idempotentReplay: true` even after the draft transitioned to `PUBLISHED`.
   * - Rejects replays with mismatched `draftId`, `requestFingerprint`, or canonical payload digest (`409` `BillingIdempotencyConflictError`).
   * - Acquires scope-level PostgreSQL `pg_advisory_xact_lock` before allocating the next snapshot version and writing the assignment.
   * - Relies on PostgreSQL `CustomerModelTariffAssignment_no_overlap` (`23P01`) as the final non-overlap guard and rolls back cleanly on failure.
   *
   * Execution flow:
   * 1. Query DB UTC `NOW()` and look up `CustomerModelTariffSnapshot` by `idempotencyKey`.
   * 2. If found, verify fingerprint parity and return the existing draft, snapshot, assignment, and deterministic `auditEventId`.
   * 3. Otherwise validate draft existence, `DRAFT` status, `expectedDraftVersion`, effective interval, runtime allowlist (`EXACT_MODEL`), rate completeness, and canonical `requestFingerprint`.
   * 4. Acquire `pg_advisory_xact_lock`, insert immutable snapshot + assignment, CAS-transition draft to `PUBLISHED`, and write `MODEL_PRICING_PUBLISHED` audit event.
   *
   * Failure cases:
   * - Throws `BillingIdempotencyConflictError`, `ModelPricingNotFoundError`, `ModelPricingImmutableSnapshotError`, `ModelPricingInvalidStateError`, `ModelPricingStaleDraftError`, `ModelPricingUnlistedModelError`, `ModelPricingIncompleteRatesError`, `ModelPricingInvalidIntervalError`, or `ModelPricingOverlapConflictError`.
   *
   * Side effects:
   * - Inserts immutable `CustomerModelTariffSnapshot` and `CustomerModelTariffAssignment`, updates draft to `PUBLISHED`, and inserts `AuditEvent` atomically.
   */
  async publishDraft(
    input: PublishModelTariffDraftRepoInput,
  ): Promise<PublishModelTariffDraftRepoResult> {
    return this.runTxWithRetry(async (tx) => {
      const dbUtcNow = await this.readDbUtcNow(tx);

      // Why: Check idempotencyKey BEFORE draft status/version checks so an exact retry after commit
      // replays cleanly instead of failing with STALE_DRAFT or IMMUTABLE_SNAPSHOT.
      const existingSnapshotRow =
        await tx.customerModelTariffSnapshot.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });

      if (existingSnapshotRow) {
        const existingSnapshot = toSnapshotRecord(existingSnapshotRow);
        const recomputed = computeModelPricingRequestFingerprint({
          action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
          draftId: input.draftId,
          expectedDraftVersion: input.expectedDraftVersion,
          scope: existingSnapshot.scope,
          provider: existingSnapshot.provider,
          resolvedModel: existingSnapshot.resolvedModel,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          auditReason: input.auditReason,
          rates: {
            inputMicrocreditsPerMillion:
              existingSnapshot.inputMicrocreditsPerMillion,
            outputMicrocreditsPerMillion:
              existingSnapshot.outputMicrocreditsPerMillion,
            reasoningPolicy: existingSnapshot.reasoningPolicy,
            reasoningMicrocreditsPerMillion:
              existingSnapshot.reasoningMicrocreditsPerMillion,
            cachedInputPolicy: existingSnapshot.cachedInputPolicy,
            cachedInputMicrocreditsPerMillion:
              existingSnapshot.cachedInputMicrocreditsPerMillion,
            cacheWritePolicy: existingSnapshot.cacheWritePolicy,
            cacheWriteMicrocreditsPerMillion:
              existingSnapshot.cacheWriteMicrocreditsPerMillion,
            cacheWrite5mMicrocreditsPerMillion:
              existingSnapshot.cacheWrite5mMicrocreditsPerMillion,
            cacheWrite1hMicrocreditsPerMillion:
              existingSnapshot.cacheWrite1hMicrocreditsPerMillion,
          },
        });

        if (
          existingSnapshot.sourceDraftId !== input.draftId ||
          existingSnapshot.requestFingerprint !== recomputed ||
          existingSnapshot.requestFingerprint !== input.requestFingerprint
        ) {
          throw new BillingIdempotencyConflictError(
            "Idempotency key already used for a different publish payload",
          );
        }

        const [draftRow, assignmentRow] = await Promise.all([
          tx.customerModelTariffDraft.findUniqueOrThrow({
            where: { id: input.draftId },
          }),
          tx.customerModelTariffAssignment.findFirstOrThrow({
            where: { tariffSnapshotId: existingSnapshot.id },
            orderBy: { createdAt: "asc" },
          }),
        ]);

        return {
          draft: toDraftRecord(draftRow),
          snapshot: existingSnapshot,
          assignment: toAssignmentRecord(assignmentRow),
          auditEventId: computeDeterministicAuditId(
            `model-pricing:publish:${input.idempotencyKey}`,
          ),
          dbUtcNow,
          idempotentReplay: true,
        };
      }

      if (
        input.effectiveTo !== null &&
        input.effectiveTo.getTime() <= input.effectiveFrom.getTime()
      ) {
        throw new ModelPricingInvalidIntervalError(
          "effectiveTo must be strictly greater than effectiveFrom",
        );
      }

      const draftRow = await tx.customerModelTariffDraft.findUnique({
        where: { id: input.draftId },
      });
      if (!draftRow) {
        throw new ModelPricingNotFoundError(
          `Model tariff draft '${input.draftId}' was not found`,
        );
      }

      const draft = toDraftRecord(draftRow);
      if (draft.status === CUSTOMER_TARIFF_DRAFT_STATUSES.published) {
        throw new ModelPricingImmutableSnapshotError(
          "Draft has already been published into an immutable snapshot",
        );
      }
      if (draft.status !== CUSTOMER_TARIFF_DRAFT_STATUSES.draft) {
        throw new ModelPricingInvalidStateError(
          `Draft '${draft.id}' cannot be published from status '${draft.status}'`,
        );
      }
      if (draft.version !== input.expectedDraftVersion) {
        throw new ModelPricingStaleDraftError(
          `Draft '${draft.id}' version ${draft.version} does not match expectedDraftVersion ${input.expectedDraftVersion}`,
        );
      }

      if (draft.scope === MODEL_PRICING_SCOPES.exactModel) {
        this.allowlistService.assertAllowlisted(
          draft.provider ?? "",
          draft.resolvedModel ?? "",
        );
      }
      this.calculatorService.assertCompleteTariffRates(
        toMicrocreditTariffRates(draft),
      );

      const canonicalFingerprint = computeModelPricingRequestFingerprint({
        action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
        draftId: draft.id,
        expectedDraftVersion: input.expectedDraftVersion,
        scope: draft.scope,
        provider: draft.provider,
        resolvedModel: draft.resolvedModel,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        auditReason: input.auditReason,
        rates: {
          inputMicrocreditsPerMillion: draft.inputMicrocreditsPerMillion,
          outputMicrocreditsPerMillion: draft.outputMicrocreditsPerMillion,
          reasoningPolicy: draft.reasoningPolicy,
          reasoningMicrocreditsPerMillion:
            draft.reasoningMicrocreditsPerMillion,
          cachedInputPolicy: draft.cachedInputPolicy,
          cachedInputMicrocreditsPerMillion:
            draft.cachedInputMicrocreditsPerMillion,
          cacheWritePolicy: draft.cacheWritePolicy,
          cacheWriteMicrocreditsPerMillion:
            draft.cacheWriteMicrocreditsPerMillion,
          cacheWrite5mMicrocreditsPerMillion:
            draft.cacheWrite5mMicrocreditsPerMillion,
          cacheWrite1hMicrocreditsPerMillion:
            draft.cacheWrite1hMicrocreditsPerMillion,
        },
      });

      if (input.requestFingerprint !== canonicalFingerprint) {
        throw new BillingIdempotencyConflictError(
          "requestFingerprint does not match canonical publish payload",
        );
      }

      await this.acquireScopeLock(tx, draft.normalizedScopeKey);

      const versionAggregate = await tx.customerModelTariffSnapshot.aggregate({
        where: { normalizedScopeKey: draft.normalizedScopeKey },
        _max: { version: true },
      });
      const nextSnapshotVersion = (versionAggregate._max.version ?? 0) + 1;

      const snapshotRow = await tx.customerModelTariffSnapshot.create({
        data: {
          sourceDraftId: draft.id,
          scope: draftRow.scope,
          provider: draft.provider,
          resolvedModel: draft.resolvedModel,
          normalizedScopeKey: draft.normalizedScopeKey,
          version: nextSnapshotVersion,
          accountingUnitVersion: 1,
          inputMicrocreditsPerMillion: draft.inputMicrocreditsPerMillion,
          outputMicrocreditsPerMillion: draft.outputMicrocreditsPerMillion,
          reasoningPolicy: draftRow.reasoningPolicy,
          reasoningMicrocreditsPerMillion:
            draft.reasoningMicrocreditsPerMillion,
          cachedInputPolicy: draftRow.cachedInputPolicy,
          cachedInputMicrocreditsPerMillion:
            draft.cachedInputMicrocreditsPerMillion,
          cacheWritePolicy: draftRow.cacheWritePolicy,
          cacheWriteMicrocreditsPerMillion:
            draft.cacheWriteMicrocreditsPerMillion,
          cacheWrite5mMicrocreditsPerMillion:
            draft.cacheWrite5mMicrocreditsPerMillion,
          cacheWrite1hMicrocreditsPerMillion:
            draft.cacheWrite1hMicrocreditsPerMillion,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: canonicalFingerprint,
          publishedBy: input.actorId,
          auditReason: input.auditReason,
          publishedAt: dbUtcNow,
        },
      });

      // PostgreSQL GiST constraint `CustomerModelTariffAssignment_no_overlap` (23P01) enforces
      // `[effectiveFrom, effectiveTo)` non-overlap per `normalizedScopeKey` at insert time.
      const assignmentRow = await tx.customerModelTariffAssignment.create({
        data: {
          tariffSnapshotId: snapshotRow.id,
          scope: draftRow.scope,
          normalizedScopeKey: draft.normalizedScopeKey,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          version: 1,
          auditReason: input.auditReason,
          createdBy: input.actorId,
        },
      });

      const cas = await tx.customerModelTariffDraft.updateMany({
        where: {
          id: draft.id,
          status: toPrismaCustomerTariffDraftStatus(
            CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
          ),
          version: input.expectedDraftVersion,
        },
        data: {
          status: toPrismaCustomerTariffDraftStatus(
            CUSTOMER_TARIFF_DRAFT_STATUSES.published,
          ),
          publishedSnapshotId: snapshotRow.id,
          updatedBy: input.actorId,
          version: { increment: 1 },
        },
      });

      if (cas.count !== 1) {
        throw new ModelPricingStaleDraftError(
          `Draft '${draft.id}' was modified concurrently during publish`,
        );
      }

      const updatedDraftRow =
        await tx.customerModelTariffDraft.findUniqueOrThrow({
          where: { id: draft.id },
        });

      const auditEventId = await this.auditWriter.writeInTxReturningId(
        {
          eventType: MODEL_PRICING_AUDIT_EVENT_TYPES.published,
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.customerModelTariff,
          resourceId: snapshotRow.id,
          idempotencyKey: `model-pricing:publish:${input.idempotencyKey}`,
          reasonCode: input.auditReason,
          correlationId: input.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: AUDIT_EVENT_RESULTS.success,
          payload: {
            action: MODEL_PRICING_AUDIT_EVENT_TYPES.published,
            draftId: draft.id,
            snapshotId: snapshotRow.id,
            assignmentId: assignmentRow.id,
            scope: draft.scope,
            scopeKey: draft.normalizedScopeKey,
            snapshotVersion: nextSnapshotVersion,
            effectiveFrom: input.effectiveFrom.toISOString(),
            effectiveTo: input.effectiveTo
              ? input.effectiveTo.toISOString()
              : null,
            idempotencyKey: input.idempotencyKey,
            auditReason: input.auditReason,
          },
        },
        tx,
      );

      return {
        draft: toDraftRecord(updatedDraftRow),
        snapshot: toSnapshotRecord(snapshotRow),
        assignment: toAssignmentRecord(assignmentRow),
        auditEventId,
        dbUtcNow,
        idempotentReplay: false,
      };
    });
  }

  /**
   * Business purpose: Atomically supersede an active or scheduled assignment with a new replacement assignment without ever mutating historical snapshots.
   *
   * Business rules:
   * - Checks `supersedeIdempotencyKey` BEFORE assignment status/version checks so exact retries replay cleanly with `idempotentReplay: true`.
   * - Re-verifies `expectedAssignmentVersion` (`existing.version - 1`) on replay when provided to catch conflicting retries.
   * - Rejects any replacement `effectiveFrom` in the past (`effectiveFrom < dbUtcNow`), preventing retroactive pricing changes and preserving historical billing auditability.
   * - For an active assignment (`target.effectiveFrom <= dbUtcNow`), requires `effectiveFrom >= dbUtcNow` and strictly `effectiveFrom > target.effectiveFrom`.
   * - Updates the superseded assignment BEFORE inserting the replacement assignment so non-deferrable `23P01` exclusion allows adjacent `[t1, t2)` + `[t2, null)`.
   * - Cancels future `SCHEDULED` assignments (`cancelledAt = dbUtcNow`) when `newEffectiveFrom <= old.effectiveFrom`, while rejecting `newEffectiveFrom <= old.effectiveFrom` on `ACTIVE` assignments.
   * - Never updates or deletes any `CustomerModelTariffSnapshot` row.
   *
   * Execution flow:
   * 1. Query DB UTC `NOW()` and check `supersedeIdempotencyKey` for replay or conflict.
   * 2. Verify canonical `requestFingerprint`, target assignment existence/state/version, and acquire `pg_advisory_xact_lock`.
   * 3. Resolve replacement authority via `replacementDraftId` (publishing a new immutable snapshot) OR existing `replacementSnapshotId`.
   * 4. Update the target assignment first (`effectiveTo` or `cancelledAt`), insert replacement assignment, and write `MODEL_PRICING_ASSIGNMENT_SUPERSEDED` audit event.
   *
   * Failure cases:
   * - Throws `BillingIdempotencyConflictError`, `ModelPricingNotFoundError`, `ModelPricingInvalidStateError`, `ModelPricingStaleDraftError`, `ModelPricingInvalidIntervalError`, `InvalidBillingInputError`, or `ModelPricingOverlapConflictError`.
   *
   * Side effects:
   * - Updates the superseded `CustomerModelTariffAssignment`, inserts replacement assignment (and new snapshot if from draft), and writes `AuditEvent` atomically.
   */
  async supersedeAssignment(
    input: SupersedeModelTariffAssignmentRepoInput,
  ): Promise<SupersedeModelTariffAssignmentRepoResult> {
    return this.runTxWithRetry(async (tx) => {
      const dbUtcNow = await this.readDbUtcNow(tx);

      const canonicalFingerprint = computeModelPricingRequestFingerprint({
        action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
        assignmentId: input.assignmentId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        replacementDraftId: input.replacementDraftId ?? null,
        replacementSnapshotId: input.replacementSnapshotId ?? null,
        auditReason: input.auditReason,
      });

      const existingSupersededRow =
        await tx.customerModelTariffAssignment.findUnique({
          where: { supersedeIdempotencyKey: input.idempotencyKey },
        });

      if (existingSupersededRow) {
        const existingSuperseded = toAssignmentRecord(existingSupersededRow);
        const versionMatches =
          input.expectedAssignmentVersion === undefined ||
          existingSuperseded.version - 1 === input.expectedAssignmentVersion;

        if (
          existingSuperseded.id !== input.assignmentId ||
          existingSuperseded.supersedeRequestFingerprint !==
            canonicalFingerprint ||
          input.requestFingerprint !== canonicalFingerprint ||
          !versionMatches ||
          !existingSuperseded.supersededByAssignmentId
        ) {
          throw new BillingIdempotencyConflictError(
            "Supersede idempotency key already used for a different payload or assignment",
          );
        }

        const replacementAssignmentRow =
          await tx.customerModelTariffAssignment.findUniqueOrThrow({
            where: { id: existingSuperseded.supersededByAssignmentId },
          });
        const replacementSnapshotRow =
          await tx.customerModelTariffSnapshot.findUniqueOrThrow({
            where: { id: replacementAssignmentRow.tariffSnapshotId },
          });

        return {
          supersededAssignment: existingSuperseded,
          replacementAssignment: toAssignmentRecord(replacementAssignmentRow),
          replacementSnapshot: toSnapshotRecord(replacementSnapshotRow),
          auditEventId: computeDeterministicAuditId(
            `model-pricing:supersede:${input.idempotencyKey}`,
          ),
          dbUtcNow,
          idempotentReplay: true,
        };
      }

      if (input.requestFingerprint !== canonicalFingerprint) {
        throw new BillingIdempotencyConflictError(
          "requestFingerprint does not match canonical supersede payload",
        );
      }

      if (
        input.effectiveTo !== null &&
        input.effectiveTo.getTime() <= input.effectiveFrom.getTime()
      ) {
        throw new ModelPricingInvalidIntervalError(
          "effectiveTo must be strictly greater than effectiveFrom",
        );
      }

      const targetRow = await tx.customerModelTariffAssignment.findUnique({
        where: { id: input.assignmentId },
      });
      if (!targetRow) {
        throw new ModelPricingNotFoundError(
          `Model tariff assignment '${input.assignmentId}' was not found`,
        );
      }

      const target = toAssignmentRecord(targetRow);
      if (
        target.supersededByAssignmentId !== null ||
        target.cancelledAt !== null
      ) {
        throw new ModelPricingInvalidStateError(
          `Assignment '${target.id}' has already been superseded or cancelled`,
        );
      }
      if (
        target.effectiveTo !== null &&
        target.effectiveTo.getTime() <= dbUtcNow.getTime()
      ) {
        throw new ModelPricingInvalidStateError(
          `Assignment '${target.id}' has already expired`,
        );
      }
      if (
        input.expectedAssignmentVersion !== undefined &&
        target.version !== input.expectedAssignmentVersion
      ) {
        throw new ModelPricingStaleDraftError(
          `Assignment '${target.id}' version ${target.version} does not match expectedAssignmentVersion ${input.expectedAssignmentVersion}`,
        );
      }
      if (
        target.effectiveTo !== null &&
        input.effectiveFrom.getTime() > target.effectiveTo.getTime()
      ) {
        throw new ModelPricingInvalidIntervalError(
          "Supersede effectiveFrom cannot exceed the target assignment effectiveTo boundary",
        );
      }

      await this.acquireScopeLock(tx, target.normalizedScopeKey);

      let replacementSnapshot: ModelTariffSnapshotRecord;
      if (input.replacementDraftId) {
        const draftRow = await tx.customerModelTariffDraft.findUnique({
          where: { id: input.replacementDraftId },
        });
        if (!draftRow) {
          throw new ModelPricingNotFoundError(
            `Replacement tariff draft '${input.replacementDraftId}' was not found`,
          );
        }
        const draft = toDraftRecord(draftRow);
        if (draft.status === CUSTOMER_TARIFF_DRAFT_STATUSES.published) {
          throw new ModelPricingImmutableSnapshotError(
            "Replacement draft has already been published",
          );
        }
        if (draft.status !== CUSTOMER_TARIFF_DRAFT_STATUSES.draft) {
          throw new ModelPricingInvalidStateError(
            `Replacement draft '${draft.id}' is not in DRAFT status`,
          );
        }
        if (
          input.expectedDraftVersion !== undefined &&
          draft.version !== input.expectedDraftVersion
        ) {
          throw new ModelPricingStaleDraftError(
            `Replacement draft '${draft.id}' version ${draft.version} does not match expectedDraftVersion ${input.expectedDraftVersion}`,
          );
        }
        if (draft.normalizedScopeKey !== target.normalizedScopeKey) {
          throw new InvalidBillingInputError(
            "Replacement draft scope does not match target assignment scope",
          );
        }
        if (draft.scope === MODEL_PRICING_SCOPES.exactModel) {
          this.allowlistService.assertAllowlisted(
            draft.provider ?? "",
            draft.resolvedModel ?? "",
          );
        }
        this.calculatorService.assertCompleteTariffRates(
          toMicrocreditTariffRates(draft),
        );

        const versionAggregate = await tx.customerModelTariffSnapshot.aggregate(
          {
            where: { normalizedScopeKey: draft.normalizedScopeKey },
            _max: { version: true },
          },
        );
        const nextSnapshotVersion = (versionAggregate._max.version ?? 0) + 1;

        const createdSnapshotRow = await tx.customerModelTariffSnapshot.create({
          data: {
            sourceDraftId: draft.id,
            scope: draftRow.scope,
            provider: draft.provider,
            resolvedModel: draft.resolvedModel,
            normalizedScopeKey: draft.normalizedScopeKey,
            version: nextSnapshotVersion,
            accountingUnitVersion: 1,
            inputMicrocreditsPerMillion: draft.inputMicrocreditsPerMillion,
            outputMicrocreditsPerMillion: draft.outputMicrocreditsPerMillion,
            reasoningPolicy: draftRow.reasoningPolicy,
            reasoningMicrocreditsPerMillion:
              draft.reasoningMicrocreditsPerMillion,
            cachedInputPolicy: draftRow.cachedInputPolicy,
            cachedInputMicrocreditsPerMillion:
              draft.cachedInputMicrocreditsPerMillion,
            cacheWritePolicy: draftRow.cacheWritePolicy,
            cacheWriteMicrocreditsPerMillion:
              draft.cacheWriteMicrocreditsPerMillion,
            cacheWrite5mMicrocreditsPerMillion:
              draft.cacheWrite5mMicrocreditsPerMillion,
            cacheWrite1hMicrocreditsPerMillion:
              draft.cacheWrite1hMicrocreditsPerMillion,
            idempotencyKey: `supersede:${input.idempotencyKey}`,
            requestFingerprint: canonicalFingerprint,
            publishedBy: input.actorId,
            auditReason: input.auditReason,
            publishedAt: dbUtcNow,
          },
        });

        const draftCas = await tx.customerModelTariffDraft.updateMany({
          where: {
            id: draft.id,
            status: toPrismaCustomerTariffDraftStatus(
              CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
            ),
            version: draft.version,
          },
          data: {
            status: toPrismaCustomerTariffDraftStatus(
              CUSTOMER_TARIFF_DRAFT_STATUSES.published,
            ),
            publishedSnapshotId: createdSnapshotRow.id,
            updatedBy: input.actorId,
            version: { increment: 1 },
          },
        });
        if (draftCas.count !== 1) {
          throw new ModelPricingStaleDraftError(
            `Replacement draft '${draft.id}' was modified concurrently`,
          );
        }

        replacementSnapshot = toSnapshotRecord(createdSnapshotRow);
      } else {
        const snapshotRow = await tx.customerModelTariffSnapshot.findUnique({
          where: { id: input.replacementSnapshotId },
        });
        if (!snapshotRow) {
          throw new ModelPricingNotFoundError(
            `Replacement tariff snapshot '${input.replacementSnapshotId}' was not found`,
          );
        }
        replacementSnapshot = toSnapshotRecord(snapshotRow);
        if (
          replacementSnapshot.normalizedScopeKey !== target.normalizedScopeKey
        ) {
          throw new InvalidBillingInputError(
            "Replacement snapshot scope does not match target assignment scope",
          );
        }
        if (replacementSnapshot.scope === MODEL_PRICING_SCOPES.exactModel) {
          this.allowlistService.assertAllowlisted(
            replacementSnapshot.provider ?? "",
            replacementSnapshot.resolvedModel ?? "",
          );
        }
        this.calculatorService.assertCompleteTariffRates(
          toMicrocreditTariffRates(replacementSnapshot),
        );
      }

      const replacementAssignmentId = randomUUID();
      const newStartsAfterTarget =
        input.effectiveFrom.getTime() > target.effectiveFrom.getTime();

      // Rationale ("Why"): Forbid retroactive pricing changes. Any new assignment created via supersede
      // MUST NOT take effect in the past (effectiveFrom < dbUtcNow), protecting historical billing auditability
      // and preventing silent distortion of historical usage settlements or pricing lookup quotes.
      // Execution mechanism ("How"): Checks input.effectiveFrom against the authoritative database clock (dbUtcNow).
      // Rejects any timestamp in the past with ModelPricingInvalidIntervalError.
      // Invariants & Constraints: For active assignments (target.effectiveFrom <= dbUtcNow), replacement effectiveFrom >= dbUtcNow is strictly enforced.
      // Immediate price rotation (effectiveFrom == dbUtcNow) and future scheduled rotations (effectiveFrom > dbUtcNow) are permitted.
      if (input.effectiveFrom.getTime() < dbUtcNow.getTime()) {
        throw new ModelPricingInvalidIntervalError(
          "Cannot supersede an assignment with retroactive effectiveFrom in the past (effectiveFrom < dbUtcNow)",
        );
      }

      if (target.effectiveFrom <= dbUtcNow && !newStartsAfterTarget) {
        throw new ModelPricingInvalidIntervalError(
          "Cannot supersede an active assignment with effectiveFrom <= existing effectiveFrom",
        );
      }

      // Why: `CustomerModelTariffAssignment_no_overlap` is non-deferrable, so the prior interval
      // MUST be truncated or cancelled FIRST before inserting `[newEffectiveFrom, newEffectiveTo)`.
      const targetCas = await tx.customerModelTariffAssignment.updateMany({
        where: {
          id: target.id,
          version: target.version,
          supersededByAssignmentId: null,
          cancelledAt: null,
        },
        data: {
          ...(newStartsAfterTarget
            ? { effectiveTo: input.effectiveFrom }
            : { cancelledAt: dbUtcNow }),
          supersededByAssignmentId: replacementAssignmentId,
          supersededBy: input.actorId,
          supersededAt: dbUtcNow,
          supersedeIdempotencyKey: input.idempotencyKey,
          supersedeRequestFingerprint: canonicalFingerprint,
          auditReason: input.auditReason,
          version: { increment: 1 },
        },
      });
      if (targetCas.count !== 1) {
        throw new ModelPricingStaleDraftError(
          `Assignment '${target.id}' was concurrently modified`,
        );
      }

      const replacementAssignmentRow =
        await tx.customerModelTariffAssignment.create({
          data: {
            id: replacementAssignmentId,
            tariffSnapshotId: replacementSnapshot.id,
            scope: targetRow.scope,
            normalizedScopeKey: target.normalizedScopeKey,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            version: 1,
            auditReason: input.auditReason,
            createdBy: input.actorId,
          },
        });

      const supersededRow =
        await tx.customerModelTariffAssignment.findUniqueOrThrow({
          where: { id: target.id },
        });

      const auditEventId = await this.auditWriter.writeInTxReturningId(
        {
          eventType: MODEL_PRICING_AUDIT_EVENT_TYPES.assignmentSuperseded,
          actorId: input.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.customerModelTariff,
          resourceId: target.id,
          idempotencyKey: `model-pricing:supersede:${input.idempotencyKey}`,
          reasonCode: input.auditReason,
          correlationId: input.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: AUDIT_EVENT_RESULTS.success,
          payload: {
            action: MODEL_PRICING_AUDIT_EVENT_TYPES.assignmentSuperseded,
            supersededAssignmentId: target.id,
            replacementAssignmentId: replacementAssignmentRow.id,
            replacementSnapshotId: replacementSnapshot.id,
            scope: target.scope,
            scopeKey: target.normalizedScopeKey,
            effectiveFrom: input.effectiveFrom.toISOString(),
            effectiveTo: input.effectiveTo
              ? input.effectiveTo.toISOString()
              : null,
            idempotencyKey: input.idempotencyKey,
            auditReason: input.auditReason,
          },
        },
        tx,
      );

      return {
        supersededAssignment: toAssignmentRecord(supersededRow),
        replacementAssignment: toAssignmentRecord(replacementAssignmentRow),
        replacementSnapshot,
        auditEventId,
        dbUtcNow,
        idempotentReplay: false,
      };
    });
  }

  private async readDbUtcNow(
    client: PrismaService | Prisma.TransactionClient,
  ): Promise<Date> {
    const rows = await client.$queryRaw<Array<{ dbUtcNow: Date }>>`
      SELECT NOW() AS "dbUtcNow"
    `;
    return rows[0]?.dbUtcNow ?? new Date();
  }

  private async acquireScopeLock(
    tx: Prisma.TransactionClient,
    normalizedScopeKey: string,
  ): Promise<void> {
    const lockName = `model_pricing_scope:${normalizedScopeKey}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockName}))
    `;
  }

  private async runTxWithRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation);
      } catch (error) {
        if (attempt < MAX_TX_RETRIES && isRetryableTransactionConflict(error)) {
          continue;
        }
        mapPrismaModelPricingPersistenceError(error);
      }
    }
    throw new Error("Unreachable transaction retry termination");
  }
}

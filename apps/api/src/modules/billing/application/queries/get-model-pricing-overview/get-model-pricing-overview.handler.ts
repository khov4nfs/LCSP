import { Inject, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  MODEL_PRICING_SCOPES,
  normalizeModelPricingScopeKey,
  type AdminModelPricingOverviewResponse,
  type ModelPricingAllowlistedModelView,
  type ModelPricingCoverageRow,
  type ModelPricingScope,
} from "@lcsp/contracts/billing";
import type { AppConfig } from "../../../../../config/config.types.js";
import {
  ModelPricingInvalidIntervalError,
  ModelPricingNoCoverageError,
} from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
  type ModelTariffAssignmentRecord,
  type ModelTariffSnapshotRecord,
} from "../../../domain/repositories/model-pricing.port.js";
import {
  deriveAssignmentStatus,
  readSafeModelUsageDebitMode,
  toMicrocreditTariffRates,
  toModelTariffAssignmentView,
  toModelTariffDraftView,
  toModelTariffRateScheduleView,
  toModelTariffSnapshotView,
} from "../../mappers/model-pricing-view.mapper.js";
import {
  ModelPricingCalculatorService,
  type TariffCandidate,
} from "../../shared/model-pricing-calculator.service.js";
import { RuntimeModelAllowlistService } from "../../shared/runtime-model-allowlist.service.js";
import { GetModelPricingOverviewQuery } from "./get-model-pricing-overview.query.js";

const SCOPE_PRECEDENCE_RANK: Readonly<Record<ModelPricingScope, number>> = {
  [MODEL_PRICING_SCOPES.exactModel]: 0,
  [MODEL_PRICING_SCOPES.providerDefault]: 1,
  [MODEL_PRICING_SCOPES.globalDefault]: 2,
};

/**
 * Business purpose: Map a resolved pricing scope (or uncovered null) to its numeric sort rank for deterministic Admin overview ordering.
 *
 * Business rules:
 * - Orders `EXACT_MODEL` (0) -> `PROVIDER_DEFAULT` (1) -> `GLOBAL_DEFAULT` (2) -> uncovered `null` (3).
 *
 * Execution flow:
 * 1. Return rank 3 for `null`, otherwise look up `SCOPE_PRECEDENCE_RANK[scope]`.
 *
 * Failure cases:
 * - None: total mapping over `ModelPricingScope | null`.
 *
 * Side effects:
 * - None: pure sort comparator helper.
 */
/**
 * Business purpose: Return numeric precedence rank for sorting model pricing scopes in overview coverage tables.
 *
 * Business rules:
 * - EXACT_MODEL has highest rank (0).
 * - PROVIDER_DEFAULT has intermediate rank (1).
 * - GLOBAL_DEFAULT has fallback rank (2).
 * - Null scope (uncovered) has lowest rank (3).
 *
 * Execution flow:
 * 1. Check if scope is null; if so, return 3.
 * 2. Look up rank in SCOPE_PRECEDENCE_RANK and return number.
 *
 * Failure cases:
 * - Pure rank lookup; does not fail for valid ModelPricingScope values.
 *
 * Side effects:
 * - Pure ranking calculation.
 */
// Rationale ("Why"): Orders coverage table entries so highest-specificity tariffs appear first.
// Mechanism ("How"): Maps scope to numeric integer index (0..3).
// Invariants & Constraints: Consistent precedence ordering across overview responses.
/**
 * Business purpose: Calculate integer precedence rank for pricing scopes to sort coverage table rows correctly.
 *
 * Business rules:
 * - EXACT_MODEL has highest precedence (0).
 * - PROVIDER_DEFAULT has secondary precedence (1).
 * - GLOBAL_DEFAULT has fallback precedence (2).
 * - Null/uncovered scope ranks lowest (3).
 *
 * Execution flow:
 * 1. Check if scope is null; if so, return 3.
 * 2. Look up rank in SCOPE_PRECEDENCE_RANK and return number.
 *
 * Failure cases:
 * - None; covers all enum members and null.
 *
 * Side effects:
 * - Pure comparator ranking; no state modifications.
 */
function getScopeRank(scope: ModelPricingScope | null): number {
  return scope === null ? 3 : SCOPE_PRECEDENCE_RANK[scope];
}

@QueryHandler(GetModelPricingOverviewQuery)
export class GetModelPricingOverviewHandler implements IQueryHandler<GetModelPricingOverviewQuery> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
    private readonly allowlistService: RuntimeModelAllowlistService,
    private readonly calculatorService: ModelPricingCalculatorService,
    @Optional()
    private readonly configService?: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Business purpose: Assemble the read-only Admin Model Pricing overview including allowlisted models, coverage resolution, active/scheduled/superseded assignments, drafts, and immutable snapshots.
   *
   * Business rules:
   * - Reads `debitMode` from `ConfigService` (`OFF` default; fails closed if `ON`).
   * - Derives assignment statuses (`SCHEDULED`, `ACTIVE`, `SUPERSEDED`) deterministically at DB UTC `NOW()` (or `activeAt`).
   * - Resolves coverage for every allowlisted `(provider, resolvedModel)` using `EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT`, surfacing uncovered gaps with `hasCoverage: false`.
   * - Orders coverage rows by scope precedence (`EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT` -> uncovered).
   *
   * Execution flow:
   * 1. Validate `debitMode` posture and optional `activeAt` UTC timestamp.
   * 2. Load parsed runtime allowlist routes and fetch overview rows + DB UTC clock from `repo.listOverviewData`.
   * 3. Build active tariff candidates at `referenceTime` and resolve coverage for each unique allowlisted model.
   * 4. Apply optional query filters (`provider`, `resolvedModel`, `scope`, `status`), sort coverage, and return DTO response.
   *
   * Failure cases:
   * - Throws `BillingDomainError` if `MODEL_USAGE_DEBIT=ON`.
   * - Throws `ModelPricingInvalidIntervalError` if `activeAt` is invalid.
   *
   * Side effects:
   * - None: read-only query.
   */
  async execute(
    query: GetModelPricingOverviewQuery,
  ): Promise<AdminModelPricingOverviewResponse> {
    // Why: Admins need one authoritative read-only view showing active coverage, fallback precedence, drafts, and immutable history.
    // How: Combines runtime allowlist routes with DB UTC-evaluated assignments and shared `ModelPricingCalculatorService` precedence resolution.
    // Invariants: Never synthesizes `1.8x` defaults for uncovered models and never allows `MODEL_USAGE_DEBIT=ON`.
    const debitMode = readSafeModelUsageDebitMode(this.configService);
    const filter = query.input;

    let explicitActiveAt: Date | undefined;
    if (filter.activeAt !== undefined) {
      explicitActiveAt = new Date(filter.activeAt);
      if (!Number.isFinite(explicitActiveAt.getTime())) {
        throw new ModelPricingInvalidIntervalError(
          "Invalid activeAt UTC timestamp",
        );
      }
    }

    const parsedRoutes = this.allowlistService.getParsedRoutes();
    // Why: Load all scopes into overviewData before filtering so coverage precedence
    // (`EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT`) does not falsely resolve
    // an EXACT_MODEL-covered model as falling back to PROVIDER_DEFAULT/GLOBAL_DEFAULT when `?scope=` is set.
    const overviewData = await this.repo.listOverviewData({
      provider: filter.provider,
      resolvedModel: filter.resolvedModel,
    });
    const referenceTime = explicitActiveAt ?? overviewData.dbUtcNow;

    const normalizedProviderFilter = filter.provider?.trim().toLowerCase();
    const trimmedModelFilter = filter.resolvedModel?.trim();

    const routeById = new Map(
      parsedRoutes.entries.map((entry) => [entry.routeId, entry]),
    );
    const allowlistedModels: ModelPricingAllowlistedModelView[] = [];
    for (const [role, routeKey] of Object.entries(parsedRoutes.roles)) {
      const entry = routeById.get(routeKey);
      if (!entry) {
        continue;
      }
      if (
        normalizedProviderFilter &&
        entry.provider.toLowerCase() !== normalizedProviderFilter
      ) {
        continue;
      }
      if (trimmedModelFilter && entry.model !== trimmedModelFilter) {
        continue;
      }
      allowlistedModels.push({
        role,
        routeKey,
        provider: entry.provider.toLowerCase(),
        resolvedModel: entry.model,
      });
    }

    const snapshotById = new Map<string, ModelTariffSnapshotRecord>(
      overviewData.snapshots.map((snapshot) => [snapshot.id, snapshot]),
    );
    const assignmentById = new Map<string, ModelTariffAssignmentRecord>(
      overviewData.assignments.map((assignment) => [assignment.id, assignment]),
    );

    const activeCandidates: TariffCandidate[] = [];
    for (const assignment of overviewData.assignments) {
      if (
        assignment.cancelledAt !== null ||
        assignment.effectiveFrom.getTime() > referenceTime.getTime() ||
        (assignment.effectiveTo !== null &&
          assignment.effectiveTo.getTime() <= referenceTime.getTime())
      ) {
        continue;
      }
      const snapshot = snapshotById.get(assignment.tariffSnapshotId);
      if (!snapshot) {
        continue;
      }
      activeCandidates.push({
        scope: snapshot.scope,
        normalizedScopeKey: snapshot.normalizedScopeKey,
        snapshotId: snapshot.id,
        assignmentId: assignment.id,
        version: snapshot.version,
        ratesMicrocreditsPerMillion: toMicrocreditTariffRates(snapshot),
      });
    }

    const uniqueModels = new Map<
      string,
      { provider: string; resolvedModel: string }
    >();
    for (const entry of parsedRoutes.entries) {
      const normalizedProvider = entry.provider.toLowerCase();
      if (
        normalizedProviderFilter &&
        normalizedProvider !== normalizedProviderFilter
      ) {
        continue;
      }
      if (trimmedModelFilter && entry.model !== trimmedModelFilter) {
        continue;
      }
      const pairKey = `${normalizedProvider}:${entry.model}`;
      if (!uniqueModels.has(pairKey)) {
        uniqueModels.set(pairKey, {
          provider: normalizedProvider,
          resolvedModel: entry.model,
        });
      }
    }

    const coverage: ModelPricingCoverageRow[] = [];
    for (const modelPair of uniqueModels.values()) {
      const exactScopeKey = normalizeModelPricingScopeKey(
        MODEL_PRICING_SCOPES.exactModel,
        modelPair.provider,
        modelPair.resolvedModel,
      );

      try {
        const selected = this.calculatorService.resolveEffectiveTariff({
          provider: modelPair.provider,
          resolvedModel: modelPair.resolvedModel,
          candidates: activeCandidates,
        });
        const assignment = assignmentById.get(selected.assignmentId);
        const snapshot = snapshotById.get(selected.snapshotId);
        if (!assignment || !snapshot) {
          continue;
        }
        if (filter.scope && selected.scope !== filter.scope) {
          continue;
        }

        coverage.push({
          provider: modelPair.provider,
          resolvedModel: modelPair.resolvedModel,
          normalizedScopeKey: exactScopeKey,
          hasCoverage: true,
          resolvedScope: selected.scope,
          fallbackSource: selected.scope,
          assignmentId: assignment.id,
          snapshotId: snapshot.id,
          snapshotVersion: snapshot.version,
          effectiveFrom: assignment.effectiveFrom.toISOString(),
          effectiveTo: assignment.effectiveTo
            ? assignment.effectiveTo.toISOString()
            : null,
          rates: toModelTariffRateScheduleView(snapshot),
        });
      } catch (error) {
        if (error instanceof ModelPricingNoCoverageError) {
          if (filter.scope) {
            continue;
          }
          coverage.push({
            provider: modelPair.provider,
            resolvedModel: modelPair.resolvedModel,
            normalizedScopeKey: exactScopeKey,
            hasCoverage: false,
            resolvedScope: null,
            fallbackSource: null,
            assignmentId: null,
            snapshotId: null,
            snapshotVersion: null,
            effectiveFrom: null,
            effectiveTo: null,
            rates: null,
          });
          continue;
        }
        throw error;
      }
    }

    coverage.sort((left, right) => {
      const rankDiff =
        getScopeRank(left.resolvedScope) - getScopeRank(right.resolvedScope);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      const providerDiff = left.provider.localeCompare(right.provider);
      if (providerDiff !== 0) {
        return providerDiff;
      }
      return left.resolvedModel.localeCompare(right.resolvedModel);
    });

    const drafts = overviewData.drafts
      .filter((draft) => {
        if (filter.scope && draft.scope !== filter.scope) {
          return false;
        }
        if (
          normalizedProviderFilter &&
          draft.provider?.toLowerCase() !== normalizedProviderFilter
        ) {
          return false;
        }
        if (trimmedModelFilter && draft.resolvedModel !== trimmedModelFilter) {
          return false;
        }
        return true;
      })
      .map(toModelTariffDraftView);

    const snapshots = overviewData.snapshots
      .filter((snapshot) => {
        if (filter.scope && snapshot.scope !== filter.scope) {
          return false;
        }
        if (
          normalizedProviderFilter &&
          snapshot.provider?.toLowerCase() !== normalizedProviderFilter
        ) {
          return false;
        }
        if (
          trimmedModelFilter &&
          snapshot.resolvedModel !== trimmedModelFilter
        ) {
          return false;
        }
        return true;
      })
      .map(toModelTariffSnapshotView);

    const assignments = overviewData.assignments
      .filter((assignment) => {
        if (filter.scope && assignment.scope !== filter.scope) {
          return false;
        }
        const snapshot = snapshotById.get(assignment.tariffSnapshotId);
        if (
          normalizedProviderFilter &&
          snapshot?.provider?.toLowerCase() !== normalizedProviderFilter
        ) {
          return false;
        }
        if (
          trimmedModelFilter &&
          snapshot?.resolvedModel !== trimmedModelFilter
        ) {
          return false;
        }
        if (
          filter.status &&
          deriveAssignmentStatus(assignment, referenceTime) !== filter.status
        ) {
          return false;
        }
        return true;
      })
      .map((assignment) =>
        toModelTariffAssignmentView(assignment, referenceTime),
      );

    return {
      debitMode,
      dbUtcNow: overviewData.dbUtcNow.toISOString(),
      allowlistedModels,
      coverage,
      assignments,
      drafts,
      snapshots,
    };
  }
}

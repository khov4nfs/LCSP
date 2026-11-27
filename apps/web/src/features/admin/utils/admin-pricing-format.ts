import {
  MODEL_PRICING_SCOPES,
  formatMicrocreditsToDecimal,
  type AdminModelPricingOverviewResponse,
  type ModelPricingCoverageRow,
  type ModelPricingScope,
  type ModelTariffAssignmentView,
  type ModelTariffDraftView,
  type ModelTariffSnapshotView,
} from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";

import type { AdminPricingFilters } from "../schemas/admin-pricing.schema";

const SCOPE_PRECEDENCE_RANK: Record<ModelPricingScope, number> = {
  [MODEL_PRICING_SCOPES.exactModel]: 0,
  [MODEL_PRICING_SCOPES.providerDefault]: 1,
  [MODEL_PRICING_SCOPES.globalDefault]: 2,
};

export type FormattedMicrocreditRate = {
  microcreditsRaw: string;
  microcreditsFormatted: string;
  creditsDecimal: string;
};

/**
 * Business purpose: Format a microcredit-per-million rate string into grouped integer microcredits
 *   and exact base-10 public credits without floating-point rounding drift.
 *
 * Business rules:
 * - Parse the wire integer string strictly as `BigInt` (never `Number`) so precision is lossless.
 * - Derive the public decimal credit equivalent exclusively via `@lcsp/contracts/billing`'s
 *   `formatMicrocreditsToDecimal`.
 *
 * Execution flow:
 * 1. Parse `microcredits` into a `bigint`.
 * 2. Format the grouped integer with `Intl.NumberFormat(locale)` (no scientific notation).
 * 3. Format exact public credits with `formatMicrocreditsToDecimal`.
 *
 * Failure cases:
 * - Throws if `microcredits` is not a valid base-10 integer string.
 *
 * Side effects:
 * - None: pure deterministic formatting.
 */
export function formatMicrocreditRate(
  microcredits: string,
  locale: Locale,
): FormattedMicrocreditRate {
  // Why: Admin pricing tables must show exact integer microcredits alongside exact decimal credits
  // without IEEE-754 floating-point drift on large per-million token rates.
  // How: Convert wire string to `BigInt`, group via `Intl.NumberFormat`, and delegate decimal math
  // to `formatMicrocreditsToDecimal`.
  // Invariants: Zero floating-point arithmetic occurs in this formatter.
  const amount = BigInt(microcredits);
  return {
    microcreditsRaw: amount.toString(),
    microcreditsFormatted: new Intl.NumberFormat(locale).format(amount),
    creditsDecimal: formatMicrocreditsToDecimal(amount),
  };
}

/**
 * Business purpose: Sort effective pricing coverage rows strictly by canonical resolution precedence
 *   (`EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT` -> uncovered gaps).
 *
 * Business rules:
 * - `EXACT_MODEL` always sorts before `PROVIDER_DEFAULT`, which sorts before `GLOBAL_DEFAULT`.
 * - Missing coverage rows (`hasCoverage === false` / `fallbackSource === null`) sort after covered rows.
 * - Ties break deterministically by `provider` then `resolvedModel`.
 *
 * Execution flow:
 * 1. Assign a precedence rank to each row using `fallbackSource ?? resolvedScope`.
 * 2. Sort a shallow copy by rank, then provider, then resolvedModel.
 *
 * Failure cases:
 * - None: defensive fallback rank places unknown/null scopes last.
 *
 * Side effects:
 * - None: returns a newly sorted array without mutating the input array.
 */
export function sortCoverageByPrecedence(
  rows: readonly ModelPricingCoverageRow[],
): ModelPricingCoverageRow[] {
  // Why: Guarantees UI display order matches ADR-028 pricing resolution precedence regardless of upstream array order.
  // How: Maps canonical `MODEL_PRICING_SCOPES` to numeric ranks 0..2 and ranks uncovered gaps at 3.
  // Invariants: Does not mutate the React Query cached `coverage` array.
  return [...rows].sort((a, b) => {
    const scopeA = a.fallbackSource ?? a.resolvedScope;
    const scopeB = b.fallbackSource ?? b.resolvedScope;
    const rankA = scopeA ? (SCOPE_PRECEDENCE_RANK[scopeA] ?? 3) : 3;
    const rankB = scopeB ? (SCOPE_PRECEDENCE_RANK[scopeB] ?? 3) : 3;

    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const providerCmp = a.provider.localeCompare(b.provider);
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return a.resolvedModel.localeCompare(b.resolvedModel);
  });
}

export type FilteredAdminPricingOverview = {
  coverage: ModelPricingCoverageRow[];
  assignments: ModelTariffAssignmentView[];
  drafts: ModelTariffDraftView[];
  snapshots: ModelTariffSnapshotView[];
  hasActiveFilters: boolean;
};

/**
 * Business purpose: Determine whether a tariff draft, assignment, or snapshot matches active
 *   provider and model text filters across its normalized scope key and explicit metadata.
 *
 * Business rules:
 * - Empty filter strings match all records.
 * - Text matching is case-insensitive and inspects explicit `provider`/`resolvedModel` fields
 *   as well as `normalizedScopeKey` (needed for assignments that carry only `normalizedScopeKey`).
 *
 * Execution flow:
 * 1. Normalize `provider`, `resolvedModel`, and target strings to lowercase.
 * 2. Verify provider filter matches either `itemProvider` or `normalizedScopeKey`.
 * 3. Verify model filter matches either `itemModel` or `normalizedScopeKey`.
 *
 * Failure cases:
 * - Missing optional `itemProvider`/`itemModel` values fall back to `""` and never throw.
 *
 * Side effects:
 * - None: pure predicate.
 */
function matchesPricingScopeFilter(
  normalizedScopeKey: string,
  providerFilter: string,
  modelFilter: string,
  itemProvider?: string | null,
  itemModel?: string | null,
): boolean {
  // Why: Assignments do not repeat separate provider/model fields on the overview DTO,
  // whereas drafts and snapshots expose both explicit columns and `normalizedScopeKey`.
  // How: Match lowercase substrings against explicit fields when present or `normalizedScopeKey`.
  // Invariants: Pure read-only filter predicate with no side effects.
  const p = (itemProvider ?? "").toLowerCase();
  const m = (itemModel ?? "").toLowerCase();
  const key = normalizedScopeKey.toLowerCase();
  const providerOk =
    providerFilter.length === 0 ||
    p.includes(providerFilter) ||
    key.includes(providerFilter);
  const modelOk =
    modelFilter.length === 0 ||
    m.includes(modelFilter) ||
    key.includes(modelFilter);
  return providerOk && modelOk;
}

/**
 * Business purpose: Apply consistent client-side presentation filtering (including coverage-gap-only)
 *   and precedence sorting across the Admin Model Pricing overview sections.
 *
 * Business rules:
 * - Always sort coverage rows by `EXACT_MODEL` -> `PROVIDER_DEFAULT` -> `GLOBAL_DEFAULT` -> gap.
 * - Apply `coverageGapOnly` locally against `row.hasCoverage === false` without altering the server
 *   contract schema.
 * - Apply text/scope filters across coverage, assignments, drafts, and snapshots so all sections
 *   stay coherent during inspection and mock-mode testing.
 *
 * Execution flow:
 * 1. Normalize `provider` and `resolvedModel` filter strings (lowercase, trimmed).
 * 2. Filter `coverage`, `assignments`, `drafts`, and `snapshots` according to active filter fields.
 * 3. Sort filtered `coverage` via `sortCoverageByPrecedence` and compute `hasActiveFilters`.
 *
 * Failure cases:
 * - Empty inputs yield empty filtered arrays and never throw.
 *
 * Side effects:
 * - None: pure view projection over validated query data.
 */
export function filterAdminPricingOverview(
  data: AdminModelPricingOverviewResponse,
  filters: AdminPricingFilters,
): FilteredAdminPricingOverview {
  const provider = filters.provider.trim().toLowerCase();
  const resolvedModel = filters.resolvedModel.trim().toLowerCase();
  const scope = filters.scope;
  const status = filters.status;
  const coverageGapOnly = filters.coverageGapOnly;

  const hasActiveFilters =
    provider.length > 0 ||
    resolvedModel.length > 0 ||
    scope !== "" ||
    status !== "" ||
    coverageGapOnly;

  const filteredCoverage = sortCoverageByPrecedence(
    data.coverage.filter((row) => {
      if (coverageGapOnly && row.hasCoverage) {
        return false;
      }
      if (
        provider.length > 0 &&
        !row.provider.toLowerCase().includes(provider)
      ) {
        return false;
      }
      if (
        resolvedModel.length > 0 &&
        !row.resolvedModel.toLowerCase().includes(resolvedModel)
      ) {
        return false;
      }
      if (scope !== "" && (row.fallbackSource ?? row.resolvedScope) !== scope) {
        return false;
      }
      return true;
    }),
  );

  const filteredAssignments = data.assignments.filter((item) => {
    if (scope !== "" && item.scope !== scope) {
      return false;
    }
    if (status !== "" && item.status !== status) {
      return false;
    }
    return matchesPricingScopeFilter(
      item.normalizedScopeKey,
      provider,
      resolvedModel,
    );
  });

  const filteredDrafts = data.drafts.filter((draft) => {
    if (scope !== "" && draft.scope !== scope) {
      return false;
    }
    return matchesPricingScopeFilter(
      draft.normalizedScopeKey,
      provider,
      resolvedModel,
      draft.provider,
      draft.resolvedModel,
    );
  });

  const filteredSnapshots = data.snapshots.filter((snapshot) => {
    if (scope !== "" && snapshot.scope !== scope) {
      return false;
    }
    return matchesPricingScopeFilter(
      snapshot.normalizedScopeKey,
      provider,
      resolvedModel,
      snapshot.provider,
      snapshot.resolvedModel,
    );
  });

  return {
    coverage: filteredCoverage,
    assignments: filteredAssignments,
    drafts: filteredDrafts,
    snapshots: filteredSnapshots,
    hasActiveFilters,
  };
}

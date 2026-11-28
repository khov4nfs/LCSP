import type {
  ModelPricingCoverageRow,
  ModelTariffAssignmentView,
  ModelTariffDraftView,
  ModelTariffSnapshotView,
} from "@lcsp/contracts/billing";

/**
 * Discriminator constants for the read-only Admin Model Pricing inspection dialog.
 * Why: Eliminates raw string-literal unions and maintains canonical SCREAMING_SNAKE_CASE values.
 * How: Defined as an `as const` object with a derived union type.
 * Invariants: Covers every inspectable entity rendered on `/admin/pricing`.
 */
export const PRICING_DETAIL_KINDS = {
  coverage: "COVERAGE",
  assignment: "ASSIGNMENT",
  draft: "DRAFT",
  snapshot: "SNAPSHOT",
} as const;

export type PricingDetailKind =
  (typeof PRICING_DETAIL_KINDS)[keyof typeof PRICING_DETAIL_KINDS];

export type PricingDetailTarget =
  | { kind: typeof PRICING_DETAIL_KINDS.coverage; item: ModelPricingCoverageRow }
  | {
      kind: typeof PRICING_DETAIL_KINDS.assignment;
      item: ModelTariffAssignmentView;
      snapshot: ModelTariffSnapshotView | null;
    }
  | { kind: typeof PRICING_DETAIL_KINDS.draft; item: ModelTariffDraftView }
  | { kind: typeof PRICING_DETAIL_KINDS.snapshot; item: ModelTariffSnapshotView };

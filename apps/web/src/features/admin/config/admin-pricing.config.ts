import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
  type CustomerTariffDraftStatus,
  type ModelPricingScope,
  type PricingAssignmentStatus,
  type TokenBucketPolicy,
} from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";

/**
 * Default filter form values for the read-only Admin Model Pricing workbench.
 * Why: Keeps React Hook Form initialization deterministic and aligned with empty query parameters.
 * How: Uses empty strings for optional text/select inputs and `false` for `coverageGapOnly`.
 * Invariants: Resetting the form always returns to this exact initial state.
 */
export const DEFAULT_ADMIN_PRICING_FILTERS = {
  provider: "",
  resolvedModel: "",
  scope: "",
  status: "",
  coverageGapOnly: false,
} as const;

export const PRICING_SCOPE_OPTIONS = [
  MODEL_PRICING_SCOPES.exactModel,
  MODEL_PRICING_SCOPES.providerDefault,
  MODEL_PRICING_SCOPES.globalDefault,
] as const;

export const PRICING_ASSIGNMENT_STATUS_OPTIONS = [
  PRICING_ASSIGNMENT_STATUSES.active,
  PRICING_ASSIGNMENT_STATUSES.scheduled,
  PRICING_ASSIGNMENT_STATUSES.superseded,
] as const;

export const PRICING_SCOPE_LABEL_KEYS: Record<ModelPricingScope, MessageKey> = {
  [MODEL_PRICING_SCOPES.exactModel]: "pages.admin.pricing.scopes.EXACT_MODEL",
  [MODEL_PRICING_SCOPES.providerDefault]:
    "pages.admin.pricing.scopes.PROVIDER_DEFAULT",
  [MODEL_PRICING_SCOPES.globalDefault]:
    "pages.admin.pricing.scopes.GLOBAL_DEFAULT",
};

export const PRICING_ASSIGNMENT_STATUS_LABEL_KEYS: Record<
  PricingAssignmentStatus,
  MessageKey
> = {
  [PRICING_ASSIGNMENT_STATUSES.active]:
    "pages.admin.pricing.assignmentStatuses.ACTIVE",
  [PRICING_ASSIGNMENT_STATUSES.scheduled]:
    "pages.admin.pricing.assignmentStatuses.SCHEDULED",
  [PRICING_ASSIGNMENT_STATUSES.superseded]:
    "pages.admin.pricing.assignmentStatuses.SUPERSEDED",
};

export const PRICING_DRAFT_STATUS_LABEL_KEYS: Record<
  CustomerTariffDraftStatus,
  MessageKey
> = {
  [CUSTOMER_TARIFF_DRAFT_STATUSES.draft]:
    "pages.admin.pricing.draftStatuses.DRAFT",
  [CUSTOMER_TARIFF_DRAFT_STATUSES.published]:
    "pages.admin.pricing.draftStatuses.PUBLISHED",
  [CUSTOMER_TARIFF_DRAFT_STATUSES.abandoned]:
    "pages.admin.pricing.draftStatuses.ABANDONED",
};

export const TOKEN_BUCKET_POLICY_LABEL_KEYS: Record<
  TokenBucketPolicy,
  MessageKey
> = {
  [TOKEN_BUCKET_POLICIES.separateRate]:
    "pages.admin.pricing.bucketPolicies.SEPARATE_RATE",
  [TOKEN_BUCKET_POLICIES.useOutputRate]:
    "pages.admin.pricing.bucketPolicies.USE_OUTPUT_RATE",
  [TOKEN_BUCKET_POLICIES.includedInOutput]:
    "pages.admin.pricing.bucketPolicies.INCLUDED_IN_OUTPUT",
  [TOKEN_BUCKET_POLICIES.unsupported]:
    "pages.admin.pricing.bucketPolicies.UNSUPPORTED",
};

export const PRICING_DEBIT_MODE_LABEL_KEYS = {
  [MODEL_USAGE_DEBIT_MODES.OFF]: "pages.admin.pricing.debitModeValues.OFF",
  [MODEL_USAGE_DEBIT_MODES.SHADOW]: "pages.admin.pricing.debitModeValues.SHADOW",
} as const satisfies Record<
  typeof MODEL_USAGE_DEBIT_MODES.OFF | typeof MODEL_USAGE_DEBIT_MODES.SHADOW,
  MessageKey
>;

export const LEGAL_SOURCE_LIFECYCLE_STATUSES = {
  draft: "DRAFT",
  active: "ACTIVE",
  invalid: "INVALID",
  superseded: "SUPERSEDED",
} as const;

export type LegalSourceLifecycleStatus =
  (typeof LEGAL_SOURCE_LIFECYCLE_STATUSES)[keyof typeof LEGAL_SOURCE_LIFECYCLE_STATUSES];

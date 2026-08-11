export const LEGAL_RULE_LIFECYCLE_STATUSES = {
  draft: "DRAFT",
  approved: "APPROVED",
  rejected: "REJECTED",
  superseded: "SUPERSEDED",
} as const;

export type LegalRuleLifecycleStatus =
  (typeof LEGAL_RULE_LIFECYCLE_STATUSES)[keyof typeof LEGAL_RULE_LIFECYCLE_STATUSES];

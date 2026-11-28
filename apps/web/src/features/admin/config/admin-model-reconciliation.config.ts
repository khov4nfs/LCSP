import { RECONCILIATION_CASE_STATES } from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";

// Why: Case states are canonical billing values while display labels must remain localized.
// How: Map every contract state to one i18n key, including terminal and review states.
// Invariant: Admin must never confuse an unresolved case with a closed case due to raw-code display.
export const MODEL_RECONCILIATION_STATE_LABEL_KEYS: Record<string, MessageKey> = {
  [RECONCILIATION_CASE_STATES.OPEN]: "pages.admin.modelReconciliation.states.OPEN",
  [RECONCILIATION_CASE_STATES.EVIDENCE_PENDING]: "pages.admin.modelReconciliation.states.EVIDENCE_PENDING",
  [RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW]: "pages.admin.modelReconciliation.states.INTEGRITY_REVIEW",
  [RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE]: "pages.admin.modelReconciliation.states.SETTLED_WITH_USAGE",
  [RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE]: "pages.admin.modelReconciliation.states.CONFIRMED_NO_USAGE",
  [RECONCILIATION_CASE_STATES.ESCALATED]: "pages.admin.modelReconciliation.states.ESCALATED",
  [RECONCILIATION_CASE_STATES.CLOSED]: "pages.admin.modelReconciliation.states.CLOSED",
};

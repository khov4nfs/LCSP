import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";

import { LEGAL_SOURCE_STATUS_MESSAGE_KEYS } from "../../config/legal-source-display.config";

const toneByStatus: Record<string, string> = {
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.draft]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.active]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded]:
    "border-border bg-muted text-muted-foreground",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid]:
    "border-status-danger-border bg-status-danger-bg text-status-danger",
};

/**
 * Business purpose: Render a legal source version's lifecycle status badge using semantic status tokens.
 * Business rules:
 * - Maps canonical LEGAL_SOURCE_LIFECYCLE_STATUSES values to semantic warning, success, muted, or danger tokens.
 * - Unknown status strings fall back to INVALID.
 * Execution flow:
 * 1. Resolve status against LEGAL_SOURCE_LIFECYCLE_STATUSES.
 * 2. Render localized pill badge with semantic border, background, and text tokens.
 * Failure cases:
 * - Unrecognized status safely renders the invalid badge without throwing.
 * Side effects:
 * - Pure presentational component.
 */
export function LegalSourceLifecycleBadge({ status }: { status: string }) {
  const knownStatus =
    Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES).find(
      (value) => value === status,
    ) ?? LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneByStatus[knownStatus]}`}
      data-component="LegalSourceLifecycleBadge"
    >
      {resolveAppMessage(
        LEGAL_SOURCE_STATUS_MESSAGE_KEYS[knownStatus] as MessageKey,
      )}
    </span>
  );
}

import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";

import { LEGAL_SOURCE_STATUS_MESSAGE_KEYS } from "../../config/legal-source-display.config";

const toneByStatus: Record<string, string> = {
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.draft]:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.active]:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded]:
    "border-border bg-muted text-muted-foreground",
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid]:
    "border-destructive/30 bg-destructive/10 text-destructive",
};

export function LegalSourceLifecycleBadge({ status }: { status: string }) {
  const knownStatus =
    Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES).find(
      (value) => value === status,
    ) ?? LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneByStatus[knownStatus]}`}
    >
      {resolveAppMessage(
        LEGAL_SOURCE_STATUS_MESSAGE_KEYS[knownStatus] as MessageKey,
      )}
    </span>
  );
}

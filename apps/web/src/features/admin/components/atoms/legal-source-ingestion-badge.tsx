import { LoaderCircle } from "lucide-react";
import {
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
  type LegalSourceDocumentIngestionState,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";

import { LEGAL_SOURCE_INGESTION_MESSAGE_KEYS } from "../../config/legal-source-display.config";

const toneByState: Record<LegalSourceDocumentIngestionState, string> = {
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PENDING]:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PROCESSING]:
    "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.READY]:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.FAILED]:
    "border-destructive/30 bg-destructive/10 text-destructive",
};

export function LegalSourceIngestionBadge({
  state,
}: {
  state: LegalSourceDocumentIngestionState;
}) {
  const running =
    state === LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PENDING ||
    state === LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PROCESSING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${toneByState[state]}`}
    >
      {running ? (
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      ) : null}
      {resolveAppMessage(
        LEGAL_SOURCE_INGESTION_MESSAGE_KEYS[state] as MessageKey,
      )}
    </span>
  );
}

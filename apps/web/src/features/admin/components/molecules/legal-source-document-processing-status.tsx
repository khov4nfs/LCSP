import type { LegalSourceDocumentStatusProps } from "../../types/legal-source-lifecycle.types";
import { resolveAppMessage as t } from "@/lib/i18n";
import { LegalSourceIngestionBadge } from "../atoms/legal-source-ingestion-badge";

export function LegalSourceDocumentProcessingStatus({
  document,
}: LegalSourceDocumentStatusProps) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2">
      <LegalSourceIngestionBadge state={document.ingestionState} />
      <span className="text-xs text-muted-foreground">
        {t("pages.legalLifecycle.attempt")}: {document.attempt}
      </span>
    </div>
  );
}

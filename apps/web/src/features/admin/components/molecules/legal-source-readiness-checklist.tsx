import type { LegalSourceReadinessProps } from "../../types/legal-source-lifecycle.types";
import { CheckCircle2Icon, CircleAlertIcon } from "lucide-react";
import { LEGAL_RETRIEVAL_INDEX_STATUSES } from "@lcsp/contracts/legal-source";
import { resolveAppMessage as t } from "@/lib/i18n";
import { LegalSourceBlockerList } from "./legal-source-blocker-list";

/**
 * Business purpose: Explain technical readiness separately from legal admission before activation.
 * Business rules: Document counts and index status come from the server; the current API cannot confirm LCSP-424/425 admission, so it is always shown as blocked.
 * Execution flow:
 * 1. Display document, processing and structural checks from the selected version.
 * 2. Show server blockers and the unavailable admission check without inventing legal eligibility.
 * Failure cases: Missing documents or index are failed checks; missing admission never becomes a passing legal claim.
 * Side effects: Read-only presentation; does not authorize activation or mutate the version.
 */
export function LegalSourceReadinessChecklist({
  version,
}: LegalSourceReadinessProps) {
  const checks = [
    {
      key: "pages.legalLifecycle.documentsCheck",
      passed: version.documentCount > 0,
    },
    {
      key: "pages.legalLifecycle.processingCheck",
      passed:
        version.documentCount > 0 &&
        version.readyDocumentCount === version.documentCount,
    },
    {
      key: "pages.legalLifecycle.indexCheck",
      passed: version.index?.status === LEGAL_RETRIEVAL_INDEX_STATUSES.VALID,
    },
    { key: "pages.legalLifecycle.admissionCheck", passed: false },
  ] as const;
  return (
    <div className="space-y-4">
      <ul
        className="divide-y rounded-lg border"
        aria-label={t("pages.legalLifecycle.readiness")}
      >
        {checks.map(({ key, passed }) => (
          <li
            key={key}
            className="flex items-start justify-between gap-3 p-3 text-sm"
          >
            <span>{t(key)}</span>
            <span
              className={
                passed
                  ? "flex shrink-0 items-center gap-1 text-emerald-700 dark:text-emerald-300"
                  : "flex shrink-0 items-center gap-1 text-destructive"
              }
            >
              {passed ? (
                <CheckCircle2Icon className="size-4" aria-hidden="true" />
              ) : (
                <CircleAlertIcon className="size-4" aria-hidden="true" />
              )}
              {t(
                passed
                  ? "pages.legalLifecycle.passed"
                  : "pages.legalLifecycle.blocked",
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        {t("pages.legalLifecycle.admissionMissing")}
      </p>
      {version.blockers.length > 0 ? (
        <LegalSourceBlockerList blockers={version.blockers} />
      ) : null}
    </div>
  );
}

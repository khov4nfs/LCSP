import type { LegalSourceDocumentStatusProps } from "../../types/legal-source-lifecycle.types";
import { LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES } from "@lcsp/contracts/legal-source";
import { resolveAppMessage as t } from "@/lib/i18n";

export function LegalSourceDocumentProvenance({
  document,
}: LegalSourceDocumentStatusProps) {
  return (
    <details className="mt-2 max-w-96 text-xs">
      <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
        {t("pages.legalLifecycle.officialProvenance")}
      </summary>
      <dl className="mt-3 space-y-2 break-all">
        <div>
          <dt className="font-medium">
            {t("pages.legalLifecycle.documentIdentity")}
          </dt>
          <dd>
            {document.documentId} · {document.id}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("pages.legalLifecycle.purpose")}</dt>
          <dd>
            {t(
              document.corpusRole ===
                LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY
                ? "pages.legalLifecycle.reference"
                : "pages.legalLifecycle.operative",
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("pages.legalSources.urlLabel")}</dt>
          <dd>{document.sourceUrl || t("pages.legalLifecycle.notRecorded")}</dd>
        </div>
        <div>
          <dt className="font-medium">{t("pages.legalLifecycle.hash")}</dt>
          <dd>
            {document.sourceSha256 || t("pages.legalLifecycle.notRecorded")}
          </dd>
        </div>
        <div>
          <dt className="font-medium">
            {t("pages.legalSources.effectiveDateLabel")}
          </dt>
          <dd>
            {document.effectiveDate ?? t("pages.legalLifecycle.notRecorded")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-muted-foreground">
        {t("pages.legalLifecycle.locatorHelp")}
      </p>
      <p className="mt-2 text-muted-foreground">
        {t("pages.legalLifecycle.provenanceMissing")}
      </p>
    </details>
  );
}

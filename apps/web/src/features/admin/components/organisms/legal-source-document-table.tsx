import type { LegalSourceDocumentView } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { resolveAppMessage } from "@/lib/i18n";
import { LegalSourceDocumentRow } from "../molecules/legal-source-document-row";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceDocumentTable({
  versionId,
  documents,
  canEditEffect,
  onError,
}: {
  versionId: string;
  documents: LegalSourceDocumentView[];
  canEditEffect: boolean;
  onError: (key: string) => void;
}) {
  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {t("pages.legalSources.documentsEmpty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-240 text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.titleLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.originLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.mediaTypeLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.sizeLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.chunkCountLabel")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.sha256Label")}
            </th>
            <th className="px-4 py-3 font-medium">
              {t("pages.legalSources.actionsLabel")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {documents.map((document) => (
            <LegalSourceDocumentRow
              key={document.id}
              versionId={versionId}
              document={document}
              canEditEffect={canEditEffect}
              onError={onError}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

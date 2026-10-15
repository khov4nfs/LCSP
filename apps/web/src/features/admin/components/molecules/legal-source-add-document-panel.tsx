"use client";

import { useState } from "react";
import type { MessageKey } from "@lcsp/i18n";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveAppMessage } from "@/lib/i18n";
import { LegalSourceImportForm } from "./legal-source-import-form";
import { LegalSourceUploadForm } from "./legal-source-upload-form";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceAddDocumentPanel({
  versionId,
}: {
  versionId: string;
}) {
  const [importMode, setImportMode] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pages.legalSources.addDocument")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("pages.legalSources.addDocumentDescription")}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div
          role="tablist"
          aria-label={t("pages.legalSources.addDocument")}
          className="flex gap-2 border-b"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!importMode}
            className="border-b-2 border-transparent px-3 py-2 text-sm aria-selected:border-primary aria-selected:text-primary"
            onClick={() => setImportMode(false)}
          >
            {t("pages.legalSources.uploadTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={importMode}
            className="border-b-2 border-transparent px-3 py-2 text-sm aria-selected:border-primary aria-selected:text-primary"
            onClick={() => setImportMode(true)}
          >
            {t("pages.legalSources.importTab")}
          </button>
        </div>
        <div role="tabpanel">
          {importMode ? (
            <LegalSourceImportForm versionId={versionId} />
          ) : (
            <LegalSourceUploadForm versionId={versionId} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

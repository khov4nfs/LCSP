import { ExternalLinkIcon, FileDownIcon } from "lucide-react";
import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import type { LegalDocument } from "../../config/legal-documents";

type LegalDocumentCopy = {
  title: string;
  reference: string;
};

export function LegalDocumentReaderPage({
  document,
}: {
  document: LegalDocument;
}) {
  const copy = getLegalDocumentCopy(document);
  const fileHref = `/laws/${document.id}/file`;

  return (
    <main className="flex flex-1 flex-col px-4 py-6 text-foreground lg:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="font-heading text-xl font-semibold">{copy.title}</h1>
            <p className="text-sm text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.legalLibrary.documentReferenceLabel",
              )}: {copy.reference}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              render={<a href={fileHref} download />}
              nativeButton={false}
              size="sm"
              variant="outline"
            >
              <FileDownIcon data-icon="inline-start" aria-hidden="true" />
              {resolveMessage(appLocale, "pages.legalLibrary.downloadDocument")}
            </Button>
            <Button
              render={
                <a
                  href={document.officialSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                />
              }
              nativeButton={false}
              size="sm"
              variant="outline"
            >
              <ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />
              {resolveMessage(appLocale, "pages.legalLibrary.openOfficialSource")}
            </Button>
          </div>
        </header>
        <iframe
          className="min-h-[calc(100dvh-16rem)] w-full border bg-muted"
          src={`${fileHref}#view=FitH`}
          title={copy.title}
        />
      </div>
    </main>
  );
}

function getLegalDocumentCopy(document: LegalDocument): LegalDocumentCopy {
  if (document.messageKey === "aiLaw") {
    return {
      title: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.title",
      ),
      reference: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.reference",
      ),
    };
  }

  return {
    title: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.title",
    ),
    reference: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.reference",
    ),
  };
}

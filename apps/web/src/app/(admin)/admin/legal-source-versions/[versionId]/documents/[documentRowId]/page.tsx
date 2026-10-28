import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { LegalSourceChunkInspectorPage } from "@/features/admin/components/organisms/legal-source-chunk-inspector-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.legalSources.metadataTitle"),
  description: resolveMessage(
    appLocale,
    "pages.legalSources.metadataDescription",
  ),
};

export default async function LegalSourceChunkInspectorRoute({
  params,
}: {
  params: Promise<{ versionId: string; documentRowId: string }>;
}) {
  const { versionId, documentRowId } = await params;
  return (
    <LegalSourceChunkInspectorPage
      versionId={versionId}
      documentRowId={documentRowId}
    />
  );
}

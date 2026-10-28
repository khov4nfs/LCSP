import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { LegalSourceVersionPage } from "@/features/admin/components/organisms/legal-source-version-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.legalSources.metadataTitle"),
  description: resolveMessage(
    appLocale,
    "pages.legalSources.metadataDescription",
  ),
};

export default async function LegalSourceVersionRoute({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  return <LegalSourceVersionPage versionId={versionId} />;
}

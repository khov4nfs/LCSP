import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { LegalSourceDetailPage } from "@/features/admin/components/organisms/legal-source-detail-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.legalSources.metadataTitle"),
  description: resolveMessage(
    appLocale,
    "pages.legalSources.metadataDescription",
  ),
};

export default async function LegalSourceDetailRoute({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;
  return <LegalSourceDetailPage sourceId={sourceId} />;
}

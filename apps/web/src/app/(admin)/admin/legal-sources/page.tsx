import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { LegalSourcesPage } from "@/features/admin/components/organisms/legal-sources-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.legalSources.metadataTitle"),
  description: resolveMessage(
    appLocale,
    "pages.legalSources.metadataDescription",
  ),
};

export default function LegalSourcesRoute() {
  return <LegalSourcesPage />;
}

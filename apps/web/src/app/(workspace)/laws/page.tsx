import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { LegalLibraryPage } from "@/features/legal-library/components/organisms/legal-library-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.legalLibrary.metadataTitle"),
  description: resolveMessage(
    appLocale,
    "pages.legalLibrary.metadataDescription",
  ),
};

export default function LawsPage() {
  return <LegalLibraryPage />;
}

import type { Metadata } from "next";
import { resolveMessage } from "@lcsp/i18n";

import { ClassificationStatusPage } from "@/features/classification/components/organisms/classification-status-page";
import { appLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: resolveMessage(appLocale, "pages.classification.metadataTitle"),
  description: resolveMessage(
    appLocale,
    "pages.classification.metadataDescription",
  ),
};

export default async function AssessmentClassificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClassificationStatusPage assessmentId={id} />;
}

import { notFound } from "next/navigation";

import { LegalDocumentReaderPage } from "@/features/legal-library/components/organisms/legal-document-reader-page";
import { getLegalDocument } from "@/features/legal-library/config/legal-documents";

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ lawId: string }>;
}) {
  const { lawId } = await params;
  const document = getLegalDocument(lawId);

  if (!document) {
    notFound();
  }

  return <LegalDocumentReaderPage document={document} />;
}

import { LegalDocumentReaderPage } from "@/features/legal-library/components/organisms/legal-document-reader-page";

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ lawId: string }>;
}) {
  const { lawId } = await params;
  return <LegalDocumentReaderPage documentRowId={lawId} />;
}

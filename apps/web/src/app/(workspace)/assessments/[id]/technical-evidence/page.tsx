import { TechnicalEvidenceRuntimePage } from "@/features/evidence/components/organisms/technical-evidence-runtime-page";

export default async function TechnicalEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TechnicalEvidenceRuntimePage assessmentId={id} />;
}

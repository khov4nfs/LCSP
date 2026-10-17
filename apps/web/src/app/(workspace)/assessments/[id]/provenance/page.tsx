import { AssessmentProvenanceView } from "@/features/assessment-runtime/components/organisms/assessment-provenance-view";

export default async function AssessmentProvenancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssessmentProvenanceView assessmentId={id} />;
}

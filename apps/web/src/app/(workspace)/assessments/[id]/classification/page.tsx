import { redirect } from "next/navigation";

export default async function AssessmentClassificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/assessments/${encodeURIComponent(id)}`);
}

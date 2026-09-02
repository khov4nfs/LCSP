import { redirect } from "next/navigation";

export default async function AssessmentReadinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/assessments/${encodeURIComponent(id)}`);
}

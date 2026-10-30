import { AssessmentReportView } from "@/features/assessment-runtime/components/organisms/assessment-report-view";

export default async function AssessmentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ artifactId?: string }>;
}) {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  return <AssessmentReportView assessmentId={id} artifactId={resolvedSearchParams.artifactId} />;
}

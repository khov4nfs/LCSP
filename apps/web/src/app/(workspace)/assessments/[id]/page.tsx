import { AssessmentChatView } from "@/features/assessment-runtime/components/organisms/assessment-chat-view";

export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ requestId?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  return (
    <AssessmentChatView
      assessmentId={id}
      targetRequestId={resolvedSearchParams?.requestId}
    />
  );
}

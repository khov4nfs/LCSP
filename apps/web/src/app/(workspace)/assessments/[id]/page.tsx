import { AssessmentChatView } from "@/features/assessment-runtime/components/organisms/assessment-chat-view";

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssessmentChatView assessmentId={id} />;
}

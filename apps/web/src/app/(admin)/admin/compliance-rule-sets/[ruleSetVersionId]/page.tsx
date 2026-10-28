import { ComplianceRuleSetResultPage } from "@/features/admin/components/organisms/compliance-rule-set-result-page";

export default async function ComplianceRuleSetResultRoute({
  params,
}: {
  params: Promise<{ ruleSetVersionId: string }>;
}) {
  const { ruleSetVersionId } = await params;
  return <ComplianceRuleSetResultPage ruleSetVersionId={ruleSetVersionId} />;
}

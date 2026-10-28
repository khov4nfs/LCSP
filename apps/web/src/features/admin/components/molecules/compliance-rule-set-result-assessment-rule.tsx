import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import { ComplianceRuleSetResultSources } from "./compliance-rule-set-result-sources";
import { ComplianceRuleSetResultValueList } from "./compliance-rule-set-result-value-list";
import type { ComplianceRuleSetResultAssessmentRuleProps } from "../../types/compliance-rule-set-result.types";

export function ComplianceRuleSetResultAssessmentRule({
  rule,
}: ComplianceRuleSetResultAssessmentRuleProps) {
  return (
    <details className="rounded-md border border-border/70 p-3">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 font-medium">
        <span>{rule.concept}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {rule.assessmentRuleId}
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {resolveAppMessage("pages.complianceRuleSets.result.legalIntent")}
            </dt>
            <dd className="text-sm">{rule.legalIntent}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {resolveAppMessage(
                "pages.complianceRuleSets.result.applicabilityGuidance",
              )}
            </dt>
            <dd className="text-sm">{rule.applicabilityGuidance}</dd>
          </div>
        </dl>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ComplianceRuleSetResultValueList
            labelKey={"pages.complianceRuleSets.result.criteria" as MessageKey}
            values={rule.criteria.map((criterion) => criterion.statement)}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.investigationGoals" as MessageKey
            }
            values={rule.investigationGoals}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.requiredEvidence" as MessageKey
            }
            values={rule.requiredEvidence}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.supportingEvidence" as MessageKey
            }
            values={rule.supportingEvidence}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.negativeEvidence" as MessageKey
            }
            values={rule.negativeEvidence}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.unresolvedConditions" as MessageKey
            }
            values={rule.unresolvedConditions}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.linkedRequirementIds" as MessageKey
            }
            values={rule.legalRequirementIds}
          />
        </dl>
        <ComplianceRuleSetResultSources sources={rule.sources} />
      </div>
    </details>
  );
}

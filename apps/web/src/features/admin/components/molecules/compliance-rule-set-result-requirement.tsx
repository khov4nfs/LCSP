import type { MessageKey } from "@lcsp/i18n";
import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { ComplianceRuleSetResultSources } from "./compliance-rule-set-result-sources";
import { ComplianceRuleSetResultValueList } from "./compliance-rule-set-result-value-list";
import type { ComplianceRuleSetResultRequirementProps } from "../../types/compliance-rule-set-result.types";

export function ComplianceRuleSetResultRequirement({
  requirement,
}: ComplianceRuleSetResultRequirementProps) {
  return (
    <details className="rounded-md border border-border/70 p-3">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 font-medium">
        <span>{requirement.title}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {requirement.legalRequirementId}
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            {resolveAppMessage("pages.complianceRuleSets.result.proposition")}
          </h4>
          <p className="text-sm">{requirement.proposition}</p>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.applicabilityConditions" as MessageKey
            }
            values={requirement.applicabilityConditions}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.qualifiers" as MessageKey
            }
            values={requirement.qualifiers}
          />
          <ComplianceRuleSetResultValueList
            labelKey={
              "pages.complianceRuleSets.result.exceptions" as MessageKey
            }
            values={requirement.exceptions}
          />
        </dl>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {resolveAppMessage(
                "pages.complianceRuleSets.result.coverageState",
              )}
            </dt>
            <dd>
              <Badge variant="outline">
                {resolveAppMessage(
                  `pages.complianceRuleSets.result.coverageStates.${requirement.coverage.state}` as MessageKey,
                )}
              </Badge>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {resolveAppMessage(
                "pages.complianceRuleSets.result.nonAssessableReason",
              )}
            </dt>
            <dd className="text-sm">
              {requirement.coverage.nonAssessableReason ??
                resolveAppMessage("pages.complianceRuleSets.result.noneStated")}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">
              {resolveAppMessage(
                "pages.complianceRuleSets.result.nonRepositoryDuty",
              )}
            </dt>
            <dd className="text-sm">
              {resolveAppMessage(
                requirement.nonRepositoryDuty
                  ? "pages.complianceRuleSets.result.yes"
                  : "pages.complianceRuleSets.result.no",
              )}
            </dd>
          </div>
        </dl>
        <ComplianceRuleSetResultSources sources={requirement.sources} />
      </div>
    </details>
  );
}

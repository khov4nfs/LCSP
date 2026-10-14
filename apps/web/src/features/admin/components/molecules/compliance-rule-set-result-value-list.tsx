import { resolveAppMessage } from "@/lib/i18n";
import type { ComplianceRuleSetResultValueListProps } from "../../types/compliance-rule-set-result.types";

export function ComplianceRuleSetResultValueList({
  labelKey,
  values,
}: ComplianceRuleSetResultValueListProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">
        {resolveAppMessage(labelKey)}
      </dt>
      <dd>
        {values.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            {resolveAppMessage("pages.complianceRuleSets.result.noneStated")}
          </span>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {values.map((value, index) => (
              <li key={`${index}-${value}`}>{value}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

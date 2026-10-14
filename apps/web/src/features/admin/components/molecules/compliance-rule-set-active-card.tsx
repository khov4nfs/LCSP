import type { MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleTimestamp } from "@/features/workspace/utils/assessment-runtime-formatter";
import type { ComplianceRuleSetActiveCardProps } from "../../types/compliance-rule-sets.types";
import { RuleSetPreparationAction } from "./rule-set-preparation-action";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/** The one shared rule set every new assessment pins: observability only, never an action. */
export function ComplianceRuleSetActiveCard({
  ruleSet,
  availability,
}: ComplianceRuleSetActiveCardProps) {
  const facts = ruleSet
    ? [
        ["version", ruleSet.version],
        ["sourceVersion", ruleSet.legalSourceVersion],
        ["requirements", String(ruleSet.legalRequirementCount)],
        ["assessmentRules", String(ruleSet.assessmentRuleCount)],
        [
          "activatedAt",
          ruleSet.activatedAt
            ? formatLocaleTimestamp(ruleSet.activatedAt)
            : "—",
        ],
        ["digest", ruleSet.ruleSetDigest],
      ]
    : [];
  return (
    <Card data-compliance-rule-set-active={ruleSet?.ruleSetVersionId ?? "NONE"}>
      <CardHeader>
        <CardTitle>{t("pages.complianceRuleSets.active")}</CardTitle>
        <CardDescription>
          {ruleSet ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{ruleSet.version}</span>
              <Badge variant="outline">
                {t(`pages.complianceRuleSets.states.${ruleSet.lifecycleState}`)}
              </Badge>
            </span>
          ) : (
            t("pages.complianceRuleSets.unavailable")
          )}
        </CardDescription>
      </CardHeader>
      {ruleSet ? (
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([key, value]) => (
              <div key={key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">
                  {t(`pages.complianceRuleSets.${key}`)}
                </dt>
                <dd
                  className={
                    key === "digest"
                      ? "truncate font-mono text-xs"
                      : "text-sm font-medium"
                  }
                >
                  {key === "digest" ? (
                    <Tooltip>
                      <TooltipTrigger render={<span tabIndex={0} />}>
                        {value}
                      </TooltipTrigger>
                      <TooltipContent>{value}</TooltipContent>
                    </Tooltip>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link
              className="text-sm font-medium text-primary underline underline-offset-4"
              href={`/admin/compliance-rule-sets/${ruleSet.ruleSetVersionId}`}
            >
              {t("pages.complianceRuleSets.viewResult")}
            </Link>
            <RuleSetPreparationAction
              availability={availability}
              replaceActive
            />
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

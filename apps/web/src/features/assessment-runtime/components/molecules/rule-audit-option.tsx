"use client";
import { Controller, useFormContext } from "react-hook-form";
import type { RuleAuditCatalog } from "@lcsp/contracts/assessment-domain";
import { RULE_AUDIT_PROGRESS_STATES } from "@lcsp/contracts/assessment-domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import type { RuleAuditSelection } from "../../schemas/rule-audit-selection.schema";
import { copy } from "../../utils/conversation-copy";

type Rule = RuleAuditCatalog["rules"][number];

/** A pinned rule choice with its legal context and durable result access. */
export function RuleAuditOption({
  rule,
  onView,
}: {
  rule: Rule;
  onView: (decisionId: string) => void;
}) {
  const { control } = useFormContext<RuleAuditSelection>();
  const ready = rule.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY;
  return (
    <li data-rule-id={rule.assessmentRuleId}>
      <Card size="sm" className="gap-3 p-3">
        <div className="flex items-start gap-3">
          <Controller
            control={control}
            name="selectedRuleIds"
            render={({ field }) => (
              <Checkbox
                aria-label={`${rule.concept} (${rule.assessmentRuleId})`}
                checked={field.value.includes(rule.assessmentRuleId)}
                disabled={ready}
                onCheckedChange={(checked) =>
                  field.onChange(
                    checked
                      ? [...field.value, rule.assessmentRuleId]
                      : field.value.filter(
                          (id) => id !== rule.assessmentRuleId,
                        ),
                  )
                }
              />
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{rule.concept}</p>
              <Badge
                variant="outline"
                className="h-auto py-0.5 text-xs font-normal"
              >
                {copy(`ruleAudit.progress.${rule.progress}`)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{rule.summary}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {rule.assessmentRuleId} · {rule.assessmentRuleVersion}
            </p>
            <Collapsible className="mt-2 text-xs text-muted-foreground">
              <CollapsibleTrigger>
                {copy("ruleAudit.legalBasis")}
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <ul className="mt-1 list-disc pl-4">
                  {rule.legalRequirements.map((requirement) => (
                    <li key={requirement.legalRequirementId}>
                      {requirement.title} ({requirement.legalRequirementId})
                      {requirement.sources.length > 0 ? (
                        <ul className="mt-1 list-disc pl-4">
                          {requirement.sources.map((source) => (
                            <li key={`${source.documentId}:${source.locator}`}>
                              {source.documentId} / {source.locator}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CollapsiblePanel>
            </Collapsible>
            {ready && rule.decisionId ? (
              <Button
                type="button"
                variant="link"
                className="mt-1 h-auto px-0"
                onClick={() => onView(rule.decisionId!)}
              >
                {copy("ruleAudit.viewResult")}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </li>
  );
}

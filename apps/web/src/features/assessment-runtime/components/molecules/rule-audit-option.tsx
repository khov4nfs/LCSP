"use client";
import { useSyncExternalStore } from "react";
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
import { getAppLocaleSnapshot, subscribeToAppLocale } from "@/lib/locale";
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
  useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );
  const ready = rule.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY;
  return (
    <li data-rule-id={rule.assessmentRuleId}>
      <Controller
        control={control}
        name="selectedRuleIds"
        render={({ field }) => {
          const selected = field.value.includes(rule.assessmentRuleId);
          return (
            <Card
              size="sm"
              data-selected={selected ? "true" : "false"}
              className={`relative gap-0 p-3 transition-colors ${
                selected
                  ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                  : "hover:border-foreground/20 hover:bg-muted/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  aria-label={`${rule.concept} (${rule.assessmentRuleId})`}
                  checked={selected}
                  disabled={ready}
                  className="mt-0.5"
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
                <div className="min-w-0 flex-1">
                  {rule.membership ? <p className="mb-1 text-xs text-muted-foreground">{copy("ruleAudit.actorStage", { actor: rule.membership.actor, stage: copy("ruleAudit.developmentStage") })}</p> : null}
                  <div className="flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-semibold leading-5">
                        {rule.concept}
                      </p>
                      <Badge
                        variant={ready ? "secondary" : "outline"}
                        className="h-5 shrink-0 px-2 text-xs font-medium"
                      >
                        {copy(`ruleAudit.progress.${rule.progress}`)}
                      </Badge>
                    </div>
                    <Collapsible className="shrink-0 text-xs text-muted-foreground">
                      <CollapsibleTrigger className="font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline">
                        {copy("ruleAudit.legalBasis")}
                      </CollapsibleTrigger>
                      <CollapsiblePanel className="absolute right-0 top-full z-10 mt-2 max-w-96 rounded-md border bg-background p-3 text-left shadow-lg">
                        <ul className="list-disc space-y-2 pl-4">
                          {rule.legalRequirements.map((requirement) => (
                            <li key={requirement.legalRequirementId}>
                              {requirement.title} ({requirement.legalRequirementId})
                              {requirement.sources.length > 0 ? (
                                <ul className="mt-1 list-disc space-y-1 pl-4">
                                  {requirement.sources.map((source) => (
                                    <li
                                      key={`${source.documentId}:${source.locator}`}
                                    >
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
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm leading-5 text-muted-foreground">
                    {rule.summary}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="truncate font-mono">
                      {rule.assessmentRuleId} · {rule.assessmentRuleVersion}
                    </span>
                  </div>
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
          );
        }}
      />
    </li>
  );
}

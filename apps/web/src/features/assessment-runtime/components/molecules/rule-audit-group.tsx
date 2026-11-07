"use client";
import { useFormContext, useWatch } from "react-hook-form";
import { RULE_AUDIT_PROGRESS_STATES } from "@lcsp/contracts/assessment-domain";
import { Button } from "@/components/ui/button";
import { getAppLocaleSnapshot } from "@/lib/locale";
import type { RuleAuditSelection } from "../../schemas/rule-audit-selection.schema";
import type { RuleAuditGroupProps } from "../../types/rule-audit-group.types";
import { copy } from "../../utils/conversation-copy";
import { RuleAuditOption } from "./rule-audit-option";

/** Presentation of one complete server-approved group; selection uses full membership. */
export function RuleAuditGroup({ group, rules, visibleRuleIds, canStart, onView }: RuleAuditGroupProps) {
  const { control, setValue } = useFormContext<RuleAuditSelection>();
  const selected = useWatch({ control, name: "selectedRuleIds" }) ?? [];
  const locale = getAppLocaleSnapshot();
  const members = group.ruleIds.flatMap((id) => rules.filter((rule) => rule.assessmentRuleId === id));
  const visible = members.filter((rule) => visibleRuleIds.has(rule.assessmentRuleId));
  if (!visible.length) return null;
  const eligible = members.filter((rule) => rule.progress !== RULE_AUDIT_PROGRESS_STATES.RESULT_READY).map((rule) => rule.assessmentRuleId);
  const complete = members.length === group.count && new Set(members.map((rule) => rule.assessmentRuleId)).size === group.count;
  const name = locale === "vi" ? group.nameVi : group.nameEn;
  return (
    <li>
      <details open className="rounded-lg border p-3">
        <summary className="cursor-pointer font-semibold">{name} · {group.count}</summary>
        <p className="mt-2 text-sm text-muted-foreground">{locale === "vi" ? group.descriptionVi : group.descriptionEn}</p>
        <div className="my-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!canStart || !complete || !eligible.length}
            onClick={() => setValue("selectedRuleIds", [...new Set([...selected, ...eligible])], { shouldDirty: true, shouldValidate: true })}>
            {copy("ruleAudit.selectGroup", { name })}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!canStart || !members.some((rule) => selected.includes(rule.assessmentRuleId))}
            onClick={() => setValue("selectedRuleIds", selected.filter((id) => !group.ruleIds.includes(id)), { shouldDirty: true, shouldValidate: true })}>
            {copy("ruleAudit.clearGroup", { name })}
          </Button>
        </div>
        <ul className="space-y-2">
          {visible.map((rule) => <RuleAuditOption key={rule.assessmentRuleId} rule={rule} onView={onView} />)}
        </ul>
      </details>
    </li>
  );
}

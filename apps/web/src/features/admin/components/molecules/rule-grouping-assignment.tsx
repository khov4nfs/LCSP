"use client";
import { useFormContext } from "react-hook-form";
import { RULE_CATALOG_GROUP_IDS } from "@lcsp/contracts/assessment-domain";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import type { RuleGroupingForm } from "../../schemas/rule-grouping.schema";
import type { RuleGroupingAssignmentProps } from "../../types/rule-grouping.types";

export function RuleGroupingAssignment({
  entry,
  index,
  readOnly,
}: RuleGroupingAssignmentProps) {
  const { register } = useFormContext<RuleGroupingForm>();
  const t = (key: string) =>
    resolveAppMessage(`pages.ruleGrouping.${key}` as MessageKey);
  return (
    <fieldset
      disabled={readOnly}
      className="flex min-w-0 flex-col gap-3 rounded-md border p-4"
    >
      <legend>{entry.concept}</legend>
      <p>{entry.legalIntent}</p>
      <p>
        {entry.actor} · {entry.lifecycleStage}
      </p>
      <ul>
        {entry.sourceReferences.map((source, n) => (
          <li key={n}>
            {source.documentId} · {source.locator}
          </li>
        ))}
      </ul>
      <label>
        {t("unassigned")}
        <select
          className="w-full rounded-md border p-2"
          {...register(`assignments.${index}.groupId`)}
        >
          <option value="">{t("unassigned")}</option>
          {Object.values(RULE_CATALOG_GROUP_IDS).map((id) => (
            <option key={id} value={id}>
              {t(`groups.${id}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("rationaleEn")}
        <textarea
          className="w-full rounded-md border p-2"
          {...register(`assignments.${index}.rationaleEn`)}
        />
      </label>
      <label>
        {t("rationaleVi")}
        <textarea
          className="w-full rounded-md border p-2"
          {...register(`assignments.${index}.rationaleVi`)}
        />
      </label>
    </fieldset>
  );
}

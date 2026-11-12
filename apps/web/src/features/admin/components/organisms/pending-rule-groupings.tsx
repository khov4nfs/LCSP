"use client";
import Link from "next/link";
import { usePendingRuleGroupings } from "@/lib/api/rule-grouping-queries";
import { resolveAppMessage } from "@/lib/i18n";

export function PendingRuleGroupings() {
  const result = usePendingRuleGroupings();
  if (result.isPending)
    return <p>{resolveAppMessage("pages.ruleGrouping.loading")}</p>;
  if (result.isError)
    return (
      <p role="alert">{resolveAppMessage("pages.ruleGrouping.unavailable")}</p>
    );
  if (!result.data.versions.length) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border p-4">
      <h2 className="font-semibold">
        {resolveAppMessage("pages.ruleGrouping.title")}
      </h2>
      <ul>
        {result.data.versions.map((version) => (
          <li key={version.ruleSetVersionId}>
            <Link
              className="underline"
              href={`/admin/compliance-rule-sets/${encodeURIComponent(version.ruleSetVersionId)}`}
            >
              {version.version}
            </Link>
            {" · "}
            {resolveAppMessage(
              "pages.complianceRuleSets.assessmentRules",
            )}: {version.ruleCount}
          </li>
        ))}
      </ul>
    </section>
  );
}

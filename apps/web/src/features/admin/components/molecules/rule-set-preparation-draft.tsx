import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import { WorkDisclosure } from "@/components/molecules/work-disclosure";
import type { RuleSetPreparationDraftProps } from "../../types/compliance-rule-sets.types";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function RuleSetPreparationDraft({ draft }: RuleSetPreparationDraftProps) {
  return (
    <section className="rounded-lg border p-4" aria-live="polite">
      <h3 className="font-semibold">{t(`pages.complianceRuleSets.stages.${draft.stage}`)}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(draft.assessmentsCanUseRuleSet ? "pages.complianceRuleSets.draft.available" : "pages.complianceRuleSets.draft.unavailable")}
      </p>
      <dl className="my-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt>{t("pages.complianceRuleSets.activity.sourceCoverage")}</dt><dd>{draft.coverage.completed.toLocaleString()} / {draft.coverage.total.toLocaleString()}</dd></div>
        <div><dt>{t("pages.complianceRuleSets.draft.requirements")}</dt><dd>{draft.requirementCount.toLocaleString()}</dd></div>
        <div><dt>{t("pages.complianceRuleSets.draft.rules")}</dt><dd>{draft.assessmentRuleCount.toLocaleString()}</dd></div>
      </dl>
      <WorkDisclosure running={false} defaultExpanded={false} summary={t("pages.complianceRuleSets.draft.documents")}>
        <ul className="mt-2 list-inside list-disc text-sm">{draft.sourceDocuments.map((d) => <li key={d.documentId}>{d.title}</li>)}</ul>
      </WorkDisclosure>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <WorkDisclosure running={false} defaultExpanded={false} summary={t("pages.complianceRuleSets.draft.requirements")}>
          <ul className="mt-2 list-inside list-disc text-sm">{draft.requirements.map((r) => <li key={r.legalRequirementId}>{r.title}</li>)}</ul>
          {draft.requirementCount > draft.requirements.length ? <p className="text-xs text-muted-foreground">{t("pages.complianceRuleSets.draft.boundedPreview")}</p> : null}
        </WorkDisclosure>
        <WorkDisclosure running={false} defaultExpanded={false} summary={t("pages.complianceRuleSets.draft.rules")}>
          <ul className="mt-2 list-inside list-disc text-sm">{draft.assessmentRules.map((r) => <li key={r.assessmentRuleId}>{r.concept}</li>)}</ul>
          {draft.assessmentRuleCount > draft.assessmentRules.length ? <p className="text-xs text-muted-foreground">{t("pages.complianceRuleSets.draft.boundedPreview")}</p> : null}
        </WorkDisclosure>
      </div>
      {draft.coverage.blocked > 0 ? <p className="mt-3 text-sm text-destructive">{t("pages.complianceRuleSets.draft.blocked")} {draft.coverage.blocked.toLocaleString()}</p> : null}
      {draft.unresolvedReferences.length ? <WorkDisclosure running={false} defaultExpanded={false} summary={t("pages.complianceRuleSets.draft.references")}><ul className="mt-2 text-sm">{draft.unresolvedReferences.map((r) => <li className="wrap-break-word" key={`${r.sourceNodeId}:${r.referenceId}`}>{r.reason ?? r.referenceId}</li>)}</ul></WorkDisclosure> : null}
      {draft.validation?.failures.length ? (
        <div className="mt-3 text-sm text-destructive" role="alert">
          <h4 className="font-medium">{t("pages.complianceRuleSets.draft.validationErrors")}</h4>
          <ul className="list-inside list-disc">{draft.validation.failures.slice(0, 20).map((f, i) => <li key={`${f.code}:${f.ref}:${i}`}>{f.code}{f.detail ? `: ${f.detail}` : ""}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}

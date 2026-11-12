"use client";
import { useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  RULE_CATALOG_REVIEW_STATES,
  RULE_CATALOG_TAXONOMY_VERSION,
} from "@lcsp/contracts/assessment-domain";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import { useAppLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { useRuleGrouping } from "@/lib/api/rule-grouping-queries";
import {
  ruleGroupingFormSchema,
  type RuleGroupingForm,
} from "../../schemas/rule-grouping.schema";
import { RuleGroupingAssignment } from "../molecules/rule-grouping-assignment";
import { resolveMessage } from "@lcsp/i18n";
import type { RuleGroupingReviewProps } from "../../types/rule-grouping.types";

export function RuleGroupingReview({
  ruleSetVersionId,
}: RuleGroupingReviewProps) {
  useAppLocale();
  const t = (key: string) =>
    resolveAppMessage(`pages.ruleGrouping.${key}` as MessageKey);
  const workflow = useRuleGrouping(ruleSetVersionId);
  const [page, setPage] = useState(0);
  const form = useForm<RuleGroupingForm>({
    resolver: zodResolver(ruleGroupingFormSchema),
    shouldUnregister: false,
  });
  const proposal = workflow.proposal.data;
  const ledger = workflow.ledger.data;
  useEffect(() => {
    if (!proposal || !ledger) return;
    const existing = new Map(
      ledger.memberships.map((row) => [row.assessmentRuleId, row]),
    );
    form.reset({
      assignments: proposal.entries.map((entry) => {
        const previous = existing.get(entry.assessmentRuleId);
        return {
          groupId: previous?.groupId ?? entry.proposedGroupId ?? undefined,
          rationaleEn: previous?.rationaleEn ?? entry.proposedRationaleEn,
          rationaleVi: previous?.rationaleVi ?? entry.proposedRationaleVi,
        };
      }),
    });
  }, [proposal, ledger, form]);
  if (workflow.proposal.isPending || workflow.ledger.isPending)
    return <p>{t("loading")}</p>;
  if (!proposal || !ledger) return <p>{t("unavailable")}</p>;
  const approved =
    ledger.memberships.length === proposal.entries.length &&
    ledger.memberships.length > 0 &&
    ledger.memberships.every(
      (row) => row.state === RULE_CATALOG_REVIEW_STATES.APPROVED,
    );
  return (
    <section className="flex flex-col gap-4 rounded-md border p-4">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p>{t("description")}</p>
      <p>
        {t("status")}:{" "}
        {approved
          ? RULE_CATALOG_REVIEW_STATES.APPROVED
          : RULE_CATALOG_REVIEW_STATES.REVIEW_REQUIRED}
      </p>
      <p className="break-all">
        {t("digest")}: {ledger.membershipDigest}
      </p>
      <p>
        {t("submitter")}:{" "}
        {[...new Set(ledger.memberships.map((row) => row.submittedBy))].join(
          ", ",
        )}
      </p>
      <p>
        {t("reviewer")}:{" "}
        {[
          ...new Set(
            ledger.memberships.flatMap((row) =>
              row.approvedBy ? [row.approvedBy] : [],
            ),
          ),
        ].join(", ")}
      </p>
      <dl>
        <dt>{t("localizationReady")}</dt>
        <dd>{ledger.localization.ready}</dd>
        <dt>{t("localizationPending")}</dt>
        <dd>{ledger.localization.pending}</dd>
        <dt>{t("localizationFailed")}</dt>
        <dd>{ledger.localization.failed}</dd>
      </dl>
      <FormProvider {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) =>
            workflow.submit.mutate({
              ruleSetDigest: proposal.ruleSetDigest,
              memberships: proposal.entries.map((entry, index) => {
                const assignment = values.assignments[index];
                const { groupId } = assignment;
                return {
                  ...assignment,
                  assessmentRuleId: entry.assessmentRuleId,
                  assessmentRuleVersion: entry.assessmentRuleVersion,
                  actor: entry.actor,
                  lifecycleStage: entry.lifecycleStage,
                  sourceReferences: entry.sourceReferences,
                  ordinal: index,
                  taxonomyVersion: RULE_CATALOG_TAXONOMY_VERSION,
                  nameEn: resolveMessage(
                    "en",
                    `pages.ruleGrouping.groups.${groupId}`,
                  ),
                  nameVi: resolveMessage(
                    "vi",
                    `pages.ruleGrouping.groups.${groupId}`,
                  ),
                  descriptionEn: resolveMessage(
                    "en",
                    `pages.ruleGrouping.groupDescriptions.${groupId}`,
                  ),
                  descriptionVi: resolveMessage(
                    "vi",
                    `pages.ruleGrouping.groupDescriptions.${groupId}`,
                  ),
                };
              }),
            }),
          )}
        >
          {proposal.entries
            .slice(page * 50, (page + 1) * 50)
            .map((entry, n) => (
              <RuleGroupingAssignment
                key={entry.assessmentRuleId}
                entry={entry}
                index={page * 50 + n}
                readOnly={approved}
              />
            ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              {t("previous")}
            </Button>
            <Button
              type="button"
              disabled={(page + 1) * 50 >= proposal.entries.length}
              onClick={() => setPage(page + 1)}
            >
              {t("next")}
            </Button>
          </div>
          {Object.keys(form.formState.errors).length > 0 ||
          workflow.submit.isError ||
          workflow.approve.isError ? (
            <p role="alert">{t("invalid")}</p>
          ) : null}
          <Button
            type="submit"
            disabled={approved || workflow.submit.isPending}
          >
            {t("submit")}
          </Button>
        </form>
      </FormProvider>
      <Button
        type="button"
        disabled={
          approved ||
          form.formState.isDirty ||
          !ledger.memberships.length ||
          workflow.approve.isPending
        }
        onClick={() => workflow.approve.mutate(ledger.membershipDigest)}
      >
        {t("approve")}
      </Button>
    </section>
  );
}

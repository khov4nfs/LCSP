"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LEGAL_SOURCE_DELETION_REASON_CODES } from "@lcsp/contracts/legal-source";
import type { LegalSourceDetail } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeleteLegalSourceMutation,
  useLegalSourceDeletionImpactQuery,
} from "@/lib/api/legal-source-queries";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";

import {
  legalSourceDeletionFormSchema,
  type LegalSourceDeletionFormValues,
} from "../../schemas/legal-source-deletion-form-schema";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceDeleteDialog({
  source,
}: {
  source: LegalSourceDetail;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const impact = useLegalSourceDeletionImpactQuery(source.id, open);
  const deletion = useDeleteLegalSourceMutation(source.id);
  const form = useForm<LegalSourceDeletionFormValues>({
    resolver: zodResolver(legalSourceDeletionFormSchema),
    defaultValues: {
      confirmationSlug: "",
      reasonCode: LEGAL_SOURCE_DELETION_REASON_CODES.other,
      reasonText: "",
    },
  });
  const { reset } = form;
  const confirmationSlug = useWatch({
    control: form.control,
    name: "confirmationSlug",
  });

  useEffect(() => {
    if (!open)
      reset({
        confirmationSlug: "",
        reasonCode: LEGAL_SOURCE_DELETION_REASON_CODES.other,
        reasonText: "",
      });
  }, [open, reset]);

  async function submit(values: LegalSourceDeletionFormValues) {
    if (!impact.data || values.confirmationSlug !== impact.data.source.slug) {
      form.setError("confirmationSlug", {
        message: "pages.legalSources.deleteSlugMismatch",
      });
      return;
    }
    try {
      await deletion.mutateAsync({
        expectedImpactEtag: impact.data.snapshot.etag,
        confirmationSlug: values.confirmationSlug,
        reason: { code: values.reasonCode, text: values.reasonText },
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false);
      router.push("/admin/legal-sources");
    } catch (error) {
      form.setError("root.server", {
        message: legalSourceErrorMessageKey(error),
      });
    }
  }

  const blockers = impact.data?.eligibility.blockers ?? [];
  const isReady = Boolean(impact.data?.eligibility.eligibleAtSnapshot);
  const typedSlugMatches = impact.data?.source.slug === confirmationSlug.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        {t("pages.legalSources.permanentDelete")}
      </Button>
      <DialogContent closeLabel={t("pages.legalSources.cancel")}>
        <DialogHeader>
          <DialogTitle>
            {t("pages.legalSources.permanentDeleteTitle")}
          </DialogTitle>
          <DialogDescription>
            {formatAppMessage(
              "pages.legalSources.permanentDeleteDescription" as MessageKey,
              { name: source.name },
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)}>
          <DialogBody className="flex flex-col gap-4">
            {impact.isPending ? (
              <p role="status">
                {t("pages.legalSources.loadingDeletionImpact")}
              </p>
            ) : null}
            {impact.isError ? (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{t("pages.legalSources.deletionImpactFailed")}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void impact.refetch()}
                >
                  {t("pages.legalSources.tryAgain")}
                </Button>
              </div>
            ) : null}
            {impact.data ? (
              <div className="rounded-md border p-3 text-sm">
                <p>
                  {formatAppMessage(
                    "pages.legalSources.deletionCascadeSummary" as MessageKey,
                    {
                      versions: impact.data.versionCounts.total,
                      preparations: impact.data.cascade.preparationRuns,
                      ruleSets: impact.data.cascade.ruleSetVersions,
                    },
                  )}
                </p>
                {blockers.length ? (
                  <ul
                    className="mt-2 list-disc pl-5"
                    aria-label={t("pages.legalSources.deletionBlockers")}
                  >
                    {blockers.map((blocker) => (
                      <li key={blocker}>
                        {t(
                          `pages.legalSources.deletionBlockerLabels.${blocker}`,
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-source-delete-confirm">
                {t("pages.legalSources.confirmSourceSlug")}
              </Label>
              <Input
                id="legal-source-delete-confirm"
                autoComplete="off"
                {...form.register("confirmationSlug")}
              />
              {form.formState.errors.confirmationSlug ? (
                <p className="text-sm text-destructive">
                  {t(
                    form.formState.errors.confirmationSlug.message ??
                      "pages.legalSources.deleteSlugMismatch",
                  )}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-source-delete-reason-code">
                {t("pages.legalSources.deletionReason")}
              </Label>
              <select
                id="legal-source-delete-reason-code"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                {...form.register("reasonCode")}
              >
                {Object.entries(LEGAL_SOURCE_DELETION_REASON_CODES).map(
                  ([key, code]) => (
                    <option key={code} value={code}>
                      {t(`pages.legalSources.deletionReasons.${key}`)}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-source-delete-reason-text">
                {t("pages.legalSources.deletionReasonText")}
              </Label>
              <Textarea
                id="legal-source-delete-reason-text"
                rows={3}
                {...form.register("reasonText")}
              />
              {form.formState.errors.reasonText ? (
                <p className="text-sm text-destructive">
                  {t("pages.legalSources.deletionReasonRequired")}
                </p>
              ) : null}
            </div>
            {form.formState.errors.root?.server?.message ? (
              <p role="alert" className="text-sm text-destructive">
                {t(form.formState.errors.root.server.message)}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={deletion.isPending}
            >
              {t("pages.legalSources.cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isReady || !typedSlugMatches || deletion.isPending}
            >
              {t(
                deletion.isPending
                  ? "pages.legalSources.deletingSource"
                  : "pages.legalSources.confirmPermanentDelete",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

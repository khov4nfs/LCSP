"use client";

import { useEffect, useState, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LEGAL_SOURCE_DELETION_REASON_CODES } from "@lcsp/contracts/legal-source";
import type { LegalSourceDeleteDialogProps } from "../../types/legal-source-lifecycle.types";
import type { MessageKey } from "@lcsp/i18n";
import { LegalSourceDeletionResult } from "./legal-source-deletion-result";
import { LegalSourceDeletionImpactPanel } from "./legal-source-deletion-impact-panel";
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
  onDeleted,
}: LegalSourceDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const requestIdentity = useRef({ payload: "", key: "" });
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

  /**
   * Business purpose: Permanently delete a source only after a current impact preview, reason and exact identity confirmation.
   * Business rules: Fail closed on failed/loading impact or server blockers. Reuse the same idempotency key for the same request after an uncertain response; final authorization and retention checks stay transactional on the server.
   * Execution flow:
   * 1. Validate eligibility and the typed source slug against the current snapshot.
   * 2. Submit its etag, reason and stable idempotency key.
   * 3. Show the validated deletion receipt or refresh rejected impact and require confirmation again.
   * Failure cases: A server rejection leaves the dialog open; stale or blocked previews cannot authorize another delete.
   * Side effects: Calls the audited deletion endpoint, reconciles source caches and displays the durable receipt.
   */
  async function submit(values: LegalSourceDeletionFormValues) {
    if (!isReady || deletion.isPending) return;
    if (!impact.data || values.confirmationSlug !== impact.data.source.slug) {
      form.setError("confirmationSlug", {
        message: "pages.legalSources.deleteSlugMismatch",
      });
      return;
    }
    try {
      const payload = JSON.stringify([
        impact.data.snapshot.etag,
        values.confirmationSlug,
        values.reasonCode,
        values.reasonText,
      ]);
      if (requestIdentity.current.payload !== payload)
        requestIdentity.current = { payload, key: crypto.randomUUID() };
      const receipt = await deletion.mutateAsync({
        expectedImpactEtag: impact.data.snapshot.etag,
        confirmationSlug: values.confirmationSlug,
        reason: { code: values.reasonCode, text: values.reasonText },
        idempotencyKey: requestIdentity.current.key,
      });
      onDeleted?.(receipt);
    } catch (error) {
      form.setValue("confirmationSlug", "");
      void impact.refetch();
      form.setError("root.server", {
        message: legalSourceErrorMessageKey(error),
      });
    }
  }

  const isReady =
    Boolean(impact.data?.eligibility.eligibleAtSnapshot) &&
    !impact.isError &&
    !impact.isFetching;
  const typedSlugMatches = impact.data?.source.slug === confirmationSlug.trim();

  if (deletion.data)
    return <LegalSourceDeletionResult receipt={deletion.data} />;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!deletion.isPending) setOpen(next);
      }}
    >
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        {t("pages.legalSources.permanentDelete")}
      </Button>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={!deletion.isPending}
        closeLabel={t("pages.legalSources.cancel")}
      >
        <DialogHeader className="flex-col">
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
        <form onSubmit={(event) => void form.handleSubmit(submit)(event)}>
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
              <LegalSourceDeletionImpactPanel impact={impact.data} />
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={impact.isFetching || deletion.isPending}
              onClick={() => {
                form.setValue("confirmationSlug", "");
                void impact.refetch();
              }}
            >
              {t("pages.legalLifecycle.refresh")}
            </Button>
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

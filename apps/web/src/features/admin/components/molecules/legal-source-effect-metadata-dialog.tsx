"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type LegalSourceChunkStatus,
  type LegalSourceDocumentView,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

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
import { resolveAppMessage } from "@/lib/i18n";
import { useUpdateLegalSourceDocumentEffectMutation } from "@/lib/api/legal-source-queries";
import { LEGAL_SOURCE_CHUNK_STATUSES as Statuses } from "@lcsp/contracts/legal-source";
import {
  legalSourceEffectFormSchema,
  type LegalSourceEffectFormInput,
} from "../../schemas/legal-source-effect-form-schema";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";

const t = (key: string) => resolveAppMessage(key as MessageKey);
const statusValues = Object.values(Statuses) as LegalSourceChunkStatus[];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function initialValues(
  document: LegalSourceDocumentView,
): LegalSourceEffectFormInput {
  const provenance = record(document.provenance);
  const effect = record(provenance?.legalEffectMetadata);
  const status = effect?.status;
  return {
    status: statusValues.includes(status as LegalSourceChunkStatus)
      ? (status as LegalSourceChunkStatus)
      : Statuses.UNKNOWN,
    sourceRef: typeof effect?.sourceRef === "string" ? effect.sourceRef : "",
    effectiveDate: document.effectiveDate?.slice(0, 10) ?? "",
    provisionStatuses: JSON.stringify(
      provenance?.provisionStatuses ?? {},
      null,
      2,
    ),
  };
}

export function LegalSourceEffectMetadataDialog({
  versionId,
  document,
  open,
  onOpenChange,
  onError,
}: {
  versionId: string;
  document: LegalSourceDocumentView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (key: string) => void;
}) {
  const update = useUpdateLegalSourceDocumentEffectMutation(versionId);
  const form = useForm<
    LegalSourceEffectFormInput,
    undefined,
    ReturnType<typeof legalSourceEffectFormSchema.parse>
  >({
    resolver: zodResolver(legalSourceEffectFormSchema),
    defaultValues: initialValues(document),
  });

  useEffect(() => {
    if (open) form.reset(initialValues(document));
  }, [document, form, open]);

  async function save(
    values: ReturnType<typeof legalSourceEffectFormSchema.parse>,
  ) {
    try {
      await update.mutateAsync({ documentRowId: document.id, ...values });
      onOpenChange(false);
    } catch (error) {
      onError(legalSourceErrorMessageKey(error));
    }
  }

  const fieldError = (name: keyof LegalSourceEffectFormInput) => {
    const message = form.formState.errors[name]?.message;
    return typeof message === "string" ? t(message) : null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        closeLabel={t("pages.legalSources.cancel")}
      >
        <DialogHeader>
          <div className="flex flex-col gap-2">
            <DialogTitle>
              {t("pages.legalSources.updateEffectTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.legalSources.updateEffectDescription")}
            </DialogDescription>
          </div>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(save)}>
          <DialogBody>
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-effect-status">
                {t("pages.legalSources.legalEffectStatusLabel")}
              </Label>
              <select
                id="legal-effect-status"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...form.register("status")}
              >
                {statusValues.map((status) => (
                  <option key={status} value={status}>
                    {t(`pages.legalSources.effectStatuses.${status}`)}
                  </option>
                ))}
              </select>
              {fieldError("status") ? (
                <p className="text-sm text-destructive">
                  {fieldError("status")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-effect-source-ref">
                {t("pages.legalSources.effectSourceRefLabel")}
              </Label>
              <Input
                id="legal-effect-source-ref"
                {...form.register("sourceRef")}
              />
              <p className="text-sm text-muted-foreground">
                {t("pages.legalSources.effectDefaultHelper")}
              </p>
              {fieldError("sourceRef") ? (
                <p className="text-sm text-destructive">
                  {fieldError("sourceRef")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-effect-date">
                {t("pages.legalSources.effectiveDateLabel")}
              </Label>
              <Input
                id="legal-effect-date"
                type="date"
                {...form.register("effectiveDate")}
              />
              {fieldError("effectiveDate") ? (
                <p className="text-sm text-destructive">
                  {fieldError("effectiveDate")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="legal-effect-overrides">
                {t("pages.legalSources.effectOverridesLabel")}
              </Label>
              <Textarea
                id="legal-effect-overrides"
                rows={8}
                spellCheck={false}
                {...form.register("provisionStatuses")}
              />
              {fieldError("provisionStatuses") ? (
                <p className="text-sm text-destructive">
                  {fieldError("provisionStatuses")}
                </p>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("pages.legalSources.cancel")}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {t(
                update.isPending
                  ? "pages.legalSources.savingEffect"
                  : "pages.legalSources.saveEffect",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

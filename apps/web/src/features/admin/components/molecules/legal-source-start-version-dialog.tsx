"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { LegalSourceDetail } from "@lcsp/contracts/legal-source";
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
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { useCreateLegalSourceVersionMutation } from "@/lib/api/legal-source-queries";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { startLegalSourceVersionFormSchema } from "../../schemas/legal-source-form-schemas";
import type {
  StartLegalSourceVersionFormValues,
  StartLegalSourceVersionSubmission,
} from "../../types/legal-source-form-values";
import { LegalSourceSelectField } from "./legal-source-form-fields";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceStartVersionDialog({
  source,
}: {
  source: LegalSourceDetail;
}) {
  const [open, setOpen] = useState(false);
  const start = useCreateLegalSourceVersionMutation(source.id);
  const latestVersionId = source.latestVersion?.id ?? "";
  const form = useForm<
    StartLegalSourceVersionFormValues,
    unknown,
    StartLegalSourceVersionSubmission
  >({
    resolver: zodResolver(startLegalSourceVersionFormSchema),
    defaultValues: { basedOnVersionId: latestVersionId },
  });
  const { reset } = form;

  useEffect(() => {
    reset({ basedOnVersionId: latestVersionId });
  }, [latestVersionId, reset]);

  async function submit(values: StartLegalSourceVersionSubmission) {
    try {
      await start.mutateAsync(values);
      setOpen(false);
    } catch (error) {
      form.setError("root.server", {
        message: legalSourceErrorMessageKey(error),
      });
    }
  }

  const options = [
    {
      value: "",
      labelKey: "pages.legalSources.noEarlierVersion",
    },
    ...source.versions.map((version) => ({
      value: version.id,
      labelKey:
        version.id === latestVersionId
          ? "pages.legalSources.latestVersionOption"
          : undefined,
      label:
        version.id === latestVersionId
          ? formatAppMessage(
              "pages.legalSources.latestVersionOption" as MessageKey,
              { version: version.version },
            )
          : version.version,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("pages.legalSources.startNewVersion")}
      </Button>
      <DialogContent closeLabel={t("pages.legalSources.cancel")}>
        <DialogHeader>
          <DialogTitle>{t("pages.legalSources.startVersionTitle")}</DialogTitle>
          <DialogDescription>
            {t("pages.legalSources.startVersionDescription")}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)}>
            <DialogBody>
              <LegalSourceSelectField<StartLegalSourceVersionFormValues>
                name="basedOnVersionId"
                id="legal-source-based-on"
                labelKey="pages.legalSources.basedOnVersionLabel"
                options={options}
              />
              {form.formState.errors.root?.server?.message ? (
                <p className="text-sm text-destructive" role="alert">
                  {t(form.formState.errors.root.server.message)}
                </p>
              ) : null}
              <DialogFooter className="flex-row justify-end px-0 pb-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={start.isPending}
                >
                  {t("pages.legalSources.cancel")}
                </Button>
                <Button type="submit" disabled={start.isPending}>
                  {t(
                    start.isPending
                      ? "pages.legalSources.startingVersion"
                      : "pages.legalSources.startNewVersion",
                  )}
                </Button>
              </DialogFooter>
            </DialogBody>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

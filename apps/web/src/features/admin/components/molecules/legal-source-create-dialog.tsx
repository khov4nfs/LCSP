"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
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
import { resolveAppMessage } from "@/lib/i18n";
import { useCreateLegalSourceMutation } from "@/lib/api/legal-source-queries";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { createLegalSourceFormSchema } from "../../schemas/legal-source-form-schemas";
import type {
  CreateLegalSourceFormValues,
  CreateLegalSourceSubmission,
} from "../../types/legal-source-form-values";
import { LegalSourceTextField } from "./legal-source-form-fields";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceCreateDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateLegalSourceMutation();
  const form = useForm<
    CreateLegalSourceFormValues,
    unknown,
    CreateLegalSourceSubmission
  >({
    resolver: zodResolver(createLegalSourceFormSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  async function submit(values: CreateLegalSourceSubmission) {
    try {
      await create.mutateAsync(values);
      setOpen(false);
      form.reset();
    } catch (error) {
      form.setError("root.server", {
        message: legalSourceErrorMessageKey(error),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("pages.legalSources.createSource")}
      </Button>
      <DialogContent closeLabel={t("pages.legalSources.cancel")}>
        <DialogHeader>
          <DialogTitle>{t("pages.legalSources.createSourceTitle")}</DialogTitle>
          <DialogDescription>
            {t("pages.legalSources.createSourceDescription")}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form onSubmit={form.handleSubmit(submit)}>
            <DialogBody>
              <LegalSourceTextField<CreateLegalSourceFormValues>
                name="name"
                id="legal-source-name"
                labelKey="pages.legalSources.nameLabel"
                placeholderKey="pages.legalSources.namePlaceholder"
              />
              <LegalSourceTextField<CreateLegalSourceFormValues>
                name="slug"
                id="legal-source-slug"
                labelKey="pages.legalSources.slugLabel"
                placeholderKey="pages.legalSources.slugPlaceholder"
              />
              <LegalSourceTextField<CreateLegalSourceFormValues>
                name="description"
                id="legal-source-description"
                labelKey="pages.legalSources.descriptionLabel"
                placeholderKey="pages.legalSources.descriptionPlaceholder"
                multiline
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
                  disabled={form.formState.isSubmitting || create.isPending}
                >
                  {t("pages.legalSources.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={form.formState.isSubmitting || create.isPending}
                >
                  {form.formState.isSubmitting || create.isPending
                    ? t("pages.legalSources.submitting")
                    : t("pages.legalSources.submit")}
                </Button>
              </DialogFooter>
            </DialogBody>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

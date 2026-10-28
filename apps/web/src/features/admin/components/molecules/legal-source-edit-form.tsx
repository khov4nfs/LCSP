"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { LegalSourceDetail } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { useUpdateLegalSourceMutation } from "@/lib/api/legal-source-queries";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { updateLegalSourceFormSchema } from "../../schemas/legal-source-form-schemas";
import type {
  UpdateLegalSourceFormValues,
  UpdateLegalSourceSubmission,
} from "../../types/legal-source-form-values";
import { LegalSourceTextField } from "./legal-source-form-fields";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceEditForm({ source }: { source: LegalSourceDetail }) {
  const update = useUpdateLegalSourceMutation(source.id);
  const form = useForm<
    UpdateLegalSourceFormValues,
    unknown,
    UpdateLegalSourceSubmission
  >({
    resolver: zodResolver(updateLegalSourceFormSchema),
    defaultValues: {
      name: source.name,
      description: source.description ?? "",
    },
  });

  useEffect(() => {
    form.reset({ name: source.name, description: source.description ?? "" });
  }, [form, source.description, source.name]);

  async function submit(values: UpdateLegalSourceSubmission) {
    try {
      await update.mutateAsync(values);
      form.clearErrors("root.server");
    } catch (error) {
      form.setError("root.server", {
        message: legalSourceErrorMessageKey(error),
      });
    }
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        className="flex flex-col gap-4"
      >
        <LegalSourceTextField<UpdateLegalSourceFormValues>
          name="name"
          id="legal-source-edit-name"
          labelKey="pages.legalSources.nameLabel"
        />
        <LegalSourceTextField<UpdateLegalSourceFormValues>
          name="description"
          id="legal-source-edit-description"
          labelKey="pages.legalSources.descriptionLabel"
          multiline
        />
        {form.formState.errors.root?.server?.message ? (
          <p className="text-sm text-destructive" role="alert">
            {t(form.formState.errors.root.server.message)}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            disabled={update.isPending || !form.formState.isDirty}
          >
            {t(
              update.isPending
                ? "pages.legalSources.saving"
                : "pages.legalSources.saveChanges",
            )}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

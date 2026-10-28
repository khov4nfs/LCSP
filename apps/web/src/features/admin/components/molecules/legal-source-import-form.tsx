"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  type ImportLegalSourceDocumentRequest,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";
import { FormProvider, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { useImportLegalSourceDocumentMutation } from "@/lib/api/legal-source-queries";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { importLegalSourceDocumentFormSchema } from "../../schemas/legal-source-form-schemas";
import type {
  ImportLegalSourceDocumentFormValues,
  ImportLegalSourceDocumentSubmission,
} from "../../types/legal-source-form-values";
import { LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS } from "../../config/legal-source-display.config";
import {
  LegalSourceSelectField,
  LegalSourceTextField,
} from "./legal-source-form-fields";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceImportForm({ versionId }: { versionId: string }) {
  const importDocument = useImportLegalSourceDocumentMutation(versionId);
  const form = useForm<
    ImportLegalSourceDocumentFormValues,
    unknown,
    ImportLegalSourceDocumentSubmission
  >({
    resolver: zodResolver(importLegalSourceDocumentFormSchema),
    defaultValues: {
      url: "",
      title: "",
      structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
      sourceEffectStatus: "",
      effectiveDate: "",
      provisionStatusesJson: "",
    },
  });

  async function submit(values: ImportLegalSourceDocumentSubmission) {
    const request: ImportLegalSourceDocumentRequest = values;
    try {
      await importDocument.mutateAsync(request);
      form.reset();
    } catch (error) {
      const messageKey = legalSourceErrorMessageKey(error);
      form.setError("root.server", { message: messageKey });
    }
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(submit)}
        className="flex flex-col gap-4"
      >
        <LegalSourceTextField<ImportLegalSourceDocumentFormValues>
          name="url"
          id="legal-source-import-url"
          labelKey="pages.legalSources.urlLabel"
          placeholderKey="pages.legalSources.urlPlaceholder"
          helperKey="pages.legalSources.urlHelper"
          type="url"
        />
        <LegalSourceTextField<ImportLegalSourceDocumentFormValues>
          name="title"
          id="legal-source-import-title"
          labelKey="pages.legalSources.titleLabel"
        />
        <LegalSourceSelectField<ImportLegalSourceDocumentFormValues>
          name="structureProfile"
          id="legal-source-import-structure-profile"
          labelKey="pages.legalSources.structureProfileLabel"
          helperKey="pages.legalSources.structureProfileHelper"
          options={LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS.map((option) => ({
            ...option,
          }))}
        />
        <LegalSourceTextField<ImportLegalSourceDocumentFormValues>
          name="sourceEffectStatus"
          id="legal-source-import-effect-status"
          labelKey="pages.legalSources.sourceEffectStatusLabel"
        />
        <LegalSourceTextField<ImportLegalSourceDocumentFormValues>
          name="effectiveDate"
          id="legal-source-import-effective-date"
          labelKey="pages.legalSources.effectiveDateLabel"
          type="date"
        />
        <LegalSourceTextField<ImportLegalSourceDocumentFormValues>
          name="provisionStatusesJson"
          id="legal-source-import-provision-statuses"
          labelKey="pages.legalSources.provisionStatusesLabel"
          helperKey="pages.legalSources.provisionStatusesHelper"
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
            disabled={importDocument.isPending || form.formState.isSubmitting}
          >
            {t(
              importDocument.isPending
                ? "pages.legalSources.submittingDocument"
                : "pages.legalSources.import",
            )}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

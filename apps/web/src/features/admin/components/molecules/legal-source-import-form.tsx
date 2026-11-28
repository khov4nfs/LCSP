"use client";

import type { LegalSourceDocumentFormProps } from "../../types/legal-source-lifecycle.types";

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
import {
  LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS,
  LEGAL_SOURCE_PURPOSE_OPTIONS,
} from "../../config/legal-source-display.config";
import {
  LegalSourceSelectField,
  LegalSourceTextField,
} from "./legal-source-form-fields";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceImportForm({
  versionId,
  onSuccess,
}: LegalSourceDocumentFormProps) {
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
      corpusRole: LEGAL_SOURCE_PURPOSE_OPTIONS[0].value,
      structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILES.AUTO,
      sourceEffectStatus: "",
      effectiveDate: "",
      provisionStatusesJson: "",
    },
  });

  /**
   * Business purpose: Submit a draft document with its persisted corpus purpose and supplied effect metadata.
   * Business rules: Purpose uses the shared corpus-role contract and never establishes official legal admission; authorization and draft eligibility remain server-owned.
   * Execution flow:
   * 1. Validate the form and submit its document and metadata through the domain mutation.
   * 2. Reset input and notify the container only after a validated server success.
   * Failure cases: Validation or upstream failures retain input and show the localized error so the administrator can retry.
   * Side effects: Calls document ingestion, which persists bytes/metadata and queues processing and audit; updates form and dialog state.
   */
  async function submit(values: ImportLegalSourceDocumentSubmission) {
    const request: ImportLegalSourceDocumentRequest = values;
    try {
      await importDocument.mutateAsync(request);
      form.reset();
      onSuccess?.();
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
        <fieldset
          disabled={form.formState.isSubmitting}
          className="flex min-w-0 flex-col gap-4"
        >
          <LegalSourceSelectField<ImportLegalSourceDocumentFormValues>
            name="corpusRole"
            id="legal-source-import-purpose"
            labelKey="pages.legalLifecycle.purpose"
            helperKey="pages.legalLifecycle.purposeHelp"
            options={[...LEGAL_SOURCE_PURPOSE_OPTIONS]}
          />
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
        </fieldset>
      </form>
    </FormProvider>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_SUPPORTED_MEDIA_TYPES,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";
import { FormProvider, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { useUploadLegalSourceDocumentMutation } from "@/lib/api/legal-source-queries";
import { legalSourceErrorMessageKey } from "../../lib/legal-source-errors";
import { uploadLegalSourceDocumentFormSchema } from "../../schemas/legal-source-form-schemas";
import type {
  UploadLegalSourceDocumentFormValues,
  UploadLegalSourceDocumentSubmission,
} from "../../types/legal-source-form-values";
import { LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS } from "../../config/legal-source-display.config";
import {
  LegalSourceFileField,
  LegalSourceSelectField,
  LegalSourceTextField,
} from "./legal-source-form-fields";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceUploadForm({ versionId }: { versionId: string }) {
  const upload = useUploadLegalSourceDocumentMutation(versionId);
  const form = useForm<
    UploadLegalSourceDocumentFormValues,
    unknown,
    UploadLegalSourceDocumentSubmission
  >({
    resolver: zodResolver(uploadLegalSourceDocumentFormSchema),
    defaultValues: {
      file: undefined,
      title: "",
      structureProfile: LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS[0].value,
      sourceEffectStatus: "",
      effectiveDate: "",
      provisionStatusesJson: "",
    },
  });

  async function submit(values: UploadLegalSourceDocumentSubmission) {
    const body = new FormData();
    body.set("file", values.file);
    body.set("structureProfile", values.structureProfile);
    if (values.title) body.set("title", values.title);
    if (values.sourceEffectStatus)
      body.set("sourceEffectStatus", values.sourceEffectStatus);
    if (values.effectiveDate) body.set("effectiveDate", values.effectiveDate);
    if (values.provisionStatuses) {
      body.set("provisionStatuses", JSON.stringify(values.provisionStatuses));
    }
    try {
      await upload.mutateAsync(body);
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
        <LegalSourceFileField<UploadLegalSourceDocumentFormValues>
          name="file"
          id="legal-source-file"
          labelKey="pages.legalSources.fileLabel"
          helperKey="pages.legalSources.fileHelper"
          helperValues={{
            maxSize: Math.floor(
              LEGAL_SOURCE_LIMITS.maxDocumentBytes / (1024 * 1024),
            ),
          }}
          accept={LEGAL_SOURCE_SUPPORTED_MEDIA_TYPES.join(",")}
        />
        <LegalSourceTextField<UploadLegalSourceDocumentFormValues>
          name="title"
          id="legal-source-document-title"
          labelKey="pages.legalSources.titleLabel"
        />
        <LegalSourceSelectField<UploadLegalSourceDocumentFormValues>
          name="structureProfile"
          id="legal-source-structure-profile"
          labelKey="pages.legalSources.structureProfileLabel"
          helperKey="pages.legalSources.structureProfileHelper"
          options={LEGAL_SOURCE_STRUCTURE_PROFILE_OPTIONS.map((option) => ({
            ...option,
          }))}
        />
        <LegalSourceTextField<UploadLegalSourceDocumentFormValues>
          name="sourceEffectStatus"
          id="legal-source-effect-status"
          labelKey="pages.legalSources.sourceEffectStatusLabel"
        />
        <LegalSourceTextField<UploadLegalSourceDocumentFormValues>
          name="effectiveDate"
          id="legal-source-effective-date"
          labelKey="pages.legalSources.effectiveDateLabel"
          type="date"
        />
        <LegalSourceTextField<UploadLegalSourceDocumentFormValues>
          name="provisionStatusesJson"
          id="legal-source-provision-statuses"
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
            disabled={upload.isPending || form.formState.isSubmitting}
          >
            {t(
              upload.isPending
                ? "pages.legalSources.submittingDocument"
                : "pages.legalSources.upload",
            )}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

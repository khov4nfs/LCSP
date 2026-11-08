"use client";
import { useFormContext } from "react-hook-form";
import {
  AUTHORED_LOCALIZATION_OPERATIONAL_STATES,
  AUTHORED_SOURCE_LANGUAGES,
} from "@lcsp/contracts/assessment-domain";
import type { MessageKey } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import type { LocalizationReviewForm } from "../../schemas/localization-review.schema";
import type { LocalizationQueueItemFieldProps } from "../../types/localization-review.types";

/**
 * Business purpose: Render one authored localization field request with exact provenance and review controls.
 * Business rules:
 * - Binds through react-hook-form context; displays exact fieldPath, canonicalRevision, originSha256 and candidate/revision text.
 * Execution flow:
 * 1. Register selection, sourceLanguage and normalizedContent fields and expose single-item review actions.
 * Failure cases:
 * - Disabled when a parent mutation is in flight; server remains authoritative for hash and state validation.
 * Side effects:
 * - Updates form state or invokes parent action callbacks.
 */
export function LocalizationQueueItemField({
  item,
  index,
  disabled,
  onReviewSource,
  onApproveOutput,
  onRejectCandidate,
  onRetryRequest,
}: LocalizationQueueItemFieldProps) {
  const { register } = useFormContext<LocalizationReviewForm>();
  const t = (key: string) =>
    resolveAppMessage(`pages.localizationReview.${key}` as MessageKey);
  const currentOutput = item.revision?.content ?? item.candidate?.content ?? "";
  return (
    <fieldset
      disabled={disabled}
      className="flex min-w-0 flex-col gap-3 rounded-md border p-4"
      data-slot="localization-queue-item"
    >
      <legend className="font-mono text-xs font-semibold">
        {item.entityType} · {item.entityId} · {item.fieldPath} ·{" "}
        {item.locale.toUpperCase()}
      </legend>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            {...register(`items.${index}.selected`)}
            aria-label={`${item.fieldPath} (${item.locale})`}
          />
          <span>{item.operationalState}</span>
        </label>
        <span>
          {t("canonicalRevision")}: {item.canonicalRevision}
        </span>
        <span className="break-all font-mono">
          {t("originSha256")}: {item.originSha256}
        </span>
      </div>
      <p className="text-sm">
        <strong>{t("originalContent")}:</strong> {item.originalContent}
      </p>
      {currentOutput ? (
        <p className="text-sm">
          <strong>{t("candidateContent")}:</strong> {currentOutput}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("sourceLanguage")}</span>
          <select
            className="w-full rounded-md border p-2"
            {...register(`items.${index}.sourceLanguage`)}
          >
            {Object.values(AUTHORED_SOURCE_LANGUAGES).map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("normalizedContent")}</span>
          <textarea
            className="w-full rounded-md border p-2"
            rows={2}
            {...register(`items.${index}.normalizedContent`)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onReviewSource(index)}
        >
          {t("reviewSourceSubmit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onApproveOutput(index)}
        >
          {t("approveOutputSubmit")}
        </Button>
        {item.candidate &&
        item.operationalState !==
          AUTHORED_LOCALIZATION_OPERATIONAL_STATES.READY ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRejectCandidate(index)}
          >
            {t("rejectCandidateSubmit")}
          </Button>
        ) : null}
        {item.operationalState !==
        AUTHORED_LOCALIZATION_OPERATIONAL_STATES.READY ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRetryRequest(index)}
          >
            {t("retryRequestSubmit")}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

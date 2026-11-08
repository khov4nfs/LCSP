"use client";
import { useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AUTHORED_CANDIDATE_ACTIONS } from "@lcsp/contracts/assessment-domain";
import type { MessageKey } from "@lcsp/i18n";
import { useAppLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { useLocalizationScopeReview } from "@/lib/api/localization-admin-queries";
import { resolveAppMessage } from "@/lib/i18n";
import {
  localizationReviewFormSchema,
  type LocalizationReviewForm,
} from "../../schemas/localization-review.schema";
import type { LocalizationScopeReviewProps } from "../../types/localization-review.types";
import { LocalizationQueueItemField } from "../molecules/localization-queue-item-field";

/**
 * Business purpose: Compute the exact UTF-8 SHA-256 digest of a reviewed target string before submitting output approval.
 * Business rules:
 * - Uses standard Web Crypto SHA-256 over UTF-8 bytes so the client binds to the exact normalized string.
 * Execution flow:
 * 1. Encode UTF-8 bytes, hash via crypto.subtle and format lowercase hex.
 * Failure cases:
 * - Rejects if Web Crypto is unavailable.
 * Side effects:
 * - None: pure cryptographic hash.
 */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Business purpose: Provide the governed Admin workflow for field-level source-language attestation, candidate review, normalization, rejection, retry and bounded batch review.
 * Business rules:
 * - Uses react-hook-form and zod validation; batch actions are bounded to 50 items and require explicit confirmation checkboxes.
 * Execution flow:
 * 1. Load scope localization requests and initialize form state.
 * 2. Dispatch single-item or bounded-batch mutations with server-verified SHA-256 and revision bindings.
 * Failure cases:
 * - Missing evidence/confirmations or upstream conflicts display an explicit alert without fabricating readiness.
 * Side effects:
 * - Submits authenticated Admin localization review mutations and refreshes scope/backlog caches.
 */
export function LocalizationScopeReview({
  scopeId,
}: LocalizationScopeReviewProps) {
  useAppLocale();
  const t = (key: string) =>
    resolveAppMessage(`pages.localizationReview.${key}` as MessageKey);
  const workflow = useLocalizationScopeReview(scopeId);
  const [actionError, setActionError] = useState(false);
  const form = useForm<LocalizationReviewForm>({
    resolver: zodResolver(localizationReviewFormSchema),
    defaultValues: {
      evidence: "",
      confirmsIndividualFieldReview: false,
      confirmsTargetLanguageAndMeaning: false,
      items: [],
    },
  });
  const items = workflow.queue.data;

  useEffect(() => {
    if (!items) return;
    const currentValues = form.getValues();
    form.reset({
      evidence: currentValues.evidence || "",
      confirmsIndividualFieldReview:
        currentValues.confirmsIndividualFieldReview ?? false,
      confirmsTargetLanguageAndMeaning:
        currentValues.confirmsTargetLanguageAndMeaning ?? false,
      items: items.map((item) => ({
        requestId: item.id,
        selected: false,
        sourceLanguage: item.sourceLanguage,
        normalizedContent: "",
      })),
    });
  }, [items, form]);

  if (workflow.queue.isPending) return <p>{t("loading")}</p>;
  if (workflow.queue.isError || !items)
    return <p role="alert">{t("unavailable")}</p>;
  if (!items.length) return <p>{t("empty")}</p>;

  const busy =
    workflow.reviewSource.isPending ||
    workflow.reviewOutput.isPending ||
    workflow.batchSource.isPending ||
    workflow.batchOutput.isPending ||
    workflow.retryOrReject.isPending;

  async function handleReviewSource(index: number) {
    setActionError(false);
    const values = form.getValues();
    const row = items![index];
    const formItem = values.items[index];
    if (!row || !formItem || values.evidence.trim().length < 10) {
      setActionError(true);
      return;
    }
    try {
      await workflow.reviewSource.mutateAsync({
        requestId: row.id,
        body: {
          originSha256: row.originSha256,
          canonicalRevision: row.canonicalRevision,
          sourceLanguage: formItem.sourceLanguage,
          evidence: values.evidence.trim(),
        },
      });
    } catch {
      setActionError(true);
    }
  }

  async function handleApproveOutput(index: number) {
    setActionError(false);
    const values = form.getValues();
    const row = items![index];
    const formItem = values.items[index];
    if (
      !row ||
      !formItem ||
      !values.confirmsTargetLanguageAndMeaning ||
      values.evidence.trim().length < 10
    ) {
      setActionError(true);
      return;
    }
    const normalized = formItem.normalizedContent.trim();
    const contentSha256 = normalized
      ? await sha256Hex(normalized)
      : (row.candidate?.contentSha256 ??
        row.revision?.contentSha256 ??
        row.originSha256);
    try {
      await workflow.reviewOutput.mutateAsync({
        requestId: row.id,
        body: {
          originSha256: row.originSha256,
          contentSha256,
          ...(normalized ? { normalizedContent: normalized } : {}),
          confirmsTargetLanguageAndMeaning: true,
          evidence: values.evidence.trim(),
        },
      });
    } catch {
      setActionError(true);
    }
  }

  async function handleRejectCandidate(index: number) {
    setActionError(false);
    const values = form.getValues();
    const row = items![index];
    if (!row || !row.candidate || values.evidence.trim().length < 10) {
      setActionError(true);
      return;
    }
    try {
      await workflow.retryOrReject.mutateAsync({
        requestId: row.id,
        body: {
          action: AUTHORED_CANDIDATE_ACTIONS.REJECT,
          originSha256: row.originSha256,
          canonicalRevision: row.canonicalRevision,
          candidateSha256: row.candidate.contentSha256,
          evidence: values.evidence.trim(),
        },
      });
    } catch {
      setActionError(true);
    }
  }

  async function handleRetryRequest(index: number) {
    setActionError(false);
    const values = form.getValues();
    const row = items![index];
    if (!row || values.evidence.trim().length < 10) {
      setActionError(true);
      return;
    }
    try {
      await workflow.retryOrReject.mutateAsync({
        requestId: row.id,
        body: {
          action: AUTHORED_CANDIDATE_ACTIONS.RETRY,
          originSha256: row.originSha256,
          canonicalRevision: row.canonicalRevision,
          evidence: values.evidence.trim(),
        },
      });
    } catch {
      setActionError(true);
    }
  }

  async function handleBatchSource() {
    setActionError(false);
    const values = form.getValues();
    const selected = values.items
      .map((item, idx) => ({ item, row: items![idx] }))
      .filter((entry) => entry.item.selected && entry.row)
      .slice(0, 50);
    if (
      !selected.length ||
      !values.confirmsIndividualFieldReview ||
      values.evidence.trim().length < 10
    ) {
      setActionError(true);
      return;
    }
    try {
      await workflow.batchSource.mutateAsync({
        confirmsIndividualFieldReview: true,
        evidence: values.evidence.trim(),
        items: selected.map(({ item, row }) => ({
          requestId: row.id,
          originSha256: row.originSha256,
          canonicalRevision: row.canonicalRevision,
          sourceLanguage: item.sourceLanguage,
        })),
      });
    } catch {
      setActionError(true);
    }
  }

  async function handleBatchOutput() {
    setActionError(false);
    const values = form.getValues();
    const selected = values.items
      .map((item, idx) => ({ item, row: items![idx] }))
      .filter((entry) => entry.item.selected && entry.row)
      .slice(0, 50);
    if (
      !selected.length ||
      !values.confirmsTargetLanguageAndMeaning ||
      values.evidence.trim().length < 10
    ) {
      setActionError(true);
      return;
    }
    try {
      const batchItems = await Promise.all(
        selected.map(async ({ item, row }) => {
          const normalized = item.normalizedContent.trim();
          const contentSha256 = normalized
            ? await sha256Hex(normalized)
            : (row.candidate?.contentSha256 ??
              row.revision?.contentSha256 ??
              row.originSha256);
          return {
            requestId: row.id,
            originSha256: row.originSha256,
            contentSha256,
            ...(normalized ? { normalizedContent: normalized } : {}),
          };
        }),
      );
      await workflow.batchOutput.mutateAsync({
        confirmsTargetLanguageAndMeaning: true,
        evidence: values.evidence.trim(),
        items: batchItems,
      });
    } catch {
      setActionError(true);
    }
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-md border p-4"
      data-slot="localization-scope-review"
    >
      <h2 className="text-lg font-semibold">{t("scopeTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("scopeDescription")}</p>
      <FormProvider {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("evidenceLabel")}</span>
            <textarea
              className="w-full rounded-md border p-2"
              rows={2}
              {...form.register("evidence")}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...form.register("confirmsIndividualFieldReview")}
            />
            <span>{t("confirmsIndividualFieldReview")}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...form.register("confirmsTargetLanguageAndMeaning")}
            />
            <span>{t("confirmsTargetLanguageAndMeaning")}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void handleBatchSource()}
            >
              {t("batchSourceSubmit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void handleBatchOutput()}
            >
              {t("batchOutputSubmit")}
            </Button>
          </div>
          {actionError ? <p role="alert">{t("invalid")}</p> : null}
          <div className="flex flex-col gap-3">
            {items.slice(0, 50).map((item, index) => (
              <LocalizationQueueItemField
                key={item.id}
                item={item}
                index={index}
                disabled={busy}
                onReviewSource={(idx) => void handleReviewSource(idx)}
                onApproveOutput={(idx) => void handleApproveOutput(idx)}
                onRejectCandidate={(idx) => void handleRejectCandidate(idx)}
                onRetryRequest={(idx) => void handleRetryRequest(idx)}
              />
            ))}
          </div>
        </form>
      </FormProvider>
    </section>
  );
}

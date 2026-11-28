"use client";

import { useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  discoveryContextAnswerSchema,
  type DiscoveryContextAnswer,
} from "../../schemas/discovery-context-answer.schema";
import { copy } from "../../utils/conversation-copy";

export type DiscoveryContextQuestion = {
  useCaseId: string;
  useCaseName: string;
  question: string;
};

/**
 * Business purpose: Collect one customer-authored operational answer without assuming it is already a verified fact.
 * Business rules:
 * - Inputs are bounded by the shared answer schema; only a current owner-enabled question may be submitted.
 * - Each failed retry uses the same idempotency UUID and never automatically accepts a fact.
 * Execution flow:
 * 1. Validate the draft with react-hook-form and forward the exact question/use-case pair.
 * 2. Reset the draft and idempotency key only after durable API acceptance.
 * Failure cases:
 * - Invalid text and submission failures keep the original answer available for correction.
 * Side effects:
 * - May enqueue one PENDING_REVIEW answer through the parent; no audit scope or decision is created.
 */
export function DiscoveryContextQuestionForm({
  entry,
  disabled,
  isPending,
  submitLabelKey = "ruleAudit.discovery.submitAnswer",
  placeholderKey = "ruleAudit.discovery.answerPlaceholder",
  onSubmitAnswer,
}: {
  entry: DiscoveryContextQuestion;
  disabled: boolean;
  isPending: boolean;
  submitLabelKey?: string;
  placeholderKey?: string;
  onSubmitAnswer: (data: {
    idempotencyKey: string;
    useCaseId: string;
    question: string;
    answer: string;
  }) => Promise<unknown>;
}) {
  const form = useForm<DiscoveryContextAnswer>({
    resolver: zodResolver(discoveryContextAnswerSchema),
    defaultValues: { answer: "" },
  });
  const retryKey = useRef<string | null>(null);

  /**
   * Business purpose: Preserve a source-bound operational answer as review-only customer input.
   * Business rules:
   * - The exact use-case/question and stable idempotency key are forwarded until the API confirms persistence.
   * Execution flow:
   * 1. Submit the validated answer and clear only a successful draft.
   * Failure cases:
   * - Network or business conflicts retain the draft and idempotency key for retry.
   * Side effects:
   * - May issue one owner-authorized proposal request.
   */
  async function submit(data: DiscoveryContextAnswer) {
    retryKey.current ??= crypto.randomUUID();
    try {
      await onSubmitAnswer({
        idempotencyKey: retryKey.current,
        useCaseId: entry.useCaseId,
        question: entry.question,
        answer: data.answer,
      });
      retryKey.current = null;
      form.reset();
    } catch {
      // The parent mutation displays the canonical error; preserve the draft and retry key.
    }
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="space-y-2"
      >
        <Textarea
          aria-label={copy(placeholderKey)}
          placeholder={copy(placeholderKey)}
          rows={2}
          maxLength={2000}
          disabled={disabled || isPending}
          {...form.register("answer")}
        />
        {form.formState.errors.answer ? (
          <p role="alert" className="text-sm text-destructive">
            {copy("ruleAudit.discovery.answerInvalid")}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={disabled || isPending || !form.formState.isDirty}
        >
          {copy(submitLabelKey)}
        </Button>
      </form>
    </FormProvider>
  );
}

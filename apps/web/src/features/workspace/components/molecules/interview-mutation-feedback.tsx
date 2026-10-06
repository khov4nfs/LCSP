"use client";

import { resolveMessage } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import { isInterviewMutationConflict } from "@/lib/api/interview-mutation-recovery";
import { appLocale } from "@/lib/locale";

type InterviewMutationFeedbackProps = {
  error: unknown;
  busy: boolean;
  canRetryOriginal: boolean;
  retainedDraft?: string;
  onRetryOriginal: () => void;
  onRefresh: () => void;
};

/** Recovery is explicit; never auto-apply a rejected draft to the next question. */
export function InterviewMutationFeedback({
  error,
  busy,
  canRetryOriginal,
  retainedDraft,
  onRetryOriginal,
  onRefresh,
}: InterviewMutationFeedbackProps) {
  if (!error) return null;
  return (
    <section role="alert" className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <p>{resolveMessage(appLocale, isInterviewMutationConflict(error)
        ? "pages.assessment.interviewMutationConflict"
        : "pages.assessment.interviewMutationUnconfirmed")}</p>
      {retainedDraft ? (
        <div className="space-y-1">
          <p className="font-medium">{resolveMessage(appLocale, "pages.assessment.interviewRetainedDraft")}</p>
          <p className="whitespace-pre-wrap break-words text-muted-foreground">{retainedDraft}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canRetryOriginal ? (
          <Button type="button" size="sm" disabled={busy} onClick={onRetryOriginal}>
            {resolveMessage(appLocale, "pages.assessment.interviewRetryOriginal")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
          {resolveMessage(appLocale, "pages.assessment.interviewRefreshState")}
        </Button>
      </div>
    </section>
  );
}

"use client";

import { resolveMessage } from "@lcsp/i18n";
import { ArrowUpIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

type AssessmentComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  sendLabel?: string;
  disabled?: boolean;
  submitting?: boolean;
  className?: string;
};

export function AssessmentComposer({
  value,
  onValueChange,
  onSubmit,
  placeholder = t("pages.appShell.chatComposerPlaceholder"),
  sendLabel = t("pages.appShell.chatSend"),
  disabled = false,
  submitting = false,
  className,
}: AssessmentComposerProps) {
  const sendDisabled = disabled || submitting || value.trim().length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendDisabled) {
      return;
    }
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form
      data-slot="assessment-composer"
      onSubmit={handleSubmit}
      className={cn(
        "relative mx-auto h-12 w-full max-w-[760px] rounded-2xl border border-input bg-background shadow-sm",
        className,
      )}
    >
      <Textarea
        rows={1}
        value={value}
        disabled={disabled || submitting}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-h-0 resize-none border-0 bg-transparent px-4 py-3 pr-12 text-sm leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
      />
      <Button
        type="submit"
        size="icon"
        disabled={sendDisabled}
        aria-label={sendLabel}
        className="absolute top-1/2 right-2 size-8 -translate-y-1/2 rounded-full"
      >
        <ArrowUpIcon className="size-4" aria-hidden="true" />
      </Button>
    </form>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

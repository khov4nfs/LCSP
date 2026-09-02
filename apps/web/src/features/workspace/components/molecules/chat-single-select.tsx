"use client";

import { resolveMessage } from "@lcsp/i18n";
import { CheckIcon } from "lucide-react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { ChatSingleSelectOption } from "../../types/assessment-chat.types";

type ChatSingleSelectProps = {
  options: ChatSingleSelectOption[];
  value?: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function ChatSingleSelect({
  options,
  value,
  onValueChange,
  disabled = false,
  ariaLabel = t("pages.appShell.chatOptionsLabel"),
  className,
}: ChatSingleSelectProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("grid gap-2", className)}
    >
      {options.map((option) => {
        const selected = option.id === value;
        const optionDisabled = disabled || option.disabled;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={optionDisabled}
            onClick={() => onValueChange(option.id)}
            className={cn(
              "flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "border-foreground/20 bg-muted/80"
                : "border-border/70 bg-background hover:bg-muted/50",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            {selected ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

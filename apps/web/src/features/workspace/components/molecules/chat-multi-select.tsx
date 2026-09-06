"use client";

import { resolveMessage } from "@lcsp/i18n";
import { CheckIcon } from "lucide-react";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { ChatMultiSelectOption } from "../../types/assessment-chat.types";

type ChatMultiSelectProps = {
  options: ChatMultiSelectOption[];
  values?: string[];
  onValuesChange: (values: string[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function ChatMultiSelect({
  options,
  values = [],
  onValuesChange,
  disabled = false,
  ariaLabel = t("pages.appShell.chatOptionsLabel"),
  className,
}: ChatMultiSelectProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedSet = new Set(values);

  const enabledOptionIndexes = options.reduce<number[]>(
    (indexes, option, index) => {
      if (!option.disabled) {
        indexes.push(index);
      }
      return indexes;
    },
    [],
  );

  function toggleOption(optionId: string) {
    if (disabled) {
      return;
    }
    const nextValues = selectedSet.has(optionId)
      ? values.filter((id) => id !== optionId)
      : [...values, optionId];
    onValuesChange(nextValues);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) {
    const focusedEnabledIndex = enabledOptionIndexes.indexOf(optionIndex);
    const activeEnabledIndex = Math.max(focusedEnabledIndex, 0);

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusEnabledOption(activeEnabledIndex + 1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusEnabledOption(activeEnabledIndex - 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusEnabledOption(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusEnabledOption(enabledOptionIndexes.length - 1);
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const option = options[optionIndex];
      if (option && !option.disabled) {
        toggleOption(option.id);
      }
    }
  }

  function focusEnabledOption(index: number) {
    if (disabled || enabledOptionIndexes.length === 0) {
      return;
    }
    const nextEnabledIndex =
      (index + enabledOptionIndexes.length) % enabledOptionIndexes.length;
    const nextOptionIndex = enabledOptionIndexes[nextEnabledIndex];
    optionRefs.current[nextOptionIndex]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "grid max-w-170 min-w-0 gap-1 overflow-hidden rounded-xl border border-input bg-card",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = selectedSet.has(option.id);
        const optionDisabled = disabled || option.disabled;
        const descriptionId = option.description
          ? `${option.id}-description`
          : undefined;
        const assistiveText =
          option.assistiveText ??
          (option.requiresFreeText
            ? t("pages.appShell.chatContinueInComposer")
            : undefined);

        return (
          <button
            key={option.id}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-describedby={descriptionId}
            disabled={optionDisabled}
            tabIndex={index === 0 ? 0 : -1}
            onClick={() => {
              if (!optionDisabled) {
                toggleOption(option.id);
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex h-9 min-w-0 items-center gap-3 rounded-lg px-3 text-left text-[13.5px] leading-4.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "bg-chart-3/20 text-foreground hover:bg-chart-3/25"
                : "text-foreground hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground/70",
                selected && "border-primary bg-primary text-primary-foreground",
              )}
              aria-hidden="true"
            >
              {selected ? <CheckIcon className="size-3 stroke-2" /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {assistiveText ? (
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {assistiveText}
              </span>
            ) : null}
            {option.description ? (
              <span id={descriptionId} className="sr-only">
                {option.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

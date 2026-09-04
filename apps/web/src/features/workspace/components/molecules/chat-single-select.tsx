"use client";

import { resolveMessage } from "@lcsp/i18n";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

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
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledOptionIndexes = options.reduce<number[]>(
    (indexes, option, index) => {
      if (!option.disabled) {
        indexes.push(index);
      }
      return indexes;
    },
    [],
  );
  const selectedIndex = options.findIndex((option) => option.id === value);
  const selectedOption =
    selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const focusIndex =
    selectedIndex >= 0 && !selectedOption?.disabled
      ? selectedIndex
      : Math.max(firstEnabledIndex, 0);

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) {
    const focusedEnabledIndex = enabledOptionIndexes.indexOf(optionIndex);
    const selectedEnabledIndex = enabledOptionIndexes.indexOf(focusIndex);
    const activeEnabledIndex =
      focusedEnabledIndex >= 0
        ? focusedEnabledIndex
        : Math.max(selectedEnabledIndex, 0);

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      selectEnabledOption(activeEnabledIndex + 1, true);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectEnabledOption(activeEnabledIndex - 1, true);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      selectEnabledOption(0, true);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      selectEnabledOption(enabledOptionIndexes.length - 1, true);
    }
  }

  function selectEnabledOption(index: number, shouldFocus = false) {
    if (disabled || enabledOptionIndexes.length === 0) {
      return;
    }
    const nextEnabledIndex =
      (index + enabledOptionIndexes.length) % enabledOptionIndexes.length;
    const nextOptionIndex = enabledOptionIndexes[nextEnabledIndex];
    const nextOption = options[nextOptionIndex];

    onValueChange(nextOption.id);
    if (shouldFocus) {
      optionRefs.current[nextOptionIndex]?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "grid max-w-170 min-w-0 gap-1 overflow-hidden rounded-xl border border-input bg-card",
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        const optionDisabled = disabled || option.disabled;
        const descriptionId = option.description
          ? `${option.id}-description`
          : undefined;

        return (
          <button
            key={option.id}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-describedby={descriptionId}
            disabled={optionDisabled}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              if (!optionDisabled) {
                onValueChange(option.id);
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
                "relative size-4 shrink-0 rounded-full border border-muted-foreground/70",
                selected && "border-primary bg-primary/10",
              )}
              aria-hidden="true"
            >
              {selected ? (
                <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.assistiveText ? (
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {option.assistiveText}
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

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";
import {
  ADMIN_OVERVIEW_PERIODS,
  type AdminOverviewPeriod,
} from "@lcsp/contracts/auth";

import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PERIOD_OPTIONS: Array<{
  value: AdminOverviewPeriod;
  labelKey: MessageKey;
  id: string;
}> = [
  {
    value: ADMIN_OVERVIEW_PERIODS.p7d,
    labelKey: "pages.admin.overview.periods.p7d" as MessageKey,
    id: "admin-period-option-7d",
  },
  {
    value: ADMIN_OVERVIEW_PERIODS.p30d,
    labelKey: "pages.admin.overview.periods.p30d" as MessageKey,
    id: "admin-period-option-30d",
  },
  {
    value: ADMIN_OVERVIEW_PERIODS.p90d,
    labelKey: "pages.admin.overview.periods.p90d" as MessageKey,
    id: "admin-period-option-90d",
  },
];

type AdminPeriodSelectorProps = {
  selectedPeriod: AdminOverviewPeriod;
  onSelectPeriod: (period: AdminOverviewPeriod) => void;
  disabled?: boolean;
};

export function AdminPeriodSelector({
  selectedPeriod,
  onSelectPeriod,
  disabled = false,
}: AdminPeriodSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = PERIOD_OPTIONS.findIndex(
    (opt) => opt.value === selectedPeriod,
  );
  const selectedOption =
    selectedIndex >= 0 ? PERIOD_OPTIONS[selectedIndex] : PERIOD_OPTIONS[1];

  const selectedLabel = resolveAppMessage(selectedOption.labelKey);

  function openDropdown(initialIndex?: number) {
    const idx =
      initialIndex !== undefined
        ? initialIndex
        : selectedIndex >= 0
          ? selectedIndex
          : 1;
    setFocusedIndex(idx);
    setIsOpen(true);
  }

  function closeDropdown(focusTrigger = true) {
    setIsOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  }

  // Focus the option element when isOpen changes
  useEffect(() => {
    if (isOpen) {
      optionRefs.current[focusedIndex]?.focus();
    }
  }, [isOpen, focusedIndex]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openDropdown(selectedIndex >= 0 ? selectedIndex : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openDropdown(
        selectedIndex >= 0 ? selectedIndex : PERIOD_OPTIONS.length - 1,
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDropdown();
    }
  }

  function handleListboxKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown(true);
      return;
    }

    if (event.key === "Tab") {
      closeDropdown(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (focusedIndex + 1) % PERIOD_OPTIONS.length;
      setFocusedIndex(nextIndex);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex =
        (focusedIndex - 1 + PERIOD_OPTIONS.length) % PERIOD_OPTIONS.length;
      setFocusedIndex(prevIndex);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setFocusedIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setFocusedIndex(PERIOD_OPTIONS.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const selected = PERIOD_OPTIONS[focusedIndex];
      if (selected) {
        onSelectPeriod(selected.value);
        closeDropdown(true);
      }
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            closeDropdown(false);
          } else {
            openDropdown();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="admin-period-listbox"
        aria-label={resolveAppMessage(
          "pages.admin.overview.periodSelectorAria" as MessageKey,
        )}
        className={cn(
          "flex h-10 w-48 items-center justify-between rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          id="admin-period-listbox"
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListboxKeyDown}
          aria-label={resolveAppMessage(
            "pages.admin.overview.periodLabel" as MessageKey,
          )}
          aria-activedescendant={PERIOD_OPTIONS[focusedIndex]?.id}
          className="absolute right-0 z-50 mt-1 flex w-48 flex-col gap-1 rounded-lg border border-border bg-card p-1.5 shadow-lg focus:outline-hidden"
        >
          {PERIOD_OPTIONS.map((option, index) => {
            const isSelected = option.value === selectedPeriod;
            const isFocused = index === focusedIndex;
            const label = resolveAppMessage(option.labelKey);

            return (
              <button
                key={option.value}
                id={option.id}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                role="option"
                tabIndex={isFocused ? 0 : -1}
                aria-selected={isSelected}
                onClick={() => {
                  onSelectPeriod(option.value);
                  closeDropdown(true);
                }}
                className={cn(
                  "flex h-9 w-full items-center rounded-md px-2.5 text-xs font-medium transition-colors text-left focus:outline-hidden focus:ring-1 focus:ring-ring",
                  isSelected
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  isFocused && !isSelected && "bg-muted/40 text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

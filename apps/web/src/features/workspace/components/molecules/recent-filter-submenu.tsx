"use client";

import {
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  RECENT_FILTER_KEYS,
  type RecentFilterKey,
  type RecentFilterOption,
} from "../../types/recent-filter.types";

type RecentFilterSubmenuProps<Value extends string> = {
  label: string;
  menuKey: RecentFilterKey;
  onValueChange: (value: Value) => void;
  options: RecentFilterOption<Value>[];
  selectedValue: Value;
  valueLabel: string;
};

export function RecentFilterSubmenu<Value extends string>({
  label,
  menuKey,
  onValueChange,
  options,
  selectedValue,
  valueLabel,
}: RecentFilterSubmenuProps<Value>) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className="h-7 w-42 gap-0 rounded-lg px-1.5 py-0 text-[12px] font-normal text-popover-foreground focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground [&>svg]:ml-1 [&>svg]:size-3 [&>svg]:text-muted-foreground"
        data-filter-menu={menuKey}
      >
        <span className="w-18 truncate text-left">{label}</span>
        <span className="ml-auto max-w-18 truncate text-right text-muted-foreground">
          {valueLabel}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        align="start"
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-popover p-0.75 text-popover-foreground shadow-[0_8px_20px_rgba(0,0,0,0.18)] ring-0 dark:shadow-[0_8px_20px_rgba(0,0,0,0.28)]",
          getSubmenuWidthClass(menuKey),
        )}
        side="right"
        sideOffset={8}
      >
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={selectedValue}
            onValueChange={(value) => onValueChange(value as Value)}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                className={cn(
                  "h-7 rounded-lg py-0 pr-7 pl-2 text-[12px] font-normal text-popover-foreground focus:bg-accent focus:text-accent-foreground [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:size-3.5 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:text-popover-foreground",
                  option.value === selectedValue ? "bg-accent" : null,
                  getOptionWidthClass(menuKey),
                )}
                value={option.value}
              >
                {resolveAppMessage(option.labelKey)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function getSubmenuWidthClass(menuKey: RecentFilterKey) {
  if (menuKey === RECENT_FILTER_KEYS.groupBy) return "w-41";
  if (menuKey === RECENT_FILTER_KEYS.sortBy) return "w-[154px]";
  return "w-36";
}

function getOptionWidthClass(menuKey: RecentFilterKey) {
  if (menuKey === RECENT_FILTER_KEYS.groupBy) return "w-[156px]";
  if (menuKey === RECENT_FILTER_KEYS.sortBy) return "w-[146px]";
  return "w-[136px]";
}

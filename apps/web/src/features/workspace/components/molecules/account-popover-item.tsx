"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type AccountPopoverItemProps = {
  children: ReactNode;
  disabled?: boolean;
  icon: LucideIcon;
  onSelect?: () => void;
  trailingChevron?: boolean;
  variant?: "default" | "destructive";
};

export function AccountPopoverItem({
  children,
  disabled = false,
  icon: Icon,
  onSelect,
  trailingChevron = false,
  variant = "default",
}: AccountPopoverItemProps) {
  return (
    <DropdownMenuItem
      className={cn("h-8.5 gap-2.5 rounded-lg px-3 text-sm")}
      data-component="AccountPopoverItem"
      disabled={disabled}
      onClick={onSelect}
      variant={variant}
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailingChevron ? (
        <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
      ) : null}
    </DropdownMenuItem>
  );
}

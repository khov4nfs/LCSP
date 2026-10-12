"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  SIDEBAR_NAV_ITEM_VARIANTS,
  type SidebarNavItemVariant,
} from "../../types/recent-filter.types";

type SidebarNavItemProps = {
  active?: boolean;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  href?: string;
  icon: ReactNode;
  label: string;
  onNavigate?: () => void;
  tooltip?: string;
  variant: SidebarNavItemVariant;
};

export function SidebarNavItem({
  active = false,
  ariaLabel,
  className,
  disabled = false,
  href,
  icon,
  label,
  onNavigate,
  tooltip,
  variant,
}: SidebarNavItemProps) {
  const content = (
    <>
      {icon}
      <span
        className={cn(
          "min-w-0 truncate text-left",
          variant === SIDEBAR_NAV_ITEM_VARIANTS.new
            ? "text-sm font-medium text-sidebar-foreground"
            : "text-sm font-normal text-sidebar-foreground",
        )}
      >
        {label}
      </span>
    </>
  );
  const itemClassName = cn(
    "flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    disabled ? "cursor-default" : "cursor-pointer",
    className,
  );

  if (href && !disabled) {
    return withOptionalTooltip(
      <Link
        aria-current={active ? "page" : undefined}
        className={itemClassName}
        href={href}
        onClick={onNavigate}
      >
        {content}
      </Link>,
      tooltip,
    );
  }

  return withOptionalTooltip(
    <button
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      className={itemClassName}
      type="button"
    >
      {content}
    </button>,
    tooltip,
  );
}

function withOptionalTooltip(trigger: ReactElement, tooltip?: string) {
  if (!tooltip) return trigger;

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

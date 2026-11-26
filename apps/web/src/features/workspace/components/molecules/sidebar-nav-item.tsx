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
  onClick?: () => void;
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
  onClick,
  onNavigate,
  tooltip,
  variant,
}: SidebarNavItemProps) {
  const content = (
    <>
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 left-0 h-5 w-0.75 rounded-xs bg-[#087f75]"
        />
      ) : null}
      <span
        className={cn(
          "shrink-0",
          active
            ? "text-[#11545b] dark:text-emerald-300"
            : "text-sidebar-foreground/75",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-left text-sm",
          active
            ? "font-semibold text-[#11545b] dark:text-emerald-300"
            : variant === SIDEBAR_NAV_ITEM_VARIANTS.new
              ? "font-medium text-sidebar-foreground"
              : "font-medium text-sidebar-foreground/85",
        )}
      >
        {label}
      </span>
    </>
  );
  const itemClassName = cn(
    "relative flex h-8 w-full items-center gap-2 rounded-lg px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active
      ? "bg-[#e2f6f1] text-[#11545b] hover:bg-[#e2f6f1] dark:bg-emerald-950/50 dark:text-emerald-300"
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
      disabled={disabled}
      onClick={onClick}
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

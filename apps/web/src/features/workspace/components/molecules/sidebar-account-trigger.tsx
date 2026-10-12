"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SidebarAccountTriggerProps = ComponentPropsWithoutRef<"button"> & {
  open: boolean;
  userInitial: string;
  userName: string;
};

export const SidebarAccountTrigger = forwardRef<
  HTMLButtonElement,
  SidebarAccountTriggerProps
>(function SidebarAccountTrigger(
  { className, open, userInitial, userName, ...props },
  ref,
) {
  const ChevronIcon = open ? ChevronUpIcon : ChevronDownIcon;

  return (
    <button
      ref={ref}
      {...props}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={resolveAppMessage("pages.appShell.accountMenu")}
      className={cn(
        "flex h-9 w-full max-w-50 items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        open ? "bg-sidebar-accent text-sidebar-accent-foreground" : null,
        className,
      )}
      data-component="SidebarAccountTrigger"
      data-state={open ? "active" : "default"}
      type="button"
    >
      <Avatar size="sm">
        <AvatarFallback>{userInitial}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-[13.5px] leading-5 font-normal text-sidebar-foreground/90">
        {userName}
      </span>
      <ChevronIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-sidebar-foreground/60"
        data-icon="inline-end"
      />
    </button>
  );
});

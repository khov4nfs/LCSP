"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type RecentFilterTriggerProps = ComponentPropsWithoutRef<"button"> & {
  open: boolean;
};

export const RecentFilterTrigger = forwardRef<
  HTMLButtonElement,
  RecentFilterTriggerProps
>(function RecentFilterTrigger(
  { className, open, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      aria-label={resolveAppMessage("pages.appShell.recentFilter.trigger")}
      aria-pressed={open}
      className={cn(
        "relative flex size-7 items-center justify-center rounded-md text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        className,
      )}
      data-recent-filter-trigger="true"
      ref={ref}
      type={type}
    >
      <SlidersHorizontalIcon
        aria-hidden="true"
        className="pointer-events-none size-4"
      />
    </button>
  );
});

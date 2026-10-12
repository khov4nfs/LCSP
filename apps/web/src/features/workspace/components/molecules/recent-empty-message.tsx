"use client";

import { cn } from "@/lib/utils";

type RecentEmptyMessageProps = {
  open: boolean;
  text: string;
};

export function RecentEmptyMessage({ open, text }: RecentEmptyMessageProps) {
  return (
    <p
      className={cn(
        "px-3.5 text-[12.5px] leading-normal font-normal text-sidebar-foreground/50",
        open ? "mt-47" : "mt-7",
      )}
    >
      {text}
    </p>
  );
}

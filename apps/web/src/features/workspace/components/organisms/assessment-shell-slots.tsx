"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function LeftSidebarSlot({
  children,
  collapsed,
}: {
  children: ReactNode;
  collapsed: boolean;
}) {
  if (collapsed) return null;

  return (
    <aside
      data-slot="assessment-left-sidebar"
      data-state="open"
      className={cn(
        "hidden w-55 shrink-0 overflow-hidden border-r border-border/70 bg-sidebar text-sidebar-foreground transition-[width,border-color] duration-200 motion-reduce:transition-none lg:flex",
      )}
    >
      {children}
    </aside>
  );
}

export function CenterContentSlot({
  assessmentId,
  children,
}: {
  assessmentId?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-slot="assessment-center-content"
      className="flex min-w-0 flex-1 flex-col bg-background"
    >
      <div
        data-slot="assessment-center-scroll"
        className="min-h-0 flex-1 overflow-hidden"
      >
        {assessmentId ? (
          <div className="mx-auto flex h-full min-h-0 w-full max-w-180 flex-col">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function AssessmentRightPanelSlot({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  if (!open) return null;

  return (
    <aside
      data-slot="assessment-right-panel"
      data-state="open"
      className="hidden w-105 shrink-0 border-l border-border/70 bg-muted/20 xl:flex"
    >
      {children}
    </aside>
  );
}

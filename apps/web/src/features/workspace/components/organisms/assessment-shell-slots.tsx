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
  return (
    <aside
      data-slot="assessment-left-sidebar"
      data-state={collapsed ? "collapsed" : "open"}
      className={cn(
        "hidden shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground transition-[width,border-color] duration-200 motion-reduce:transition-none lg:flex",
        collapsed
          ? "w-14 border-r border-border/70"
          : "w-55 border-r border-border/70",
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
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {assessmentId ? (
          <div className="mx-auto min-h-full w-full max-w-180">{children}</div>
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

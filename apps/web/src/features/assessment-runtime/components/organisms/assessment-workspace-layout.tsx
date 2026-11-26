"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const ASSESSMENT_WORKSPACE_TABS = {
  overview: "overview",
  findings: "findings",
  requests: "requests",
  source: "source",
} as const;

export type AssessmentWorkspaceTab =
  (typeof ASSESSMENT_WORKSPACE_TABS)[keyof typeof ASSESSMENT_WORKSPACE_TABS];

/**
 * Business purpose: Render the canonical Assessment Decision Workspace shell and `LCSP shadcn / Assessment tabs` (`1709:7794`) matching Figma Frames 20–22, 40–41, 82–84, and 106.
 * Business rules:
 * - Provides keyboard-accessible tabs (`Overview`, `Findings`, `Information requests`, `Source & evidence`) sharing the same assessment context.
 * - Marks `data-surface="assessment-workspace"` so `CenterContentSlot` expands to full available width.
 * Execution flow:
 * 1. Render workspace header with assessment title, status badge, and optional action button.
 * 2. Render `LCSP shadcn / Assessment tabs` bar with active indicator and open-request count.
 * 3. Render active tab content and sticky bottom interaction bar slot.
 * Failure cases:
 * - Zero open requests renders the `Information requests` tab without a non-zero count badge.
 * Side effects:
 * - Tab selection invokes `onTabChange(tab)`.
 */
export function AssessmentWorkspaceLayout({
  title,
  statusLabel,
  activeTab,
  onTabChange,
  openRequestsCount,
  onAuditSelectedRules,
  children,
  interactionBar,
}: {
  title: string;
  statusLabel: string;
  activeTab: AssessmentWorkspaceTab;
  onTabChange: (tab: AssessmentWorkspaceTab) => void;
  openRequestsCount: number;
  onAuditSelectedRules?: () => void;
  children: ReactNode;
  interactionBar?: ReactNode;
}) {
  const tabs: Array<{ id: AssessmentWorkspaceTab; label: string }> = [
    {
      id: ASSESSMENT_WORKSPACE_TABS.overview,
      label: resolveAppMessage("pages.assessmentWorkspace.tabs.overview"),
    },
    {
      id: ASSESSMENT_WORKSPACE_TABS.findings,
      label: resolveAppMessage("pages.assessmentWorkspace.tabs.findings"),
    },
    {
      id: ASSESSMENT_WORKSPACE_TABS.requests,
      label:
        openRequestsCount > 0
          ? `${resolveAppMessage("pages.assessmentWorkspace.tabs.requests")} (${openRequestsCount})`
          : resolveAppMessage("pages.assessmentWorkspace.tabs.requests"),
    },
    {
      id: ASSESSMENT_WORKSPACE_TABS.source,
      label: resolveAppMessage("pages.assessmentWorkspace.tabs.sourceEvidence"),
    },
  ];

  return (
    <div
      data-surface="assessment-workspace"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="flex w-full flex-col gap-5">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="truncate font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {title}
                </h1>
                <Badge
                  variant="outline"
                  className="border-status-info-border bg-status-info-bg text-status-info"
                >
                  {statusLabel}
                </Badge>
              </div>
            </div>

            {onAuditSelectedRules ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAuditSelectedRules}
              >
                {resolveAppMessage(
                  "pages.assessmentWorkspace.overview.auditSelectedRules",
                )}
              </Button>
            ) : null}
          </header>

          <div
            role="tablist"
            aria-label={title}
            className="inline-flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted p-1"
          >
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    selected
                      ? "border border-border bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div role="tabpanel">{children}</div>
        </div>
      </div>

      {interactionBar ? (
        <div className="shrink-0 border-t border-border bg-background">
          {interactionBar}
        </div>
      ) : null}
    </div>
  );
}

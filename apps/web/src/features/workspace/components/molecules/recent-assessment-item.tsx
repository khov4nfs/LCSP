"use client";

import Link from "next/link";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getAssessmentActiveHref } from "@/lib/api/workspace-client";
import { cn } from "@/lib/utils";

import type { AssessmentSummary } from "../../types/workspace.types";

type RecentAssessmentItemProps = {
  active?: boolean;
  assessment: AssessmentSummary;
  onNavigate?: () => void;
  suppressHover?: boolean;
};

export function RecentAssessmentItem({
  active = false,
  assessment,
  onNavigate,
  suppressHover = false,
}: RecentAssessmentItemProps) {
  const href = getAssessmentActiveHref(assessment);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-8.5 w-full items-center rounded-lg px-2.25 text-[13.5px] leading-none text-sidebar-foreground/85 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : null,
              !suppressHover
                ? "hover:border hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                : null,
            )}
            data-hover-suppressed={suppressHover ? "true" : "false"}
            href={href}
            onClick={onNavigate}
          >
            <span className="mr-2.25 size-1.75 shrink-0 rounded-full bg-brand" />
            <span className="min-w-0 flex-1 truncate font-normal">
              {assessment.name}
            </span>
          </Link>
        }
      />
      <TooltipContent side="right">{assessment.name}</TooltipContent>
    </Tooltip>
  );
}

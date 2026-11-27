import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AdminRecentAssessmentCardProps {
  assessmentName?: string;
  timestamp?: string;
  status?: string;
  onViewAssessment?: () => void;
  className?: string;
}

export function AdminRecentAssessmentCard({
  assessmentName = "Authentication gateway",
  timestamp = "Nov 24, 11:20",
  status = "Running",
  onViewAssessment,
  className,
}: AdminRecentAssessmentCardProps) {
  return (
    <div
      data-figma-node="1697:4609"
      data-figma-name="Recent assessment activity"
      className={cn(
        "flex flex-col justify-between rounded-[12px] border border-border bg-card p-4 sm:flex-row sm:items-center shadow-xs",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-semibold text-foreground">
          Recent assessment activity
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">
            {assessmentName} · {timestamp}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[12px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
            {status}
          </span>
        </div>
      </div>

      <div className="mt-3 sm:mt-0">
        <Button
          type="button"
          variant="outline"
          onClick={onViewAssessment}
          className="h-[36px] px-4 rounded-[7px] border-border text-[13px] font-semibold text-foreground hover:bg-muted"
        >
          View assessment
        </Button>
      </div>
    </div>
  );
}

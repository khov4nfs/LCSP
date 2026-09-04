import { resolveMessage } from "@lcsp/i18n";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import {
  TOOL_ACTIVITY_STATUSES,
  type ToolActivityStatus,
} from "../../types/assessment-chat.types";

type ToolActivityRowProps = {
  label: string;
  detail?: string;
  status: ToolActivityStatus;
  icon?: ReactNode;
  className?: string;
};

type ToolActivityListProps = {
  children: ReactNode;
  className?: string;
};

const statusConfig = {
  [TOOL_ACTIVITY_STATUSES.pending]: {
    icon: CircleDashedIcon,
    labelKey: "pages.appShell.chatActivityStatuses.pending",
    textClassName: "text-muted-foreground",
    iconClassName: "text-muted-foreground",
  },
  [TOOL_ACTIVITY_STATUSES.running]: {
    icon: LoaderCircleIcon,
    labelKey: "pages.appShell.chatActivityStatuses.running",
    textClassName: "text-primary",
    iconClassName: "text-primary",
  },
  [TOOL_ACTIVITY_STATUSES.completed]: {
    icon: CheckCircle2Icon,
    labelKey: "pages.appShell.chatActivityStatuses.completed",
    textClassName: "text-brand",
    iconClassName: "text-muted-foreground",
  },
  [TOOL_ACTIVITY_STATUSES.failed]: {
    icon: CircleXIcon,
    labelKey: "pages.appShell.chatActivityStatuses.failed",
    textClassName: "text-destructive",
    iconClassName: "text-destructive",
  },
} as const;

export function ToolActivityRow({
  label,
  detail,
  status,
  icon,
  className,
}: ToolActivityRowProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div
      data-slot="tool-activity-row"
      className={cn(
        "grid min-h-6 max-w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden text-[13px] leading-4.5",
        className,
      )}
    >
      <span className="flex size-4 items-center justify-center">
        {icon ?? (
          <Icon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              config.iconClassName,
              status === TOOL_ACTIVITY_STATUSES.running &&
                "animate-spin motion-reduce:animate-none",
            )}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col">
          <span
            className={cn(
              "min-w-0 truncate text-muted-foreground",
              status === TOOL_ACTIVITY_STATUSES.running &&
                "font-medium text-foreground",
            )}
          >
            {label}
          </span>
        </div>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {detail}
          </p>
        ) : null}
      </div>
      <span className={cn("text-right text-[11px]", config.textClassName)}>
        {t(config.labelKey)}
      </span>
    </div>
  );
}

export function ToolActivityList({
  children,
  className,
}: ToolActivityListProps) {
  return (
    <div
      data-slot="tool-activity-list"
      className={cn("grid max-w-full min-w-0 gap-1", className)}
    >
      {children}
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

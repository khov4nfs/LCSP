import { resolveMessage } from "@lcsp/i18n";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "lucide-react";

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
  className?: string;
};

const statusConfig = {
  [TOOL_ACTIVITY_STATUSES.pending]: {
    icon: CircleDashedIcon,
    labelKey: "pages.appShell.chatActivityStatuses.pending",
  },
  [TOOL_ACTIVITY_STATUSES.running]: {
    icon: LoaderCircleIcon,
    labelKey: "pages.appShell.chatActivityStatuses.running",
  },
  [TOOL_ACTIVITY_STATUSES.completed]: {
    icon: CheckCircle2Icon,
    labelKey: "pages.appShell.chatActivityStatuses.completed",
  },
  [TOOL_ACTIVITY_STATUSES.failed]: {
    icon: CircleXIcon,
    labelKey: "pages.appShell.chatActivityStatuses.failed",
  },
} as const;

export function ToolActivityRow({
  label,
  detail,
  status,
  className,
}: ToolActivityRowProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div
      data-slot="tool-activity-row"
      className={cn(
        "flex max-w-full min-w-0 items-start gap-2.5 overflow-hidden rounded-lg px-2 py-2 text-sm",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 text-muted-foreground",
          status === TOOL_ACTIVITY_STATUSES.running &&
            "animate-spin motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 wrap-break-word font-medium text-foreground">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {t(config.labelKey)}
          </span>
        </div>
        {detail ? (
          <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

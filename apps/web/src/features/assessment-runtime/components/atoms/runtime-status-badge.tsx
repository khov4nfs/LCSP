import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
import {
  NORMALIZED_WORKFLOW_STEP_STATUSES,
  type NormalizedWorkflowStepStatus,
} from "../../../workspace/types/assessment-runtime-adapter.types";

const statusLabels: Record<NormalizedWorkflowStepStatus, string> = {
  [NORMALIZED_WORKFLOW_STEP_STATUSES.queued]: resolveAppMessage("pages.appShell.runtimePanelStatuses.queued" as MessageKey),
  [NORMALIZED_WORKFLOW_STEP_STATUSES.running]: resolveAppMessage("pages.appShell.runtimePanelStatuses.running"),
  [NORMALIZED_WORKFLOW_STEP_STATUSES.waiting]: resolveAppMessage("pages.appShell.runtimePanelStatuses.waiting"),
  [NORMALIZED_WORKFLOW_STEP_STATUSES.completed]: resolveAppMessage("pages.appShell.runtimePanelStatuses.completed"),
  [NORMALIZED_WORKFLOW_STEP_STATUSES.failed]: resolveAppMessage("pages.appShell.runtimePanelStatuses.failed"),
  [NORMALIZED_WORKFLOW_STEP_STATUSES.unknown]: resolveAppMessage("pages.appShell.runtimePanelStatuses.unknown" as MessageKey),
};

export function RuntimeStatusBadge({ status }: { status: NormalizedWorkflowStepStatus }) {
  const isFailed = status === NORMALIZED_WORKFLOW_STEP_STATUSES.failed;
  const isCompleted = status === NORMALIZED_WORKFLOW_STEP_STATUSES.completed;
  return (
    <span
      className={
        isFailed
          ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[0.6875rem] font-medium text-destructive"
          : isCompleted
            ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.6875rem] font-medium text-emerald-700 dark:text-emerald-300"
            : "rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground"
      }
    >
      {statusLabels[status]}
    </span>
  );
}

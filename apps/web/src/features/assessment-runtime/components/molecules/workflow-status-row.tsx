import {
  NORMALIZED_WORKFLOW_STEP_STATUSES,
  type NormalizedWorkflowStep,
} from "../../../workspace/types/assessment-runtime-adapter.types";
import { RuntimeStatusBadge } from "../atoms/runtime-status-badge";

function statusDotClass(status: NormalizedWorkflowStep["status"]) {
  switch (status) {
    case NORMALIZED_WORKFLOW_STEP_STATUSES.completed:
      return "bg-emerald-500";
    case NORMALIZED_WORKFLOW_STEP_STATUSES.running:
      return "bg-blue-500";
    case NORMALIZED_WORKFLOW_STEP_STATUSES.failed:
      return "bg-destructive";
    case NORMALIZED_WORKFLOW_STEP_STATUSES.queued:
    case NORMALIZED_WORKFLOW_STEP_STATUSES.waiting:
    case NORMALIZED_WORKFLOW_STEP_STATUSES.unknown:
    default:
      return "bg-muted-foreground/50";
  }
}

export function WorkflowStatusRow({ step }: { step: NormalizedWorkflowStep }) {
  return (
    <li className="flex items-start gap-2.5 border-b border-border/50 py-2.5 last:border-b-0">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${statusDotClass(step.status)}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{step.label}</span>
          <RuntimeStatusBadge status={step.status} />
        </span>
        {step.detail ? <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{step.detail}</span> : null}
      </span>
    </li>
  );
}

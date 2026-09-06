import { resolveAppMessage } from "@/lib/i18n";
import type { NormalizedWorkflowStep } from "../../../workspace/types/assessment-runtime-adapter.types";
import { WorkflowStatusRow } from "../molecules/workflow-status-row";

export function WorkflowStatusList({ steps }: { steps: NormalizedWorkflowStep[] }) {
  if (steps.length === 0) return null;
  return (
    <section aria-label={resolveAppMessage("pages.appShell.runtimePanelTitle")}>
      <p className="mb-2 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">{resolveAppMessage("pages.appShell.runtimePanelTitle")}</p>
      <ol className="rounded-xl border border-border/70 bg-card px-3.5">{steps.map((step) => <WorkflowStatusRow key={step.id} step={step} />)}</ol>
    </section>
  );
}

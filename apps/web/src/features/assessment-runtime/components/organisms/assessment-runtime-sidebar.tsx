"use client";

import { resolveAppMessage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { useSearchParams } from "next/navigation";
import { useAssessmentRuntimeViewModel } from "../../../workspace/hooks/use-assessment-runtime-view-model";
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../../../workspace/types/workspace-runtime.types";
import { connectionLabel } from "../../../workspace/utils/assessment-runtime-formatter";
import { ArtifactEvidenceRail } from "./artifact-evidence-rail";
import { RepositoryContextCard } from "../molecules/repository-context-card";
import { WorkflowStatusList } from "./workflow-status-list";
import { createAssessmentRuntimeSidebarPreview } from "../../dev/assessment-runtime-sidebar-preview";

export function AssessmentRuntimeSidebar({ assessmentId, assessmentName }: { assessmentId: string; assessmentName?: string }) {
  const realRuntime = useAssessmentRuntimeViewModel(assessmentId);
  const searchParams = useSearchParams();
  const isDevPreview =
    process.env.NODE_ENV === "development" &&
    searchParams.get("preview") === "runtime-sidebar";
  const runtime = isDevPreview
    ? createAssessmentRuntimeSidebarPreview(assessmentId)
    : realRuntime;
  return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background/95"><div className="shrink-0 border-b border-border/70 px-4 py-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-sm font-semibold text-foreground">{assessmentName ?? resolveAppMessage("pages.appShell.assessmentTitle")}</h2><p className="mt-1 text-xs text-muted-foreground">{resolveAppMessage("pages.appShell.assessmentNavigation")}</p></div><Badge variant={runtime.connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.connected ? "default" : "secondary"}>{connectionLabel(runtime.connectionState)}</Badge></div></div><div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"><RepositoryContextCard repository={runtime.repository} /><WorkflowStatusList steps={runtime.workflow.steps} /><ArtifactEvidenceRail artifacts={runtime.artifacts} /></div></div>;
}

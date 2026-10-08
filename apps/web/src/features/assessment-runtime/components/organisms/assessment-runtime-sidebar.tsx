"use client";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { resolveAppMessage } from "@/lib/i18n";
import {
  useAssessmentDetailQuery,
  useRepositorySetupQuery,
} from "@/lib/api/assessment-domain-queries";
import { useWorkspaceRuntime } from "../../../workspace/components/organisms/workspace-runtime-provider";
import {
  CanonicalAssessmentStatus,
  CanonicalAssessmentActivity,
} from "./canonical-assessment-status";
import { connectionLabel } from "../../../workspace/utils/assessment-runtime-formatter";

export function AssessmentRuntimeSidebar({
  assessmentId,
  assessmentName,
}: {
  assessmentId: string;
  assessmentName?: string;
}) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const setup = useRepositorySetupQuery(assessmentId);
  const workspace = useWorkspaceRuntime();
  const timeline = workspace.getAssessmentRuntime(assessmentId);
  const assessment = detail.data;
  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-background p-4 gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-sm font-semibold">
          {assessment?.name ??
            assessmentName ??
            resolveAppMessage("pages.appShell.assessmentTitle")}
        </h2>
        <Badge variant="outline">
          {connectionLabel(workspace.connectionState)}
        </Badge>
      </div>
      <CanonicalAssessmentStatus
        canonicalAssessment={
          assessment
            ? {
                assessmentId,
                lifecycle: assessment.lifecycle,
                runtime: assessment.runtime,
              }
            : null
        }
        connectionState={workspace.connectionState}
      />
      {setup.data?.connection ? (
        <section className="flex flex-col gap-2">
          <p className="break-words text-sm">
            {setup.data.connection.repositoryFullName}
          </p>
          {setup.data.snapshot ? (
            <code className="break-all text-xs text-muted-foreground">
              {setup.data.snapshot.commitSha}
            </code>
          ) : null}
        </section>
      ) : null}
      <Separator />
      <CanonicalAssessmentActivity events={timeline.canonicalEvents ?? []} />
    </aside>
  );
}

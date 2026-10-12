"use client";

import { resolveMessage } from "@lcsp/i18n";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAssessmentActiveHref } from "@/lib/api/workspace-client";
import { useAssessmentsQuery } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";
import { useWorkspaceRuntime } from "./workspace-runtime-provider";

import { AssessmentList } from "./assessment-list";

export function AssessmentsDirectory() {
  const assessmentsQuery = useAssessmentsQuery();
  const workspaceRuntime = useWorkspaceRuntime();
  const assessments =
    assessmentsQuery.data?.kind === "loaded"
      ? assessmentsQuery.data.assessments
      : [];
  const hasError = assessmentsQuery.data?.kind === "error";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      {hasError ? (
        <Alert variant="destructive">
          <AlertTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.errors.assessmentsUnavailableTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.errors.assessmentsUnavailableDetail",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
        <AssessmentList
        assessments={assessments}
        isLoading={assessmentsQuery.isLoading}
        title={resolveMessage(appLocale, "pages.workspace.assessmentsTitle")}
        description={resolveMessage(
          appLocale,
          "pages.workspace.assessmentsDescription",
        )}
        emptyTitle={resolveMessage(appLocale, "pages.workspace.emptyTitle")}
        emptyDescription={resolveMessage(
          appLocale,
          "pages.workspace.emptyDescription",
        )}
        loadingLabel={resolveMessage(
          appLocale,
          "pages.workspace.loadingAssessments",
        )}
        statusLabel={resolveMessage(appLocale, "pages.workspace.statusLabel")}
        createdAtLabel={resolveMessage(
          appLocale,
          "pages.workspace.createdAtLabel",
        )}
        getAssessmentHref={(assessment) => getAssessmentActiveHref(assessment)}
        openAssessmentLabel={resolveMessage(
          appLocale,
          "pages.assessment.openOverview",
        )}
        canonicalAssessments={workspaceRuntime.canonicalAssessmentByAssessmentId}
        connectionState={workspaceRuntime.connectionState}
      />
    </main>
  );
}

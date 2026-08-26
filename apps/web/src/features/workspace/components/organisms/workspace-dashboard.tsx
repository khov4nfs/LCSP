"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { canCreateAssessment } from "@/lib/api/workspace-client";
import {
  useAssessmentsQuery,
  useWorkspaceQuery,
} from "@/lib/api/workspace-queries";

import { appLocale } from "@/lib/locale";
import type { WorkspaceErrorOutcome } from "../../types/workspace.types";
import { WorkspaceHeader } from "../molecules/workspace-header";
import { WorkspaceOverview } from "./workspace-overview";

export function WorkspaceDashboard() {
  const router = useRouter();
  const workspaceQuery = useWorkspaceQuery();
  const assessmentsQuery = useAssessmentsQuery();

  useEffect(() => {
    if (workspaceQuery.data?.kind === "redirect") {
      router.replace(workspaceQuery.data.location);
    }
  }, [router, workspaceQuery.data]);

  const workspace =
    workspaceQuery.data?.kind === "loaded"
      ? workspaceQuery.data.workspace
      : null;
  const assessments =
    assessmentsQuery.data?.kind === "loaded"
      ? assessmentsQuery.data.assessments
      : [];
  const workspaceError = isWorkspaceErrorOutcome(workspaceQuery.data)
    ? workspaceQuery.data
    : null;
  const assessmentsError = isWorkspaceErrorOutcome(assessmentsQuery.data)
    ? assessmentsQuery.data
    : null;
  const error = workspaceError ?? assessmentsError;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 text-foreground lg:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{resolveMessage(appLocale, error.titleKey)}</AlertTitle>
            <AlertDescription>
              {resolveMessage(appLocale, error.detailKey)}
            </AlertDescription>
          </Alert>
        ) : null}

        {workspace ? (
          <WorkspaceHeader
            title={resolveMessage(appLocale, "pages.workspace.pageTitle")}
            description={resolveMessage(
              appLocale,
              "pages.workspace.pageDescription",
            )}
            organizationLabel={resolveMessage(
              appLocale,
              "pages.workspace.organizationLabel" as MessageKey,
            )}
            organizationName={workspace.user.display_name}
            membershipRoleLabel={resolveMessage(
              appLocale,
              "pages.workspace.membershipRoleLabel" as MessageKey,
            )}
            membershipRole={workspace.user.role}
            createAssessmentLabel={resolveMessage(
              appLocale,
              "pages.workspace.createAssessment",
            )}
            showCreateAssessment={canCreateAssessment(workspace.user.role)}
            onCreateAssessment={() => router.push("/assessments/new")}
          />
        ) : null}

        <WorkspaceOverview assessments={assessments} />
      </div>
    </main>
  );
}

function isWorkspaceErrorOutcome(
  outcome: unknown,
): outcome is WorkspaceErrorOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "error"
  );
}

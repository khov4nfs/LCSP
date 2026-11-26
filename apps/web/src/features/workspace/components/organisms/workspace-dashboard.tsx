"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { canCreateAssessment } from "@/lib/api/workspace-client";
import { useWorkspaceQuery } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";
import type { WorkspaceErrorOutcome } from "../../types/workspace.types";
import { TrackingDashboard } from "@/features/tracking/components/organisms/tracking-dashboard";

/**
 * Business purpose:
 * Host the customer workspace overview page with Frame 15 header actions
 * ("All assessments", "New assessment") and the Bento Intelligence Dashboard.
 *
 * Business rules:
 * - Redirect when the workspace query returns a redirect outcome (e.g. unauthenticated or workspace selection).
 * - Gate the "New assessment" CTA by `canCreateAssessment(workspace.user.role)`.
 *
 * Execution flow:
 * 1. Load workspace session context and handle redirect outcomes.
 * 2. Render page title, subtitle, and contextual navigation actions.
 * 3. Mount `TrackingDashboard` for live compliance coverage, action queue, and recent assessments.
 *
 * Failure cases:
 * - Surface workspace error outcomes in a destructive Alert without hiding tracking fallback.
 *
 * Side effects:
 * - Navigates on redirect outcome or CTA clicks.
 */
export function WorkspaceDashboard() {
  const router = useRouter();
  const workspaceQuery = useWorkspaceQuery();

  useEffect(() => {
    if (workspaceQuery.data?.kind === "redirect") {
      router.replace(workspaceQuery.data.location);
    }
  }, [router, workspaceQuery.data]);

  const workspace =
    workspaceQuery.data?.kind === "loaded"
      ? workspaceQuery.data.workspace
      : null;
  const error = isWorkspaceErrorOutcome(workspaceQuery.data)
    ? workspaceQuery.data
    : null;

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

        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.tracking.overviewTitle" as MessageKey,
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.tracking.bentoSubtitle" as MessageKey,
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button
              render={<Link href="/assessments" />}
              variant="outline"
              nativeButton={false}
            >
              {resolveMessage(
                appLocale,
                "pages.workspace.tracking.allAssessments" as MessageKey,
              )}
            </Button>
            {workspace && canCreateAssessment(workspace.user.role) ? (
              <Button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => router.push("/assessments/new")}
              >
                {resolveMessage(
                  appLocale,
                  "pages.workspace.tracking.newAssessment" as MessageKey,
                )}
              </Button>
            ) : null}
          </div>
        </header>

        <TrackingDashboard />
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

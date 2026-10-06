"use client";

import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { resolveMessage } from "@lcsp/i18n";
import Link from "next/link";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAssessmentActiveHref } from "@/lib/api/workspace-client";
import { appLocale } from "@/lib/locale";
import type { WorkspaceOverviewProps } from "../../types/workspace-overview.types";
import { OverviewMetricCard } from "../molecules/overview-metric-card";
import { canonicalLifecycleLabel } from "../../utils/assessment-runtime-formatter";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
} from "../../types/workspace-runtime.types";

export function WorkspaceOverview({
  assessments,
  canonicalAssessments,
  connectionState,
}: WorkspaceOverviewProps) {
  const attention = assessments.filter((assessment) => {
    const canonicalAssessment = canonicalAssessments[assessment.id];
    return (
      canonicalAssessment?.lifecycle != null &&
      canonicalAssessment.runtime != null &&
      canonicalAssessment.lifecycle.state !==
        ASSESSMENT_LIFECYCLE_STATES.COMPLETE
    );
  }).length;
  const ready = assessments.filter(
    (assessment) =>
      canonicalAssessments[assessment.id]?.lifecycle?.state ===
      ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  ).length;
  const recent = [...assessments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3);

  return (
    <>
      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label={resolveMessage(appLocale, "pages.workspace.insightsTitle")}
      >
        <OverviewMetricCard
          labelKey="pages.workspace.totalAssessments"
          value={assessments.length}
        />
        <OverviewMetricCard
          labelKey="pages.workspace.needsAttention"
          value={attention}
        />
        <OverviewMetricCard
          labelKey="pages.workspace.readyForReview"
          value={ready}
        />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.recentAssessmentsTitle",
            )}
          </CardTitle>
          <CardDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.recentAssessmentsDescription",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            render={<Link href="/assessments" />}
            variant="outline"
            nativeButton={false}
          >
            {resolveMessage(appLocale, "pages.workspace.openAssessments")}
          </Button>
          {recent.length ? (
            recent.map((assessment) => (
              <Link
                key={assessment.id}
                href={getAssessmentActiveHref(assessment)}
                className="flex items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{assessment.name}</span>
                <Badge variant="outline">
                  {canonicalLifecycleDisplay(
                    canonicalAssessments[assessment.id] ?? null,
                    connectionState,
                  )}
                </Badge>
              </Link>
            ))
          ) : (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.recentAssessmentsTitle",
                  )}
                </EmptyTitle>
                <EmptyDescription>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.emptyDescription",
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function canonicalLifecycleDisplay(
  canonicalAssessment:
    WorkspaceOverviewProps["canonicalAssessments"][string] | null,
  connectionState: WorkspaceRuntimeConnectionState,
) {
  if (canonicalAssessment?.lifecycle && canonicalAssessment.runtime) {
    return canonicalLifecycleLabel(canonicalAssessment.lifecycle.state);
  }
  return resolveMessage(
    appLocale,
    connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.connecting
      ? "pages.appShell.runtimePanelCanonicalLoading"
      : "pages.appShell.runtimePanelCanonicalUnavailable",
  );
}

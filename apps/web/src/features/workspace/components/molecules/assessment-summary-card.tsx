import { resolveMessage } from "@lcsp/i18n";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { appLocale } from "@/lib/locale";
import type {
  AssessmentFactProps,
  AssessmentSummaryCardProps,
} from "../../types/assessment-summary-card.types";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
} from "../../types/workspace-runtime.types";
import {
  canonicalExecutionLabel,
  canonicalLifecycleLabel,
} from "../../utils/assessment-runtime-formatter";

export function AssessmentSummaryCard({
  assessment,
  statusLabel,
  createdAtLabel,
  href,
  openAssessmentLabel,
  canonicalAssessment,
  connectionState,
}: AssessmentSummaryCardProps) {
  const canonicalState = canonicalAssessment?.lifecycle &&
    canonicalAssessment.runtime
    ? canonicalLifecycleLabel(canonicalAssessment.lifecycle.state)
    : canonicalUnavailableLabel(connectionState);
  const executionState = canonicalAssessment?.runtime
    ? canonicalExecutionLabel(canonicalAssessment.runtime.executionState)
    : canonicalUnavailableLabel(connectionState);

  return (
    <Card className="group relative transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      {href ? (
        <Link
          aria-label={`${assessment.name} — ${openAssessmentLabel ?? assessment.name}`}
          className="absolute inset-0 z-0 rounded-xl"
          href={href}
        />
      ) : null}
      <CardHeader>
        <CardTitle>{assessment.name}</CardTitle>
        <CardDescription>
          {createdAtLabel}: {formatAssessmentDate(assessment.created_at)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3 text-sm">
          <AssessmentFact label={statusLabel} value={canonicalState} />
          <AssessmentFact
            label={resolveMessage(
              appLocale,
              "pages.appShell.runtimePanelCanonicalExecution",
            )}
            value={executionState}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function canonicalUnavailableLabel(connectionState: WorkspaceRuntimeConnectionState) {
  return resolveMessage(
    appLocale,
    connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.connecting
      ? "pages.appShell.runtimePanelCanonicalLoading"
      : "pages.appShell.runtimePanelCanonicalUnavailable",
  );
}

function AssessmentFact({ label, value }: AssessmentFactProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <Badge variant="outline">{value}</Badge>
      </dd>
    </div>
  );
}

function formatAssessmentDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
  }).format(new Date(value));
}

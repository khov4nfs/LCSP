"use client";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { cn } from "@/lib/utils";
import {
  useAssessmentDetailQuery,
  useRepositorySetupQuery,
} from "@/lib/api/assessment-domain-queries";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import {
  canonicalExecutionLabel,
  canonicalLifecycleLabel,
  connectionLabel,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import {
  CUSTOMER_ASSESSMENT_STATES,
  type CustomerAssessmentState,
} from "../../config/customer-assessment-states";
import { assessmentProgress } from "../../utils/assessment-progress";
import { copy } from "../../utils/conversation-copy";
import { customerAssessmentState } from "../../utils/customer-assessment-state";
import { formatTokens } from "../../utils/format-tokens";

const DOT: Record<CustomerAssessmentState, string> = {
  [CUSTOMER_ASSESSMENT_STATES.UNAVAILABLE]: "bg-muted-foreground/50",
  [CUSTOMER_ASSESSMENT_STATES.PREPARING]: "bg-muted-foreground",
  [CUSTOMER_ASSESSMENT_STATES.WORKING]: "bg-primary motion-safe:animate-pulse",
  [CUSTOMER_ASSESSMENT_STATES.WAITING]: "bg-amber-500",
  [CUSTOMER_ASSESSMENT_STATES.PAUSED]: "bg-muted-foreground",
  [CUSTOMER_ASSESSMENT_STATES.FINALIZING]: "bg-primary motion-safe:animate-pulse",
  [CUSTOMER_ASSESSMENT_STATES.COMPLETE]: "bg-emerald-500",
  [CUSTOMER_ASSESSMENT_STATES.BLOCKED]: "bg-amber-500",
  [CUSTOMER_ASSESSMENT_STATES.FAILED]: "bg-destructive",
  [CUSTOMER_ASSESSMENT_STATES.CANCELLED]: "bg-muted-foreground/50",
};

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * The right sidebar: compact CONTEXT only (state, repository, rule set, progress, usage, report).
 * It never renders activity, an event feed or per-event usage: the conversation owns the
 * chronology, and this panel owns the facts that frame it.
 */
export function AssessmentContextPanel({
  assessmentId,
  assessmentName,
}: {
  assessmentId: string;
  assessmentName?: string;
}) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const setup = useRepositorySetupQuery(assessmentId);
  const workspace = useWorkspaceRuntime();
  const assessment = detail.data ?? null;
  const state = customerAssessmentState(
    assessment?.lifecycle ?? null,
    assessment?.runtime ?? null,
  );
  const progress = assessmentProgress(assessment);
  const ruleSet = assessment?.case?.ruleSet ?? null;
  const usage = assessment?.usage;
  const reportReady = Boolean(
    assessment?.case?.artifacts.some(
      (artifact) => artifact.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    ),
  );
  const commit = (
    setup.data?.snapshot?.commitSha ?? assessment?.case?.repositoryCommit
  )?.slice(0, 7);
  return (
    <aside
      data-slot="assessment-context"
      aria-label={copy("context.title")}
      className="flex h-full min-h-0 w-full flex-col gap-5 overflow-y-auto bg-background p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 className="truncate text-sm font-semibold">
          {assessment?.name ?? assessmentName ?? copy("context.title")}
        </h2>
        <p
          data-customer-state={state}
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", DOT[state])}
          />
          {copy(`state.${state}`)}
        </p>
      </header>
      <dl className="flex flex-col gap-4">
        {setup.data?.connection ? (
          <Fact label={copy("context.repository")}>
            <span className="break-all">
              {setup.data.connection.repositoryFullName}
            </span>
            {commit ? (
              <code className="mt-0.5 block text-xs text-muted-foreground">
                {commit}
              </code>
            ) : null}
          </Fact>
        ) : null}
        <Fact label={copy("context.ruleSet")}>
          {ruleSet ? (
            <>
              <span className="font-medium">{ruleSet.version}</span>
              <span className="block text-xs text-muted-foreground">
                {copy("context.ruleSetSummary", {
                  requirements: ruleSet.legalRequirementCount,
                  rules: ruleSet.assessmentRuleCount,
                })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {copy("context.ruleSetWaiting")}
            </span>
          )}
        </Fact>
        {progress ? (
          <Fact label={copy("context.progress")}>
            {copy("context.progressValue", progress)}
            <progress
              value={progress.done}
              max={progress.total}
              aria-label={copy("context.progress")}
              className="mt-1 block h-1 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
            />
          </Fact>
        ) : null}
        {usage?.invocationCount ? (
          <Fact label={copy("context.usage")}>
            <span data-usage-total={usage.totalTokens ?? 0}>
              {copy("context.usageValue", {
                tokens: formatTokens(usage.totalTokens ?? 0),
              })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {copy("context.usageInvocations", {
                count: usage.invocationCount,
              })}
            </span>
            {usage.partial ? (
              <span className="block text-xs text-muted-foreground">
                {copy("context.usagePartial")}
              </span>
            ) : null}
          </Fact>
        ) : null}
        <Fact label={copy("context.report")}>
          {copy(reportReady ? "context.reportReady" : "context.reportNotReady")}
        </Fact>
        <div className="pt-1">
          <Link
            href={`/assessments/${encodeURIComponent(assessmentId)}/provenance`}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "w-full justify-start text-xs",
            })}
          >
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            {copy("provenance.viewProvenance")}
          </Link>
        </div>
      </dl>
      <details className="text-sm" data-slot="run-details">
        <summary className="cursor-pointer list-none rounded-md text-muted-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          {copy("context.runDetails")}
        </summary>
        <dl className="mt-2 flex flex-col gap-3">
          <Fact label={copy("context.lifecycle")}>
            {assessment?.lifecycle
              ? canonicalLifecycleLabel(assessment.lifecycle.state)
              : copy("context.notAvailable")}
          </Fact>
          <Fact label={copy("context.executionState")}>
            {assessment?.runtime
              ? canonicalExecutionLabel(assessment.runtime.executionState)
              : copy("context.notAvailable")}
          </Fact>
          <Fact label={copy("context.thread")}>
            <code className="text-xs break-all">
              {assessment?.runtime?.threadId ?? copy("context.notAvailable")}
            </code>
          </Fact>
          <Fact label={copy("context.execution")}>
            <code className="text-xs break-all">
              {assessment?.runtime?.currentExecutionId ??
                copy("context.notAvailable")}
            </code>
          </Fact>
          <Fact label={copy("context.checkpoint")}>
            <code className="text-xs break-all">
              {assessment?.runtime?.checkpointId ?? copy("context.notAvailable")}
            </code>
          </Fact>
          <Fact label={copy("context.connection")}>
            {connectionLabel(workspace.connectionState)}
          </Fact>
        </dl>
      </details>
    </aside>
  );
}

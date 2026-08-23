"use client";

import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import {
  WIZARD_CLARIFICATION_QUESTION_IDS,
  WIZARD_CLARIFICATION_QUESTIONS,
  WIZARD_CLARIFICATION_REQUEST_KIND,
  WIZARD_CLARIFICATION_REQUESTERS,
  WIZARD_CLARIFICATION_SCOPES,
} from "@lcsp/contracts/wizard";
import type {
  WizardClarificationAgentQuestion,
  WizardClarificationQuestion,
  WizardClarificationQuestionId,
  WizardClarificationRequester,
  WizardClarificationRequest,
  WizardClarificationScope,
} from "@lcsp/contracts/wizard";
import { resolveMessage } from "@lcsp/i18n";
import { ActivityIcon, BotIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  buildRuntimeConsoleModel,
  isActiveRuntimeStatus,
  selectRuntimeConsoleActivity,
  type RuntimeConsoleStep,
} from "@/features/evidence/utils/runtime-console";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeConnectionState,
  type WorkspaceRuntimeSummaryValue,
} from "@/features/workspace/types/workspace-runtime.types";
import { useRerunRepositoryScanMutation } from "@/lib/api/assessment-queries";
import { appLocale } from "@/lib/locale";

type SummaryRecord = {
  tool?: string;
  operation?: string;
  arguments?: { text?: string; limit?: number; [key: string]: unknown };
  result?: { observationId?: string; error?: string; [key: string]: unknown };
  output_tokens?: number;
  request_id?: string;
  model?: string;
  model_chain?: string[];
  node_name?: string;
  tool_call_count?: number;
  tool_names?: string[];
  [key: string]: unknown;
};

type RuntimeClarificationRequest = Omit<
  WizardClarificationRequest,
  "questionIds"
> & {
  questionIds: WizardClarificationQuestionId[];
  questions: WizardClarificationAgentQuestion[];
};

const RUNTIME_STEP_STATUS_SKIPPED = "skipped";
const NOT_APPLICABLE_PROVENANCE_HASH = "sha256:not-applicable";
const REPOSITORY_SCAN_STALE_AFTER_MS = 5 * 60 * 1000;

function SemanticSummary({
  item,
  expanded,
}: {
  item: WorkspaceRuntimeActivityItem;
  expanded: boolean;
}) {
  const input = (item.inputSummary || {}) as SummaryRecord;
  const output = (item.outputSummary || {}) as SummaryRecord;
  const tool = input.tool || output.tool || item.toolName;
  const isLlm =
    input.operation === "complete_with_tools" ||
    output.operation === "complete_with_tools" ||
    item.eventType === "LLM_REQUEST" ||
    item.eventType === "LLM_RESPONSE";

  let summary = item.summary;

  if (isLlm) {
    summary = "Agent reasoning with LLM";
  } else if (tool === "search_nodes") {
    const args = input.arguments || output.arguments || input;
    const text = args?.text;
    summary = text ? `Search graph for: ${text}` : "Search graph";
  } else if (tool === "list_observations") {
    summary = "List retrieved observations";
  }

  if (!summary) return null;

  return (
    <p
      className={
        expanded
          ? "mt-0.5 font-mono text-xs leading-relaxed text-zinc-500"
          : "mt-0.5 truncate font-mono text-xs text-zinc-400"
      }
    >
      {summary}
    </p>
  );
}

function SemanticRuntimeDetails({
  item,
}: {
  item: WorkspaceRuntimeActivityItem;
}) {
  const input = (item.inputSummary || {}) as SummaryRecord;
  const output = (item.outputSummary || {}) as SummaryRecord;
  const clarificationRequest = parseClarificationRequest(item);

  if (clarificationRequest !== null) {
    return (
      <RuntimeClarificationRequestCard
        item={item}
        request={clarificationRequest}
      />
    );
  }

  const isLlm =
    input.operation === "complete_with_tools" ||
    output.operation === "complete_with_tools" ||
    item.eventType === "LLM_REQUEST" ||
    item.eventType === "LLM_RESPONSE";
  const tool = input.tool || output.tool || item.toolName;

  if (isLlm) {
    const isResponse =
      !!output.output_tokens ||
      !!output.request_id ||
      item.eventType === "toolCompleted" ||
      item.eventType === "LLM_RESPONSE";
    const model =
      output.model ||
      input.model ||
      (input.model_chain ? input.model_chain[0] : "unknown-model");
    const nodeName = input.node_name || output.node_name;
    const toolCount = output.tool_call_count;
    const toolNames = input.tool_names || [];

    return (
      <div className="px-4 pb-3 md:pl-36">
        <div className="rounded-md border border-indigo-200 bg-indigo-50/50 p-3 font-mono text-xs text-indigo-900 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <BotIcon className="size-4 text-indigo-600" />
            <span>LLM Reasoning Workflow</span>
          </div>
          <div className="mt-2 space-y-1.5 opacity-90">
            <p>
              Model:{" "}
              <span className="font-semibold text-indigo-700">{model}</span>
            </p>
            {nodeName ? (
              <p>
                Analyzing Node:{" "}
                <span className="text-indigo-700">{nodeName}</span>
              </p>
            ) : null}
            {!isResponse ? (
              <p>
                Available Tools:{" "}
                <span className="text-indigo-700">{toolNames.join(", ")}</span>
              </p>
            ) : (
              <p>
                Agent executed{" "}
                <span className="font-semibold text-indigo-700">
                  {toolCount || 0}
                </span>{" "}
                tool call(s).
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (tool === "search_nodes" || tool === "list_observations") {
    const args = input.arguments || output.arguments || input;
    const result = output.result || output;

    let actionText: React.ReactNode = "";
    let resultText: React.ReactNode = "";

    if (tool === "search_nodes") {
      actionText = args?.text ? (
        <>
          Searched graph for:{" "}
          <span className="font-semibold text-blue-700">
            &quot;{String(args.text)}&quot;
          </span>
        </>
      ) : (
        <>Executed graph search</>
      );

      if (result?.observationId) {
        resultText = (
          <>
            Retrieved observation{" "}
            <span className="font-semibold text-emerald-700">
              {String(result.observationId)}
            </span>
            .
          </>
        );
      } else if (result?.error) {
        resultText = (
          <span className="text-red-600">Error: {String(result.error)}</span>
        );
      }
    } else if (tool === "list_observations") {
      actionText = args?.limit ? (
        <>
          Requested up to{" "}
          <span className="font-semibold text-blue-700">
            {String(args.limit)}
          </span>{" "}
          observations.
        </>
      ) : (
        <>Requested list of observations.</>
      );

      if (result?.total !== undefined) {
        resultText = (
          <>
            Found{" "}
            <span className="font-semibold text-emerald-700">
              {String(result.total)}
            </span>{" "}
            total observations.
          </>
        );
      }
    }

    return (
      <div className="px-4 pb-3 md:pl-36">
        <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 font-mono text-xs text-blue-900 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ActivityIcon className="size-4 text-blue-600" />
            <span>
              {tool === "search_nodes" ? "Graph Search" : "List Observations"}
            </span>
          </div>
          <div className="mt-2 space-y-1.5 opacity-90">
            <p>{actionText}</p>
            {resultText ? <p>{resultText}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  // Fallback
  return <RuntimeDetailList item={item} />;
}

function RuntimeClarificationRequestCard({
  item,
  request,
}: {
  item: WorkspaceRuntimeActivityItem;
  request: RuntimeClarificationRequest;
}) {
  const questions = request.questionIds
    .map(findClarificationQuestion)
    .filter(isClarificationQuestion);
  const agentQuestions = request.questions;

  return (
    <div className="px-4 pb-3 md:pl-36">
      <div className="rounded-md border border-sky-200 bg-sky-50/70 p-3 font-mono text-xs text-sky-950 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-semibold">
              <ActivityIcon className="size-4 text-sky-600" />
              <span>
                {t("pages.technicalEvidence.clarificationRequestTitle")}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sky-900/80">
              {t("pages.technicalEvidence.clarificationRequestDescription")}
            </p>
          </div>
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={`/assessments/${encodeURIComponent(item.assessmentId)}/wizard`}
          >
            {t("pages.technicalEvidence.clarificationRequestOpenWizard")}
          </Link>
        </div>
        <dl className="mt-3 grid gap-1.5 text-sky-900/90 sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-sky-700/80">
              {t("pages.technicalEvidence.clarificationRequestScopeLabel")}
            </dt>
            <dd>{request.scope}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-sky-700/80">
              {t("pages.technicalEvidence.clarificationRequestReasonLabel")}
            </dt>
            <dd>{request.reasonCode}</dd>
          </div>
        </dl>
        {questions.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {questions.map((question) => (
              <li
                className="rounded border border-sky-200 bg-white/80 px-3 py-2"
                key={question.id}
              >
                <p className="font-semibold text-sky-950">
                  {t(question.labelKey)}
                </p>
                <p className="mt-1 text-sky-900/80">{t(question.detailKey)}</p>
                <p className="mt-2 text-sky-700/80">
                  {t(
                    "pages.technicalEvidence.clarificationCollectionRuleLabel",
                  )}
                  : {t(question.collectionRuleKey)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {agentQuestions.length > 0 ? (
          <ul className="mt-3 grid gap-2">
            {agentQuestions.map((question) => (
              <li
                className="rounded border border-sky-200 bg-white/80 px-3 py-2"
                key={question.id}
              >
                <p className="font-semibold text-sky-950">{question.text}</p>
                <p className="mt-1 text-sky-900/80">
                  {t("pages.technicalEvidence.clarificationRequestReasonLabel")}
                  : {question.reasonCode}
                </p>
                <p className="mt-1 text-sky-700/80">
                  {question.targetFieldName ?? question.targetKind} ·{" "}
                  {Math.round(question.routingConfidence * 100)}%
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function TechnicalEvidenceRuntimePage({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const runtime = useWorkspaceRuntime();
  const scanJobs = runtime.scanJobs.filter(
    (scanJob) => scanJob.assessmentId === assessmentId,
  );
  const repositorySnapshots = runtime.repositorySnapshots.filter(
    (snapshot) => snapshot.assessmentId === assessmentId,
  );
  const reports = runtime.evidenceReports.filter(
    (report) => report.assessmentId === assessmentId,
  );
  const timeline = runtime.getAssessmentRuntime(assessmentId);
  const latestScan = scanJobs[0];
  const activeCurrentRun = isActiveRuntimeStatus(timeline.currentRun?.status)
    ? timeline.currentRun
    : null;
  const consoleModel = buildRuntimeConsoleModel(
    selectRuntimeConsoleActivity({
      activity: timeline.recentActivity,
      latestScanJobId: latestScan?.id ?? null,
      activeRunId: activeCurrentRun?.runId ?? null,
      latestRunId: timeline.latestRunId,
    }),
  );
  const showOrchestration =
    activeCurrentRun !== null || consoleModel.steps.length > 0;
  const rerunMutation = useRerunRepositoryScanMutation(assessmentId);
  const rerunSnapshotId = latestScan?.snapshotId ?? repositorySnapshots[0]?.id;
  const hasActiveScan = scanJobs.some(isFreshActiveScanJob);
  const rerunDisabled =
    hasActiveScan || rerunSnapshotId === undefined || rerunMutation.isPending;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-3xl font-semibold tracking-tight">
                {t("pages.technicalEvidence.pageTitle")}
              </h1>
              <Badge variant={connectionBadgeVariant(runtime.connectionState)}>
                {connectionLabel(runtime.connectionState)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("pages.technicalEvidence.pageDescription")}
            </p>
          </div>
          <Button
            disabled={rerunDisabled}
            onClick={() => {
              if (!rerunDisabled && rerunSnapshotId !== undefined) {
                rerunMutation.mutate({ snapshotId: rerunSnapshotId });
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcwIcon />
            {rerunMutation.isPending
              ? t("pages.technicalEvidence.rerunningScan")
              : t("pages.technicalEvidence.rerunScan")}
          </Button>
        </div>
      </header>

      {showOrchestration ? (
        <section className="overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <ActivityIcon className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">
                {t("pages.technicalEvidence.orchestrationTitle")}
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {timeline.lastEmittedAt === null
                ? t("pages.technicalEvidence.awaitingEvent")
                : `${t("pages.technicalEvidence.lastUpdated")}: ${formatDate(timeline.lastEmittedAt)}`}
            </span>
          </div>

          {consoleModel.steps.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {t("pages.technicalEvidence.noOrchestrationActivity")}
            </p>
          ) : (
            <RuntimeConsole model={consoleModel} />
          )}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-medium">
            {t("pages.technicalEvidence.scanJobsTitle")}
          </h2>
          <span className="text-xs text-muted-foreground">
            {runtime.emittedAt === null
              ? t("pages.technicalEvidence.awaitingEvent")
              : `${t("pages.technicalEvidence.lastUpdated")}: ${formatDate(runtime.emittedAt)}`}
          </span>
        </div>
        {rerunMutation.isError && (
          <p className="border-b px-4 py-3 text-sm text-destructive">
            {t("pages.technicalEvidence.rerunError")}
          </p>
        )}
        {scanJobs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("pages.technicalEvidence.noScanJobs")}
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {scanJobs.map((scanJob, index) => {
              const displayStatus = isStaleActiveScanJob(scanJob)
                ? REPOSITORY_SCAN_JOB_STATUSES.failed
                : scanJob.status;
              return (
                <li
                  className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  key={scanJob.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t("pages.technicalEvidence.scanJobLabel")} #
                      {scanJobs.length - index}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("pages.technicalEvidence.updatedAt")}:{" "}
                      {formatDate(scanJob.updatedAt)}
                    </p>
                    {scanJob.blockedReason !== null && (
                      <p className="mt-1 text-xs text-destructive">
                        {scanJob.blockedReason}
                      </p>
                    )}
                  </div>
                  <Badge variant={scanBadgeVariant(displayStatus)}>
                    {scanStatusLabel(displayStatus)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-medium">
            {t("pages.technicalEvidence.evidenceReportsTitle")}
          </h2>
        </div>
        {reports.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("pages.technicalEvidence.noEvidenceReports")}
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {reports.map((report, index) => (
              <li
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={report.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t("pages.technicalEvidence.evidenceReportLabel")} #
                    {reports.length - index}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("pages.technicalEvidence.createdAt")}:{" "}
                    {formatDate(report.createdAt)}
                  </p>
                  {report.rejectionReason !== null && (
                    <p className="mt-1 text-xs text-destructive">
                      {report.rejectionReason}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    report.status ===
                    TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted
                      ? "default"
                      : "destructive"
                  }
                >
                  {reportStatusLabel(report.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RuntimeConsole({
  model,
}: {
  model: ReturnType<typeof buildRuntimeConsoleModel>;
}) {
  const activeTitle =
    model.activeStep === null
      ? t("pages.technicalEvidence.noActiveStep")
      : runtimeStepTitle(model.activeStep.item);
  const activeSummary =
    model.activeStep === null ? null : model.activeStep.item.summary;

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [model.steps.length]);

  return (
    <div className="bg-white text-zinc-800">
      {/* Status bar */}
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={
                model.activeStep === null
                  ? "size-2 shrink-0 rounded-full bg-zinc-400"
                  : "size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
              }
            />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-semibold text-zinc-800">
                {activeTitle}
                {model.activeStep !== null ? <AnimatedDots /> : null}
              </p>
              {activeSummary !== null ? (
                <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                  {activeSummary}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
            {model.runningCount > 0 ? (
              <span className="text-emerald-600">
                {model.runningCount}{" "}
                {t("pages.technicalEvidence.runningStepsLabel")}
              </span>
            ) : null}
            {model.waitingCount > 0 ? (
              <span className="text-sky-600">
                {model.waitingCount}{" "}
                {t("pages.technicalEvidence.waitingStepsLabel")}
              </span>
            ) : null}
            <span className="text-zinc-400">
              {model.completedCount}{" "}
              {t("pages.technicalEvidence.completedStepsLabel")}
            </span>
            {model.failedCount > 0 ? (
              <span className="text-amber-600">
                {model.failedCount}{" "}
                {t("pages.technicalEvidence.failedStepsLabel")}
              </span>
            ) : null}
            {model.skippedCount > 0 ? (
              <span className="text-zinc-400">
                {model.skippedCount}{" "}
                {t("pages.technicalEvidence.skippedStepsLabel")}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Fixed-height scrollable log area — new entries appear at bottom */}
      <div className="relative">
        {/* Fade-out at top to hint scrollability */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-white to-transparent" />
        <div
          className="h-96 overflow-y-auto scroll-smooth py-2"
          style={{
            scrollbarColor: "#d4d4d8 transparent",
            scrollbarWidth: "thin",
          }}
        >
          <ul className="flex flex-col">
            {model.steps.map((step) => (
              <RuntimeConsoleStepItem
                key={`${step.id}:${step.isActive ? "active" : "idle"}`}
                step={step}
              />
            ))}
          </ul>
          {/* Invisible anchor element — always scrolled into view */}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

function RuntimeConsoleStepItem({ step }: { step: RuntimeConsoleStep }) {
  const [expanded, setExpanded] = useState(step.defaultExpanded);
  const item = step.item;
  const durationLabel =
    item.durationMs === null ? null : formatDuration(item.durationMs);
  const detailCount = runtimeDetailCount(item);

  const prefixColor = step.isActive
    ? "text-emerald-600"
    : step.isFailed
      ? "text-amber-600"
      : "text-zinc-400";

  const titleColor = step.isActive
    ? "text-zinc-900 font-semibold"
    : step.isFailed
      ? "text-amber-700"
      : "text-zinc-500";

  let badgeStatus: string;
  if (item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped) {
    badgeStatus = RUNTIME_STEP_STATUS_SKIPPED;
  } else if (
    item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed ||
    item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed ||
    step.isFailed
  ) {
    badgeStatus = ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
  } else if (
    item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput ||
    item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting ||
    item.waitingReason !== null
  ) {
    badgeStatus = ASSESSMENT_RUNTIME_RUN_STATUSES.waiting;
  } else if (
    item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted ||
    item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted ||
    item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.completed ||
    !step.isActive
  ) {
    badgeStatus = ASSESSMENT_RUNTIME_RUN_STATUSES.completed;
  } else {
    badgeStatus = ASSESSMENT_RUNTIME_RUN_STATUSES.running;
  }

  return (
    <li
      className={
        step.isActive
          ? "border-l-2 border-emerald-500 bg-emerald-50"
          : step.isFailed
            ? "border-l-2 border-amber-400/60 bg-amber-50/40"
            : "border-l-2 border-transparent bg-white"
      }
    >
      <button
        aria-expanded={expanded}
        className="group flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-zinc-50"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {/* Timestamp column */}
        <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-zinc-400">
          {formatTime(item.emittedAt)}
        </span>

        {/* Stage pill */}
        <span className="mt-0.5 shrink-0 rounded bg-zinc-100 px-1.5 py-px font-mono text-xs text-zinc-500">
          {runtimeStageLabel(item.stage)}
        </span>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className={`font-mono text-xs ${prefixColor}`}>›</span>
            <span
              className={`min-w-0 truncate font-mono text-sm ${titleColor}`}
            >
              {runtimeStepTitle(item)}
              {step.isActive ? <AnimatedDots /> : null}
            </span>
            {durationLabel !== null ? (
              <span className="shrink-0 font-mono text-xs text-zinc-400">
                [{durationLabel}]
              </span>
            ) : null}
          </div>
          <SemanticSummary item={item} expanded={expanded} />
          {!expanded && detailCount > 0 ? (
            <p className="mt-0.5 font-mono text-xs text-zinc-400">
              {t("pages.technicalEvidence.logDetailsHint")}
            </p>
          ) : null}
        </div>

        {/* Status badges */}
        <div className="flex shrink-0 items-center gap-1.5">
          {step.isFailed &&
          item.runStatus !== ASSESSMENT_RUNTIME_RUN_STATUSES.failed ? (
            <Badge className="border-amber-500/40 bg-amber-50 text-amber-700 text-xs">
              {t("pages.technicalEvidence.nonBlockingFailureLabel")}
            </Badge>
          ) : null}
          <Badge
            variant={runtimeStatusBadgeVariant(badgeStatus)}
            className="text-xs"
          >
            {runtimeStatusLabel(badgeStatus)}
          </Badge>
        </div>
      </button>
      {expanded ? <SemanticRuntimeDetails item={item} /> : null}
    </li>
  );
}

function RuntimeDetailList({ item }: { item: WorkspaceRuntimeActivityItem }) {
  const details = [
    item.inputSummary === null
      ? null
      : {
          label: t("pages.technicalEvidence.inputSummaryLabel"),
          values: formatSummaryEntries(item.inputSummary),
        },
    item.outputSummary === null
      ? null
      : {
          label: t("pages.technicalEvidence.outputSummaryLabel"),
          values: formatSummaryEntries(item.outputSummary),
        },
    item.errorSummary === null
      ? null
      : {
          label: t("pages.technicalEvidence.errorSummaryLabel"),
          values: [
            {
              label: t("pages.technicalEvidence.messageLabel"),
              value: item.errorSummary,
            },
          ],
        },
    item.waitingReason === null
      ? null
      : {
          label: t("pages.technicalEvidence.waitingReasonLabel"),
          values: [
            {
              label: t("pages.technicalEvidence.reasonLabel"),
              value: item.waitingReason,
            },
          ],
        },
  ].filter(isDefined);

  if (details.length === 0) {
    return null;
  }

  return (
    <div className="px-4 pb-3 md:pl-36">
      <dl className="grid gap-2 border-l border-zinc-200 pl-4 font-mono text-xs">
        {details.map((detail) => (
          <div className="grid gap-1.5" key={detail.label}>
            <dt className="text-zinc-400">{detail.label}</dt>
            <dd className="grid gap-1">
              {detail.values.map((entry) => (
                <div
                  className="grid gap-1 rounded bg-zinc-50 px-2 py-1.5 sm:flex sm:items-start"
                  key={`${detail.label}-${entry.label}`}
                >
                  <span className="truncate text-zinc-400 sm:w-40 sm:shrink-0">
                    {entry.label}
                  </span>
                  <span className="break-words text-zinc-700">
                    {entry.value}
                  </span>
                </div>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function parseClarificationRequest(
  item: WorkspaceRuntimeActivityItem,
): RuntimeClarificationRequest | null {
  const candidates = [item.outputSummary, item.inputSummary];
  for (const candidate of candidates) {
    if (!isSummaryRecord(candidate)) {
      continue;
    }
    if (candidate.kind !== WIZARD_CLARIFICATION_REQUEST_KIND) {
      continue;
    }
    if (!isClarificationScope(candidate.scope)) {
      continue;
    }
    if (!isClarificationRequester(candidate.requestedBy)) {
      continue;
    }
    if (typeof candidate.reasonCode !== "string") {
      continue;
    }
    const questionIds = Array.isArray(candidate.questionIds)
      ? candidate.questionIds.filter(isClarificationQuestionId)
      : [];
    const questions = Array.isArray(candidate.questions)
      ? candidate.questions.filter(isAgentQuestion)
      : [];

    if (questionIds.length === 0 && questions.length === 0) {
      continue;
    }

    return {
      kind: WIZARD_CLARIFICATION_REQUEST_KIND,
      scope: candidate.scope,
      requestedBy: candidate.requestedBy,
      reasonCode: candidate.reasonCode,
      questionIds,
      questions,
    };
  }

  return null;
}

function isSummaryRecord(
  value: WorkspaceRuntimeSummaryValue | null,
): value is Record<string, WorkspaceRuntimeSummaryValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClarificationQuestionId(
  value: WorkspaceRuntimeSummaryValue,
): value is WizardClarificationQuestionId {
  return (
    typeof value === "string" &&
    Object.values(WIZARD_CLARIFICATION_QUESTION_IDS).includes(
      value as WizardClarificationQuestionId,
    )
  );
}

function isClarificationScope(
  value: WorkspaceRuntimeSummaryValue,
): value is WizardClarificationScope {
  return (
    typeof value === "string" &&
    Object.values(WIZARD_CLARIFICATION_SCOPES).includes(
      value as WizardClarificationScope,
    )
  );
}

function isClarificationRequester(
  value: WorkspaceRuntimeSummaryValue,
): value is WizardClarificationRequester {
  return (
    typeof value === "string" &&
    Object.values(WIZARD_CLARIFICATION_REQUESTERS).includes(
      value as WizardClarificationRequester,
    )
  );
}

function isAgentQuestion(
  value: WorkspaceRuntimeSummaryValue,
): value is WizardClarificationAgentQuestion {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.language === "string" &&
    typeof value.targetKind === "string" &&
    typeof value.severity === "string" &&
    typeof value.reasonCode === "string" &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every((item) => typeof item === "string") &&
    typeof value.status === "string" &&
    typeof value.routingMethod === "string" &&
    typeof value.routingConfidence === "number" &&
    typeof value.answerControl === "string"
  );
}

function findClarificationQuestion(
  questionId: WizardClarificationQuestionId,
): WizardClarificationQuestion | undefined {
  return WIZARD_CLARIFICATION_QUESTIONS.find(
    (question) => question.id === questionId,
  );
}

function isClarificationQuestion(
  value: WizardClarificationQuestion | undefined,
): value is WizardClarificationQuestion {
  return value !== undefined;
}

function AnimatedDots() {
  return (
    <span aria-hidden="true" className="inline-flex w-6 overflow-hidden">
      <span className="animate-pulse">...</span>
    </span>
  );
}

function runtimeDetailCount(item: WorkspaceRuntimeActivityItem) {
  return [
    item.inputSummary,
    item.outputSummary,
    item.errorSummary,
    item.waitingReason,
  ].filter((value) => value !== null).length;
}

function runtimeStepTitle(item: WorkspaceRuntimeActivityItem) {
  if (item.toolName) {
    try {
      const toolKey = `pages.technicalEvidence.runtimeToolLabels.${item.toolName}`;
      const label = t(toolKey);
      if (label && !label.includes("runtimeToolLabels")) {
        return label;
      }
    } catch {
      // Ignore
    }
    return item.toolName;
  }
  return runtimeEventLabel(item.eventType);
}

function formatSummaryEntries(value: WorkspaceRuntimeSummaryValue) {
  const entries = flattenSummaryValue(value);
  if (entries.length > 0) {
    return entries;
  }
  return [
    {
      label: t("pages.technicalEvidence.valueLabel"),
      value: formatSummaryValue(value),
    },
  ];
}

function flattenSummaryValue(
  value: WorkspaceRuntimeSummaryValue,
  prefix?: string,
): Array<{ label: string; value: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenSummaryValue(
        item,
        prefix === undefined ? String(index) : `${prefix}.${index}`,
      ),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenSummaryValue(
        child,
        prefix === undefined ? key : `${prefix}.${key}`,
      ),
    );
  }
  if (prefix === undefined) {
    return [];
  }
  return [
    {
      label: humanizeRuntimeKey(prefix),
      value: formatSummaryValue(value),
    },
  ];
}

function humanizeRuntimeKey(value: string) {
  return value
    .replaceAll(".", " / ")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function connectionBadgeVariant(state: WorkspaceRuntimeConnectionState) {
  return state === WORKSPACE_RUNTIME_CONNECTION_STATES.connected
    ? "default"
    : "secondary";
}

function connectionLabel(state: WorkspaceRuntimeConnectionState) {
  if (state === WORKSPACE_RUNTIME_CONNECTION_STATES.connected) {
    return t("pages.technicalEvidence.connectionConnected");
  }
  if (state === WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected) {
    return t("pages.technicalEvidence.connectionDisconnected");
  }
  return t("pages.technicalEvidence.connectionConnecting");
}

function scanBadgeVariant(status: string) {
  if (status === REPOSITORY_SCAN_JOB_STATUSES.completed) return "default";
  if (
    status === REPOSITORY_SCAN_JOB_STATUSES.failed ||
    status === REPOSITORY_SCAN_JOB_STATUSES.blocked ||
    status === REPOSITORY_SCAN_JOB_STATUSES.blockedMapping
  ) {
    return "destructive";
  }
  return "secondary";
}

function scanStatusLabel(status: string) {
  const statuses = REPOSITORY_SCAN_JOB_STATUSES;
  if (status === statuses.queued)
    return t("pages.technicalEvidence.scanStatuses.queued");
  if (status === statuses.running)
    return t("pages.technicalEvidence.scanStatuses.running");
  if (status === statuses.completed)
    return t("pages.technicalEvidence.scanStatuses.completed");
  if (status === statuses.failed)
    return t("pages.technicalEvidence.scanStatuses.failed");
  if (status === statuses.blocked)
    return t("pages.technicalEvidence.scanStatuses.blocked");
  return t("pages.technicalEvidence.scanStatuses.pending");
}

function isFreshActiveScanJob(scanJob: { status: string; updatedAt: string }) {
  return (
    isActiveScanJobStatus(scanJob.status) && !isStaleActiveScanJob(scanJob)
  );
}

function isStaleActiveScanJob(scanJob: { status: string; updatedAt: string }) {
  if (!isActiveScanJobStatus(scanJob.status)) {
    return false;
  }
  const updatedAt = new Date(scanJob.updatedAt).getTime();
  return (
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt > REPOSITORY_SCAN_STALE_AFTER_MS
  );
}

function isActiveScanJobStatus(status: string) {
  return (
    status === REPOSITORY_SCAN_JOB_STATUSES.queued ||
    status === REPOSITORY_SCAN_JOB_STATUSES.running
  );
}

function reportStatusLabel(status: string) {
  return status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted
    ? t("pages.technicalEvidence.evidenceStatuses.accepted")
    : t("pages.technicalEvidence.evidenceStatuses.rejected");
}

function runtimeStatusBadgeVariant(status: string) {
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) return "destructive";
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed) return "default";
  return "secondary";
}

function runtimeStatusLabel(status: string) {
  const statuses = ASSESSMENT_RUNTIME_RUN_STATUSES;
  if (status === statuses.running)
    return t("pages.technicalEvidence.runtimeStatuses.running");
  if (status === statuses.waiting)
    return t("pages.technicalEvidence.runtimeStatuses.waiting");
  if (status === statuses.completed)
    return t("pages.technicalEvidence.runtimeStatuses.completed");
  if (status === statuses.failed)
    return t("pages.technicalEvidence.runtimeStatuses.failed");
  if (status === RUNTIME_STEP_STATUS_SKIPPED)
    return t("pages.technicalEvidence.runtimeStatuses.skipped");
  return status;
}

function runtimeStageLabel(stage: string) {
  const stages = ASSESSMENT_RUNTIME_STAGE_CODES;
  if (stage === stages.snapshot)
    return t("pages.technicalEvidence.runtimeStages.snapshot");
  if (stage === stages.scan)
    return t("pages.technicalEvidence.runtimeStages.scan");
  if (stage === stages.technicalEvidence)
    return t("pages.technicalEvidence.runtimeStages.technicalEvidence");
  if (stage === stages.technicalProfile)
    return t("pages.technicalEvidence.runtimeStages.technicalProfile");
  if (stage === stages.aiUsageFlow)
    return t("pages.technicalEvidence.runtimeStages.aiUsageFlow");
  if (stage === stages.reconciliation)
    return t("pages.technicalEvidence.runtimeStages.reconciliation");
  if (stage === stages.classification)
    return t("pages.technicalEvidence.runtimeStages.classification");
  if (stage === stages.conflicts)
    return t("pages.technicalEvidence.runtimeStages.conflicts");
  if (stage === stages.documents)
    return t("pages.technicalEvidence.runtimeStages.documents");
  if (stage === stages.legalRetrieval)
    return t("pages.technicalEvidence.runtimeStages.legalRetrieval");
  return stage;
}

function runtimeEventLabel(eventType: string) {
  const events = ASSESSMENT_RUNTIME_EVENT_TYPES;
  if (eventType === events.runStarted)
    return t("pages.technicalEvidence.runtimeEvents.runStarted");
  if (eventType === events.runStageChanged)
    return t("pages.technicalEvidence.runtimeEvents.runStageChanged");
  if (eventType === events.toolStarted)
    return t("pages.technicalEvidence.runtimeEvents.toolStarted");
  if (eventType === events.toolCompleted)
    return t("pages.technicalEvidence.runtimeEvents.toolCompleted");
  if (eventType === events.toolFailed)
    return t("pages.technicalEvidence.runtimeEvents.toolFailed");
  if (eventType === events.toolWaitingInput)
    return t("pages.technicalEvidence.runtimeEvents.toolWaitingInput");
  if (eventType === events.toolSkipped)
    return t("pages.technicalEvidence.runtimeEvents.toolSkipped");
  if (eventType === events.runCompleted)
    return t("pages.technicalEvidence.runtimeEvents.runCompleted");
  if (eventType === events.runFailed)
    return t("pages.technicalEvidence.runtimeEvents.runFailed");
  return eventType;
}

function formatSummaryValue(value: WorkspaceRuntimeSummaryValue) {
  if (typeof value === "string") {
    if (value === NOT_APPLICABLE_PROVENANCE_HASH) {
      return t("pages.technicalEvidence.notApplicableValueLabel");
    }
    return value;
  }
  if (value === null) {
    return t("pages.technicalEvidence.emptyValueLabel");
  }
  return JSON.stringify(value);
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(appLocale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

"use client";
import { useRef, useState } from "react";
import { AGENT_EXECUTION_STATES as A } from "@lcsp/contracts/assessment";
import {
  preparationRuleBatchSchema,
  type PreparationRuleHistory,
} from "@lcsp/contracts/legal-rule-catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  useLegalRuleCommand,
  usePreparationRuleHistory,
} from "@/lib/api/legal-rule-catalog-queries";
import { canonicalExecutionLabel } from "@/features/workspace/utils/assessment-runtime-formatter";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import {
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { useRuleSetPreparationActivity } from "../../hooks/use-rule-set-preparation-activity";
import {
  projectPreparationActivity,
  preparationTokenUsage,
} from "../../utils/rule-set-preparation-activity";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { resolvePreparationFailureDetails } from "../../utils/legal-rule-formatter";
import { LEGAL_RULE_COMPARE_NONE } from "../../config/legal-rule-catalog.config";

type ResultRevision = PreparationRuleHistory["results"][number];

/**
 * Business purpose: Present the agent output and execution outcome for a single rule preparation revision without exposing internal identifiers, source pins, or instruction internals.
 * Business rules:
 * - Only the agent analysis and generated rule outputs (legal requirements, assessment rules) are rendered.
 * - UUIDs, preparation run identifiers, catalog/source pins, and instruction fingerprints are excluded.
 * Execution flow:
 * 1. Render revision header with execution state badge.
 * 2. Display failure banner if the run failed.
 * 3. Present agent analysis text.
 * 4. List structured generated legal requirements and assessment rules when available.
 * Failure cases:
 * - Absent output displays a localized empty notice; failure codes are surfaced in a high-visibility alert.
 * Side effects:
 * - Pure presentation; does not trigger mutations or background jobs.
 */
export function LegalRuleResultRevision({
  result,
  current,
  events,
}: {
  result: ResultRevision;
  current?: boolean;
  events?: AssessmentAgentStreamEvent[];
}) {
  const reqs = result.output?.legalRequirements ?? [];
  const rules = result.output?.assessmentRules ?? [];
  const failureDetails = resolvePreparationFailureDetails({
    failureCode: result.failureCode,
    executionState: result.executionState,
    events,
    t: (key) => t(key as Parameters<typeof t>[0]),
  });

  return (
    <article className="min-w-0 space-y-6 rounded-xl border bg-card/50 p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h4 className="text-base font-bold text-foreground">
            {t("revision")} {result.revision}
          </h4>
          {current ? <Badge>{t("current")}</Badge> : null}
          <Badge variant="outline">
            {canonicalExecutionLabel(result.executionState)}
          </Badge>
        </div>
        {result.completedAt || result.createdAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(result.completedAt ?? result.createdAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {failureDetails ? (
        <Alert
          variant="destructive"
          className="space-y-3 rounded-xl border-destructive/40 bg-destructive/10 p-5 shadow-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <AlertTitle className="text-sm font-bold tracking-tight text-destructive">
                {failureDetails.title}
              </AlertTitle>
              <AlertDescription className="text-xs leading-relaxed text-destructive/95">
                {failureDetails.description}
              </AlertDescription>
            </div>
            {failureDetails.technicalCode ? (
              <Badge
                variant="outline"
                className="shrink-0 border-destructive/40 bg-background/50 font-mono text-[10px] text-destructive"
              >
                {failureDetails.technicalCode}
              </Badge>
            ) : null}
          </div>

          {failureDetails.guidance ? (
            <div className="border-t border-destructive/20 pt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">
                {t("guidance")}:
              </span>{" "}
              {failureDetails.guidance}
            </div>
          ) : null}

          {failureDetails.provider || failureDetails.errorClass ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-destructive/15 pt-2 text-[11px] text-muted-foreground">
              {failureDetails.provider ? (
                <span>
                  {t("providerLabel")}:{" "}
                  <strong className="text-foreground">
                    {failureDetails.provider}
                  </strong>
                </span>
              ) : null}
              {failureDetails.model ? (
                <span>
                  {t("model")}:{" "}
                  <strong className="text-foreground">
                    {failureDetails.model}
                  </strong>
                </span>
              ) : null}
              {failureDetails.errorClass ? (
                <span>
                  {t("errorClassLabel")}:{" "}
                  <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                    {failureDetails.errorClass}
                  </code>
                </span>
              ) : null}
            </div>
          ) : null}
        </Alert>
      ) : null}

      <div className="space-y-2">
        <h5 className="text-sm font-semibold tracking-tight text-foreground">
          {t("analysis")}
        </h5>
        <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
          {result.output?.analysis ?? (
            <span className="italic text-muted-foreground">{t("noResult")}</span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-semibold tracking-tight text-foreground">
            {t("requirements")} ({reqs.length})
          </h5>
        </div>
        {reqs.length > 0 ? (
          <div className="space-y-3.5">
            {reqs.map((req, idx) => (
              <div
                key={idx}
                className="space-y-3 rounded-lg border bg-card p-4 text-sm shadow-xs transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-foreground leading-snug">
                    {req.title}
                  </span>
                  {req.nonRepositoryDuty ? (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {t("nonRepositoryDuty")}
                    </Badge>
                  ) : null}
                </div>
                {req.proposition ? (
                  <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">
                    {req.proposition}
                  </p>
                ) : null}
                {req.applicabilityConditions &&
                req.applicabilityConditions.length > 0 ? (
                  <div className="space-y-1.5 rounded-md bg-muted/25 p-3 text-xs">
                    <span className="font-semibold text-foreground">
                      {t("conditions")}:
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-1">
                      {req.applicabilityConditions.map((cond, cIdx) => (
                        <li key={cIdx}>{cond}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {req.qualifiers && req.qualifiers.length > 0 ? (
                  <div className="space-y-1 text-xs">
                    <span className="font-semibold text-foreground">
                      {t("qualifiers")}:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                      {req.qualifiers.map((qual, qIdx) => (
                        <li key={qIdx}>{qual}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {req.exceptions && req.exceptions.length > 0 ? (
                  <div className="space-y-1 text-xs">
                    <span className="font-semibold text-destructive">
                      {t("exceptions")}:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                      {req.exceptions.map((ex, eIdx) => (
                        <li key={eIdx}>{ex}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/10 p-4 text-center text-xs italic text-muted-foreground">
            {t("noResult")}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-semibold tracking-tight text-foreground">
            {t("assessmentRules")} ({rules.length})
          </h5>
        </div>
        {rules.length > 0 ? (
          <div className="space-y-3.5">
            {rules.map((rule, idx) => (
              <div
                key={idx}
                className="space-y-3 rounded-lg border bg-card p-4 text-sm shadow-xs transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-foreground leading-snug">
                    {rule.concept}
                  </span>
                </div>
                {rule.legalIntent ? (
                  <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">
                    {rule.legalIntent}
                  </p>
                ) : null}
                {rule.criteria && rule.criteria.length > 0 ? (
                  <div className="space-y-1.5 rounded-md bg-muted/25 p-3 text-xs">
                    <span className="font-semibold text-foreground">
                      {t("criteria")}:
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-1">
                      {rule.criteria.map((crit, cIdx) => (
                        <li key={cIdx}>
                          {crit.statement || crit.investigationFocus}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {rule.investigationGoals &&
                rule.investigationGoals.length > 0 ? (
                  <div className="space-y-1 text-xs">
                    <span className="font-semibold text-foreground">
                      {t("investigationGoals")}:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                      {rule.investigationGoals.map((goal, gIdx) => (
                        <li key={gIdx}>{goal}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {rule.requiredEvidence &&
                rule.requiredEvidence.length > 0 ? (
                  <div className="space-y-1 text-xs">
                    <span className="font-semibold text-foreground">
                      {t("requiredEvidence")}:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                      {rule.requiredEvidence.map((ev, evIdx) => (
                        <li key={evIdx}>{ev}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {rule.unresolvedConditions &&
                rule.unresolvedConditions.length > 0 ? (
                  <div className="space-y-1 text-xs">
                    <span className="font-semibold text-foreground">
                      {t("unresolvedConditions")}:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground pl-1">
                      {rule.unresolvedConditions.map((cond, unIdx) => (
                        <li key={unIdx}>{cond}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/10 p-4 text-center text-xs italic text-muted-foreground">
            {t("noResult")}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Business purpose: Present recent run observability events for a single legal rule preparation attempt in a clean, flat timeline.
 * Business rules:
 * - Only essential runtime information is rendered: overall execution status, model/provider if used, token count if reported (>0), and chronological activity steps.
 * - Technical IDs, run UUIDs, raw hashes, disclaimers, confusing fallback states (such as `NOT_REPORTED`), and nested disclosure containers are strictly omitted.
 * Execution flow:
 * 1. Subscribe to the activity event stream for the rule run.
 * 2. Project events into ordered activities using `projectPreparationActivity`.
 * 3. Render a summary bar showing execution state and optional model/token metrics.
 * 4. Render a flat vertical timeline displaying each step's title, model, status, and timestamp.
 * 5. Provide pagination control to fetch older events if available.
 * Failure cases:
 * - When activity events fail to load or are empty, show a concise localized notice without breaking the view.
 * Side effects:
 * - Subscribes to activity event streams for the run.
 */
export function LegalRuleRunActivity({ result }: { result: ResultRevision }) {
  const terminal =
    result.executionState !== A.QUEUED && result.executionState !== A.RUNNING;
  const activity = useRuleSetPreparationActivity(
    result.preparationRunId,
    terminal,
  );

  const activities = projectPreparationActivity(
    activity.events,
    terminal,
    result.executionState,
  );

  const usage = preparationTokenUsage(activity.events);
  const totalTokens = usage.totalTokens;

  const modelActivity = activities.find((item) => item.details.model);
  const modelName = modelActivity?.details.model;
  const provider = modelActivity?.details.provider;
  const modelDisplay = modelName
    ? provider
      ? `${provider} / ${modelName}`
      : modelName
    : null;

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              result.executionState === A.SUCCEEDED
                ? "default"
                : result.executionState === A.FAILED
                  ? "destructive"
                  : "secondary"
            }
          >
            {canonicalExecutionLabel(result.executionState)}
          </Badge>
          {!terminal && activity.connected ? (
            <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
              <span className="inline-block size-2 animate-ping rounded-full bg-blue-500" />
              {resolveAppMessage("pages.complianceRuleSets.activity.live")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {modelDisplay ? (
            <span className="font-medium text-foreground">
              {modelDisplay}
            </span>
          ) : null}
          {totalTokens > 0 ? (
            <span>
              {totalTokens.toLocaleString()} {t("tokens")}
            </span>
          ) : null}
        </div>
      </div>

      {/* History loading / error */}
      {activity.history.isPending ? (
        <p role="status" className="py-2 text-xs text-muted-foreground">
          {t("loading")}
        </p>
      ) : activity.history.isError ? (
        <p role="alert" className="py-2 text-xs text-destructive">
          {t("error")}
        </p>
      ) : activities.length === 0 ? (
        <p className="py-2 text-xs italic text-muted-foreground">
          {t("noActivity")}
        </p>
      ) : (
        <div className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:top-2 before:left-2 before:w-0.5 before:bg-border">
          {activities.map((item) => {
            const isCompleted =
              item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed;
            const isFailed =
              item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
            const isRunning =
              item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running;

            const stepTitle = item.details.claimFile
              ? formatAppMessage(item.labelKey, { file: item.details.claimFile })
              : resolveAppMessage(item.labelKey);

            const timestamp = item.event.emittedAt
              ? new Date(item.event.emittedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : null;

            return (
              <div
                key={item.id}
                className="relative flex items-start justify-between gap-3 text-sm"
              >
                {/* Step indicator dot */}
                <span
                  className={`absolute -left-6 top-1 flex size-4 items-center justify-center rounded-full ring-4 ring-background ${
                    isFailed
                      ? "bg-destructive text-destructive-foreground"
                      : isCompleted
                        ? "bg-emerald-600 text-white"
                        : isRunning
                          ? "animate-pulse bg-blue-600 text-white"
                          : "bg-muted-foreground/40 text-muted"
                  }`}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                </span>

                {/* Step content */}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground leading-snug">
                    {stepTitle}
                  </p>
                  {item.details.model && item.details.model !== modelName ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.details.provider
                        ? `${item.details.provider} / `
                        : ""}
                      {item.details.model}
                    </p>
                  ) : null}
                  {isFailed &&
                  (item.details.lastAttemptErrorClass ||
                    item.details.errorType) ? (
                    <p className="mt-1 font-mono text-xs text-destructive">
                      {item.details.lastAttemptErrorClass ??
                        item.details.errorType}
                    </p>
                  ) : null}
                </div>

                {/* Step metadata */}
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span
                    className={`text-xs font-medium ${
                      isFailed
                        ? "text-destructive"
                        : isCompleted
                          ? "text-emerald-600 dark:text-emerald-400"
                          : isRunning
                            ? "text-blue-600 dark:text-blue-400"
                            : "text-muted-foreground"
                    }`}
                  >
                    {isFailed
                      ? resolveAppMessage(
                          "pages.complianceRuleSets.activity.statuses.FAILED",
                        )
                      : isCompleted
                        ? resolveAppMessage(
                            "pages.complianceRuleSets.activity.statuses.COMPLETED",
                          )
                        : isRunning
                          ? resolveAppMessage(
                              "pages.complianceRuleSets.activity.statuses.RUNNING",
                            )
                          : resolveAppMessage(
                              "pages.complianceRuleSets.activity.terminalStatuses.FINISHED",
                            )}
                  </span>
                  {timestamp ? (
                    <span className="text-xs text-muted-foreground">
                      {timestamp}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activity.history.hasNextPage ? (
        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={activity.history.isFetchingNextPage}
            onClick={() => void activity.history.fetchNextPage()}
          >
            {t("loadOlder")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Business purpose: Inspect stored results and regenerate exactly one rule inside the Preparation workflow.
 * Business rules:
 * - History reads never start work; regeneration uses a stable request key and preserves prior source pins unless explicitly changed.
 * Execution flow:
 * 1. Load rule history
 * 2. Select revisions for comparison
 * 3. Confirm a single-rule regeneration and show its batch.
 * Failure cases:
 * - Request failures remain visible; active attempts cannot be submitted again.
 * Side effects:
 * - Read subscriptions and an explicitly confirmed regeneration through the canonical API.
 */
export function LegalRuleResultDialog({
  ruleId,
  onClose,
  onBatch,
}: {
  ruleId: string;
  onClose: () => void;
  onBatch: (id: string) => void;
}) {
  const history = usePreparationRuleHistory(ruleId);
  const regenerate = useLegalRuleCommand(
    `/rules/${ruleId}/regenerate`,
    preparationRuleBatchSchema,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [latestInputs, setLatestInputs] = useState(false);
  const requestKey = useRef("");
  const results = history.data?.results ?? [];
  const selected = results.find((row) => row.id === selectedId) ?? results[0];
  const previous = results.find((row) => row.id === compareId);
  const current = results.find(
    (row) => row.id === history.data?.currentResultId,
  );
  const active =
    results[0]?.executionState === A.QUEUED ||
    results[0]?.executionState === A.RUNNING;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader className="flex flex-col gap-1.5 border-b border-border/70 bg-muted/30 px-6 py-5 pr-14">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {t("viewResult")}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {t("outcomeNotice")}
          </DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <div className="p-6">
            <p role="status">{t("loading")}</p>
          </div>
        ) : history.isError ? (
          <div className="p-6">
            <Alert variant="destructive">
              <AlertDescription>{t("error")}</AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <div>
                <span className="text-muted-foreground">{t("current")}:</span>{" "}
                <strong className="font-semibold text-foreground">
                  {current
                    ? `${t("revision")} ${current.revision}`
                    : t("noResult")}
                </strong>
              </div>
              <div>
                <span className="text-muted-foreground">{t("latestAttempt")}:</span>{" "}
                <strong className="font-semibold text-foreground">
                  {results[0]
                    ? `${t("revision")} ${results[0].revision} · ${canonicalExecutionLabel(results[0].executionState)}`
                    : t("noResult")}
                </strong>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("chooseRevision")}</Label>
                <Select value={selected?.id} onValueChange={setSelectedId}>
                  <SelectTrigger aria-label={t("chooseRevision")}>
                    <SelectValue>
                      {selected
                        ? `${t("revision")} ${selected.revision}`
                        : t("chooseRevision")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {results.map((result) => (
                      <SelectItem key={result.id} value={result.id}>
                        {t("revision")} {result.revision} ·{" "}
                        {canonicalExecutionLabel(result.executionState)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("compare")}</Label>
                <Select
                  value={compareId ?? LEGAL_RULE_COMPARE_NONE}
                  onValueChange={(value) =>
                    setCompareId(
                      value === LEGAL_RULE_COMPARE_NONE ? null : value,
                    )
                  }
                >
                  <SelectTrigger aria-label={t("compare")}>
                    <SelectValue>
                      {previous
                        ? `${t("revision")} ${previous.revision}`
                        : t("chooseRevision")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LEGAL_RULE_COMPARE_NONE}>
                      {t("chooseRevision")}
                    </SelectItem>
                    {results.map((result) => (
                      <SelectItem key={result.id} value={result.id}>
                        {t("revision")} {result.revision}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {history.hasNextPage ? (
              <Button
                variant="outline"
                size="sm"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t("loadOlder")}
              </Button>
            ) : null}
            <div
              className={previous ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"}
            >
              {selected ? (
                <LegalRuleResultRevision
                  result={selected}
                  current={selected.id === history.data?.currentResultId}
                />
              ) : null}
              {previous ? (
                <LegalRuleResultRevision
                  result={previous}
                  current={previous.id === history.data?.currentResultId}
                />
              ) : null}
            </div>
            {selected ? (
              <details className="rounded-xl border bg-muted/15 p-4 transition-colors">
                <summary className="cursor-pointer text-sm font-semibold text-foreground hover:text-primary">
                  {t("activity")}
                </summary>
                <div className="mt-4">
                  <LegalRuleRunActivity result={selected} />
                </div>
              </details>
            ) : null}
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                disabled={active || !results.length || regenerate.isPending}
                onClick={() => {
                  requestKey.current = crypto.randomUUID();
                  setLatestInputs(false);
                  setConfirming(true);
                }}
              >
                {t("regenerate")}
              </Button>
            </div>
          </div>
        )}
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="flex flex-col gap-1.5 border-b border-border/70 pb-4">
              <DialogTitle>{t("regenerate")}</DialogTitle>
              <DialogDescription>
                {t("regenerateDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 p-6">
              <p className="text-sm">{t("samePins")}</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="latest-rule-inputs"
                  checked={latestInputs}
                  onCheckedChange={(value) => setLatestInputs(value === true)}
                />
                <Label htmlFor="latest-rule-inputs">{t("latestPins")}</Label>
              </div>
              {regenerate.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{t("error")}</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <DialogFooter className="px-6 pb-6">
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t("cancel")}
              </Button>
              <Button
                disabled={regenerate.isPending || !history.data?.latestResultId}
                onClick={async () => {
                  const result = await regenerate
                    .mutateAsync({
                      idempotencyKey: requestKey.current,
                      expectedResultId: history.data!.latestResultId,
                      useLatestInputs: latestInputs,
                    })
                    .catch(() => null);
                  if (result) {
                    onBatch(result.id);
                    setConfirming(false);
                    setSelectedId(null);
                  }
                }}
              >
                {regenerate.isPending ? t("loading") : t("regenerate")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

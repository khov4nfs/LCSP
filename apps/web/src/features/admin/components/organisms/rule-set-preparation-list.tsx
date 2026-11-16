import { useAppLocale } from "@/components/providers/locale-provider";
import { PreparationObservability } from "../molecules/preparation-observability";
import type { MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { useRef, useState } from "react";
import {
  RULE_SET_PREPARATION_SYSTEM_ACTOR,
  PREPARATION_EXECUTION_CONTRACTS,
  RULE_SET_PREPARATION_STAGES,
  CLAIM_PREPARATION_PHASES,
} from "@lcsp/contracts/compliance-rule-set";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAppMessage } from "@/lib/i18n";
import {
  useCancelRuleSetPreparationMutation,
  useRetryRuleSetPreparationMutation,
  useResumeRuleSetPreparationMutation,
  usePreparationSourceUnitsQuery,
} from "@/lib/api/compliance-rule-set-queries";
import {
  canonicalExecutionLabel,
  formatLocaleTimestamp,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import type { RuleSetPreparationListProps } from "../../types/compliance-rule-sets.types";
import { useRuleSetPreparationActivity } from "../../hooks/use-rule-set-preparation-activity";
import { RuleSetPreparationDraft } from "../molecules/rule-set-preparation-draft";
import { RuleSetPreparationActivity } from "../molecules/rule-set-preparation-activity";
import { PreparationSourceAnalysisExplorer } from "./preparation-source-analysis-explorer";
import { PreparationGeneratedCatalog } from "./preparation-generated-catalog";

const t = (key: string) => resolveAppMessage(key as MessageKey);
const PREPARATION_SECTIONS = [
  "source-analysis",
  "generated-catalog",
  "run-activity",
] as const;
type PreparationSection = (typeof PREPARATION_SECTIONS)[number];

/**
 * Business purpose: Present a known Preparation stage using its localized business label.
 *
 * Business rules:
 * - Only values in the shared Rule Set Preparation stage or Claim Preparation phase sets receive localized labels; unknown persisted values remain visible for diagnosis.
 *
 * Execution flow:
 * 1. Match the recorded stage against the shared stage constants.
 * 2. Resolve the matching translation key or preserve the unknown value, and use the localized not-recorded label when absent.
 *
 * Failure cases:
 * - An unknown stage is shown as recorded instead of being mapped to a different lifecycle outcome.
 *
 * Side effects:
 * - None: pure presentation mapping of an existing stage value.
 */
function localizedPreparationStageLabel(stage: string | null | undefined) {
  if (!stage) return t("pages.complianceRuleSets.sourceAnalysis.notRecorded");
  const stageEntry = Object.entries(RULE_SET_PREPARATION_STAGES).find(
    ([, value]) => value === stage,
  );
  if (stageEntry)
    return t(`pages.complianceRuleSets.stages.${stageEntry[0]}` as MessageKey);
  const phaseEntry = Object.entries(CLAIM_PREPARATION_PHASES).find(
    ([, value]) => value === stage,
  );
  return phaseEntry
    ? t(`pages.preparationOps.stages.${phaseEntry[0]}` as MessageKey)
    : stage;
}

/**
 * Business purpose: Present Admin Preparation history and the selected run's safe observability and source-review views.
 *
 * Business rules:
 * - The selected run controls the revision-pinned Source Analysis Explorer and Generated Rule Set Catalog; lifecycle actions remain bound to their original run IDs.
 * - A succeeded run with neither a persisted draft nor a Rule Set Version is labeled as historical success without an artifact, not as an Assessment-ready result.
 * - Page navigation changes only which read surface is presented; activity remains subscribed at the selected-run level and the draft remains a bounded preview.
 *
 * Execution flow:
 * 1. Select the preferred or explicitly selected Preparation run.
 * 2. Keep the run overview and lifecycle actions visible above navigation for Source Analysis, Catalog, and Run Activity.
 *
 * Failure cases:
 * - Empty history renders the existing empty state; action failures remain visible without changing run status locally.
 *
 * Side effects:
 * - Subscribes to run activity and existing retry, resume, and cancellation mutations; Source Analysis itself is read-only.
 */
export function RuleSetPreparationList({
  preparations,
  availability,
  ruleSets,
}: RuleSetPreparationListProps) {
  useAppLocale();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<PreparationSection>(
    PREPARATION_SECTIONS[0],
  );
  const sectionTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const preferred =
    preparations.find(
      (run) => run.executionState === AGENT_EXECUTION_STATES.RUNNING,
    ) ??
    preparations.find(
      (run) => run.executionState === AGENT_EXECUTION_STATES.QUEUED,
    ) ??
    preparations[0];
  const activeRunId = preparations.some(
    (run) => run.preparationRunId === selectedRunId,
  )
    ? selectedRunId
    : (preferred?.preparationRunId ?? null);
  const retry = useRetryRuleSetPreparationMutation();
  const cancel = useCancelRuleSetPreparationMutation();
  const resume = useResumeRuleSetPreparationMutation();
  const [confirmRunId, setConfirmRunId] = useState<string | null>(null);
  const selectedRun = preparations.find(
    (run) => run.preparationRunId === activeRunId,
  );
  const terminal =
    selectedRun !== undefined &&
    selectedRun.executionState !== AGENT_EXECUTION_STATES.RUNNING &&
    selectedRun.executionState !== AGENT_EXECUTION_STATES.QUEUED;
  const activity = useRuleSetPreparationActivity(activeRunId, terminal);
  const sourceUnits = usePreparationSourceUnitsQuery(
    activeSection === "run-activity" ? activeRunId : null,
    selectedRun?.sourceAnalysisInventoryRevision ?? null,
    {},
  );
  const sectionLabelKeys: Record<PreparationSection, MessageKey> = {
    "source-analysis":
      "pages.complianceRuleSets.sourceAnalysis.sections.sourceAnalysis",
    "generated-catalog":
      "pages.complianceRuleSets.sourceAnalysis.sections.generatedCatalog",
    "run-activity":
      "pages.complianceRuleSets.sourceAnalysis.sections.runActivity",
  };
  const activityProps = selectedRun
    ? {
        events: activity.events,
        frontierCoverage: sourceUnits.data?.pages[0]?.frontier.coverage ?? null,
        frontierCoverageError: sourceUnits.isError,
        frontierCoverageLoading: sourceUnits.isPending,
        connected: activity.connected,
        terminal,
        executionState: selectedRun.executionState,
        runStatusLabel: canonicalExecutionLabel(selectedRun.executionState),
        preparationRunId: selectedRun.preparationRunId,
        hasOlder: Boolean(activity.history.hasNextPage),
        historyError: activity.history.isError,
        historyLoading: activity.history.isPending,
        loadingOlder: activity.history.isFetchingNextPage,
        onLoadOlder: () => {
          if (activity.history.isError) void activity.history.refetch();
          else void activity.history.fetchNextPage();
        },
        directDraft:
          selectedRun.executionContract ===
          PREPARATION_EXECUTION_CONTRACTS.DIRECT_DRAFT_V1,
      }
    : null;
  function selectSectionAt(index: number) {
    const boundedIndex =
      (index + PREPARATION_SECTIONS.length) % PREPARATION_SECTIONS.length;
    setActiveSection(PREPARATION_SECTIONS[boundedIndex]);
    sectionTabRefs.current[boundedIndex]?.focus();
  }
  const activeRuleSet = ruleSets.find(
    (ruleSet) =>
      ruleSet.ruleSetVersionId === availability.activeRuleSetVersionId,
  );
  if (preparations.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("pages.complianceRuleSets.emptyPreparations")}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">
        {t("pages.complianceRuleSets.preparations")}
      </h3>
      <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
        {preparations.map((run) => (
          <li
            key={run.preparationRunId}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3"
            data-preparation-state={run.executionState}
          >
            <button
              type="button"
              className="flex min-w-48 flex-1 flex-col items-start gap-0.5 text-left"
              aria-pressed={activeRunId === run.preparationRunId}
              onClick={() => setSelectedRunId(run.preparationRunId)}
            >
              <span className="text-sm font-medium">
                {run.legalSourceVersion}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("pages.complianceRuleSets.attempt")} {run.attempt} ·{" "}
                {formatLocaleTimestamp(run.createdAt)} ·{" "}
                {run.requestedBy === RULE_SET_PREPARATION_SYSTEM_ACTOR
                  ? t("pages.complianceRuleSets.system")
                  : run.requestedBy}
              </span>
            </button>
            <div className="flex flex-col gap-0.5 text-sm">
              <span>{canonicalExecutionLabel(run.executionState)}</span>
              {run.failureReason ? (
                <span className="text-xs text-destructive">
                  {t(
                    `pages.complianceRuleSets.failureReasons.${run.failureReason}`,
                  )}
                </span>
              ) : null}
            </div>
            {run.resumable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  resume.isPending || cancel.isPending || retry.isPending
                }
                onClick={() => resume.mutate(run.preparationRunId)}
              >
                {t(
                  resume.isPending
                    ? "pages.complianceRuleSets.resuming"
                    : "pages.complianceRuleSets.resume",
                )}
              </Button>
            ) : null}
            {!run.resumable &&
            run.retryable &&
            run.executionState === AGENT_EXECUTION_STATES.FAILED ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retry.isPending || cancel.isPending}
                onClick={() => retry.mutate(run.preparationRunId)}
              >
                {t(
                  retry.isPending
                    ? "pages.complianceRuleSets.retrying"
                    : "pages.complianceRuleSets.retry",
                )}
              </Button>
            ) : null}
            {run.executionState === AGENT_EXECUTION_STATES.QUEUED ||
            run.executionState === AGENT_EXECUTION_STATES.RUNNING ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancel.isPending || retry.isPending}
                aria-busy={
                  cancel.isPending && cancel.variables === run.preparationRunId
                }
                onClick={() => setConfirmRunId(run.preparationRunId)}
              >
                {t(
                  cancel.isPending && cancel.variables === run.preparationRunId
                    ? "pages.complianceRuleSets.cancelling"
                    : "pages.complianceRuleSets.cancelPreparation",
                )}
              </Button>
            ) : null}
            {run.executionState === AGENT_EXECUTION_STATES.QUEUED ||
            run.executionState === AGENT_EXECUTION_STATES.RUNNING ? (
              activeRuleSet ? (
                <p className="w-full text-xs text-muted-foreground">
                  {t("pages.complianceRuleSets.replacingActiveVersion")}{" "}
                  <span className="font-medium">{activeRuleSet.version}</span>.{" "}
                  {t("pages.complianceRuleSets.activeVersionRemainsInUse")}
                </p>
              ) : null
            ) : run.retryable && activeRuleSet ? (
              <p className="w-full text-xs text-muted-foreground">
                {t("pages.complianceRuleSets.activeVersionRemainsInUse")}
              </p>
            ) : null}
            {run.executionState === AGENT_EXECUTION_STATES.SUCCEEDED &&
            run.ruleSetVersionId ? (
              <Link
                className="text-sm font-medium text-primary underline underline-offset-4"
                href={`/admin/compliance-rule-sets/${run.ruleSetVersionId}`}
              >
                {t("pages.complianceRuleSets.viewResult")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {selectedRun ? (
        <>
          <section className="min-w-0 space-y-3 rounded-lg border border-border p-4">
            <h3 className="font-semibold">
              {t("pages.complianceRuleSets.sourceAnalysis.runOverviewTitle")}
            </h3>
            <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {t(
                    "pages.complianceRuleSets.sourceAnalysis.sourceVersionLabel",
                  )}
                </dt>
                <dd className="wrap-break-word font-medium">
                  {selectedRun.legalSourceVersion}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {t("pages.complianceRuleSets.sourceAnalysis.runStatus")}
                </dt>
                <dd className="wrap-break-word font-medium">
                  {canonicalExecutionLabel(selectedRun.executionState)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {t("pages.complianceRuleSets.sourceAnalysis.currentStage")}
                </dt>
                <dd className="wrap-break-word">
                  {localizedPreparationStageLabel(
                    selectedRun.draft?.stage ?? selectedRun.claimPhase,
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {t(
                    "pages.complianceRuleSets.sourceAnalysis.inventoryRevision",
                  )}
                </dt>
                <dd>
                  {selectedRun.sourceAnalysisInventoryRevision ??
                    t("pages.complianceRuleSets.sourceAnalysis.notRecorded")}
                </dd>
              </div>
            </dl>
            {selectedRun.executionState === AGENT_EXECUTION_STATES.SUCCEEDED &&
            selectedRun.persistedDraftAvailable === false &&
            selectedRun.ruleSetVersionId === null ? (
              <p
                className="text-sm text-amber-700 dark:text-amber-300"
                role="status"
              >
                {t(
                  "pages.complianceRuleSets.draft.historicalSuccessWithoutArtifact",
                )}
              </p>
            ) : null}
            {selectedRun.executionState === AGENT_EXECUTION_STATES.RUNNING ||
            selectedRun.executionState === AGENT_EXECUTION_STATES.QUEUED ? (
              <p role="status" className="text-xs text-muted-foreground">
                {t(
                  activity.connected
                    ? "pages.complianceRuleSets.activity.streamConnected"
                    : "pages.complianceRuleSets.activity.streamReconnecting",
                )}
              </p>
            ) : null}
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t("pages.complianceRuleSets.sourceAnalysis.runIdentity")}
              </summary>
              <code className="mt-2 block break-all text-xs text-muted-foreground">
                {selectedRun.preparationRunId}
              </code>
            </details>
          </section>
          <div
            role="tablist"
            aria-label={t(
              "pages.complianceRuleSets.sourceAnalysis.sectionsLabel",
            )}
            className="grid w-full grid-cols-1 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-3"
          >
            {PREPARATION_SECTIONS.map((section, index) => (
              <button
                key={section}
                ref={(element) => {
                  sectionTabRefs.current[index] = element;
                }}
                id={`preparation-section-tab-${section}`}
                type="button"
                role="tab"
                aria-selected={activeSection === section}
                aria-controls={`preparation-section-panel-${section}`}
                tabIndex={activeSection === section ? 0 : -1}
                onClick={() => setActiveSection(section)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    selectSectionAt(index + 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    selectSectionAt(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    selectSectionAt(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    selectSectionAt(PREPARATION_SECTIONS.length - 1);
                  }
                }}
                className={`min-w-0 rounded-md px-3 py-2 text-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${
                  activeSection === section
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(sectionLabelKeys[section])}
              </button>
            ))}
          </div>
          {PREPARATION_SECTIONS.map((section) => (
            <div
              key={section}
              id={`preparation-section-panel-${section}`}
              role="tabpanel"
              aria-labelledby={`preparation-section-tab-${section}`}
              tabIndex={activeSection === section ? 0 : -1}
              hidden={activeSection !== section}
              className="min-w-0 outline-none"
            >
              {activeSection === section &&
              section === "source-analysis" &&
              activityProps ? (
                <PreparationSourceAnalysisExplorer
                  key={`${selectedRun.preparationRunId}:${selectedRun.sourceAnalysisInventoryRevision ?? "unavailable"}`}
                  run={selectedRun}
                  activity={activityProps}
                  onOpenRunActivity={() => setActiveSection("run-activity")}
                />
              ) : null}
              {activeSection === section && section === "generated-catalog" ? (
                <div className="space-y-4">
                  <PreparationGeneratedCatalog
                    key={`${selectedRun.preparationRunId}:${selectedRun.sourceAnalysisInventoryRevision ?? "unavailable"}`}
                    run={selectedRun}
                  />
                  {selectedRun.draft ? (
                    <details className="rounded-lg border border-border px-4 py-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.draftPreviewNote",
                        )}
                      </summary>
                      <div className="pt-3">
                        <RuleSetPreparationDraft
                          draft={selectedRun.draft}
                          coverageAvailable={
                            selectedRun.persistedCoverageAvailable
                          }
                          draftAvailable={selectedRun.persistedDraftAvailable}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {activeSection === section &&
              section === "run-activity" &&
              activityProps ? (
                <div className="space-y-4">
                  <RuleSetPreparationActivity
                    key={`${selectedRun.preparationRunId}:${selectedRun.sourceAnalysisInventoryRevision ?? "unavailable"}`}
                    {...activityProps}
                  />
                  <details className="rounded-lg border border-border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      {t("pages.complianceRuleSets.activity.technicalDetails")}
                    </summary>
                    <div className="pt-3">
                      <PreparationObservability
                        run={selectedRun}
                        events={activity.events}
                      />
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
      {resume.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("pages.complianceRuleSets.resumeFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      {retry.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("pages.complianceRuleSets.retryFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      {cancel.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("pages.complianceRuleSets.cancelFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={confirmRunId !== null}
        onOpenChange={(open) => {
          if (!open && !cancel.isPending) setConfirmRunId(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader className="flex-col">
            <DialogTitle>
              {t("pages.complianceRuleSets.confirmCancelTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.complianceRuleSets.confirmCancelDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end pt-5">
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => setConfirmRunId(null)}
            >
              {t("pages.complianceRuleSets.keepRunning")}
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending || confirmRunId === null}
              onClick={() => {
                if (confirmRunId === null) return;
                const runId = confirmRunId;
                setConfirmRunId(null);
                cancel.mutate(runId);
              }}
            >
              {t(
                cancel.isPending
                  ? "pages.complianceRuleSets.cancelling"
                  : "pages.complianceRuleSets.confirmCancel",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

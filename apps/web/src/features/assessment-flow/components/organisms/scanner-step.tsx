import { resolveMessage } from "@lcsp/i18n";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AgentMessage,
  AgentTurn,
  ThinkingLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { appLocale } from "@/lib/locale";

import { ProgramEvidenceSummary } from "@/features/workspace/components/molecules/program-evidence-summary";
import type { ProgramEvidenceGraphOverview } from "@/lib/api/evidence-graph-detail-client";
import type {
  ProgramEvidenceSummary as ProgramEvidenceSummaryType,
  RepositoryHistory,
  ScannerActivityItem,
} from "../../types/assessment-flow.types";
import { RepositoryConnectionResult } from "../molecules/repository-connection-result";
import { ScannerActivitySequence } from "../molecules/scanner-activity-sequence";

type ScannerStepProps = {
  assessmentId: string;
  repository: RepositoryHistory;
  activities: ScannerActivityItem[];
  evidenceReady: boolean;
  graphReady?: boolean;
  /** "Thinking..." while scanning, then the measured "Thought for N seconds". */
  thinkingLabel?: string;
  programEvidenceSummary: ProgramEvidenceSummaryType;
  canonicalOverview?: ProgramEvidenceGraphOverview | null;
  scanFailed?: boolean;
  isQueued?: boolean;
  retryScanPending?: boolean;
  retryScanError?: boolean;
  retryScanDisabled?: boolean;
  isReconnecting?: boolean;
  onRetryScan?: () => void;
};

export function ScannerStep({
  assessmentId,
  repository,
  activities,
  evidenceReady,
  graphReady = false,
  thinkingLabel,
  programEvidenceSummary,
  canonicalOverview,
  scanFailed = false,
  isQueued = false,
  retryScanPending = false,
  retryScanError = false,
  retryScanDisabled = false,
  isReconnecting = false,
  onRetryScan,
}: ScannerStepProps) {
  const canRetryScan = scanFailed && onRetryScan;

  return (
    <>
      <AgentTurn>
        <AgentMessage>
          <p>{t("pages.assessmentFlow.repository.connectedDescription")}</p>
        </AgentMessage>
        <RepositoryConnectionResult {...repository} />
      </AgentTurn>
      <AgentTurn>
        <ThinkingLine
          label={
            thinkingLabel ??
            (scanFailed
              ? t("pages.assessmentFlow.scanner.failedPlaceholder")
              : evidenceReady
                ? t("pages.assessmentFlow.thinking.completedWithoutDuration")
                : isQueued
                  ? t("pages.assessmentFlow.scanner.queuedThinking")
                  : t("pages.assessmentFlow.thinking.running"))
          }
        />
        <AgentMessage className="mt-2 text-muted-foreground">
          {scanFailed
            ? t("pages.assessmentFlow.scanner.failedPlaceholder")
            : evidenceReady
              ? t(graphReady
                  ? "pages.assessmentFlow.scanner.completeDescription"
                  : "pages.assessmentFlow.scanner.graphPendingDescription")
              : isQueued
                ? t("pages.assessmentFlow.scanner.queuedDescription")
                : t("pages.assessmentFlow.scanner.runningDescription")}
        </AgentMessage>
        {isReconnecting ? (
          <p
            className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400"
            role="status"
          >
            {t("pages.assessmentFlow.scanner.reconnecting")}
          </p>
        ) : null}
        <div className="mt-3">
          <ScannerActivitySequence activities={activities} />
        </div>
        {canRetryScan ? (
          <div className="mt-3 flex flex-col items-start gap-2">
            <Button
              disabled={retryScanDisabled}
              onClick={onRetryScan}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
              {retryScanPending
                ? t("pages.assessmentFlow.scanner.retryingScan")
                : t("pages.assessmentFlow.scanner.retryScan")}
            </Button>
            {retryScanError ? (
              <p className="text-xs text-destructive" role="alert">
                {t("pages.assessmentFlow.scanner.retryError")}
              </p>
            ) : null}
          </div>
        ) : null}
        {evidenceReady ? (
          graphReady ? (
            <ProgramEvidenceSummary
              className="mt-4"
              commitSha={repository.commitSha}
              summary={programEvidenceSummary}
              canonicalOverview={canonicalOverview}
              assessmentId={assessmentId}
            />
          ) : null
        ) : null}
      </AgentTurn>
    </>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

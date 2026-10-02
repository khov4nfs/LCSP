import { ASSESSMENT_GRAPH_STATES } from "@lcsp/contracts/assessment";
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
  repositories: RepositoryHistory[];
  relationCount?: number;
  graphState?: string;
  activities: ScannerActivityItem[];
  evidenceReady: boolean;
  /** "Thinking..." while scanning, then the measured "Thought for N seconds". */
  thinkingLabel?: string;
  programEvidenceSummary: ProgramEvidenceSummaryType;
  canonicalOverview?: ProgramEvidenceGraphOverview | null;
  scanFailed?: boolean;
  retryScanPending?: boolean;
  retryScanError?: boolean;
  retryScanDisabled?: boolean;
  onRetryScan?: () => void;
  onContinueToInterview?: () => void;
};

export function ScannerStep({
  assessmentId,
  repositories,
  relationCount = 0,
  graphState,
  activities,
  evidenceReady,
  thinkingLabel,
  programEvidenceSummary,
  canonicalOverview,
  scanFailed = false,
  retryScanPending = false,
  retryScanError = false,
  retryScanDisabled = false,
  onRetryScan,
  onContinueToInterview,
}: ScannerStepProps) {
  const canRetryScan = scanFailed && onRetryScan;

  return (
    <>
      <AgentTurn>
        <AgentMessage>
          <p>{t("pages.assessmentFlow.scanner.repositoriesDescription")}</p>
        </AgentMessage>
        <div className="space-y-2">
          {repositories.map((repository) => (
            <RepositoryConnectionResult
              key={`${repository.provider}:${repository.repositoryFullName}:${repository.commitSha}`}
              {...repository}
            />
          ))}
        </div>
      </AgentTurn>
      <AgentTurn>
        <ThinkingLine
          label={
            thinkingLabel ??
            (evidenceReady
              ? t("pages.assessmentFlow.thinking.completedWithoutDuration")
              : t("pages.assessmentFlow.thinking.running"))
          }
        />
        <AgentMessage className="mt-2 text-muted-foreground">
          {evidenceReady
            ? t("pages.assessmentFlow.scanner.completeDescription")
            : t("pages.assessmentFlow.scanner.runningDescription")}
        </AgentMessage>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <p>{t("pages.assessmentFlow.scanner.repositoriesStatus")}</p>
          <p>
            {t("pages.assessmentFlow.scanner.relationMappingStatus")}:{" "}
            {relationCount}
          </p>
          <p>
            {t("pages.assessmentFlow.scanner.pgeStatus")}:{" "}
            {graphState ?? ASSESSMENT_GRAPH_STATES.notReady}
          </p>
        </div>
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
          <ProgramEvidenceSummary
            className="mt-4"
            commitSha={repositories[0]?.commitSha ?? ""}
            summary={programEvidenceSummary}
            canonicalOverview={canonicalOverview}
            assessmentId={assessmentId}
            onContinueToInterview={onContinueToInterview}
          />
        ) : null}
      </AgentTurn>
    </>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

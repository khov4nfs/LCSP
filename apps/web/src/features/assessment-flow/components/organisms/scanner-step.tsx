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
  programEvidenceSummary: ProgramEvidenceSummaryType;
  canonicalOverview?: ProgramEvidenceGraphOverview | null;
  scanFailed?: boolean;
  retryScanPending?: boolean;
  retryScanError?: boolean;
  retryScanDisabled?: boolean;
  onRetryScan?: () => void;
};

export function ScannerStep({
  assessmentId,
  repository,
  activities,
  evidenceReady,
  programEvidenceSummary,
  canonicalOverview,
  scanFailed = false,
  retryScanPending = false,
  retryScanError = false,
  retryScanDisabled = false,
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
            evidenceReady
              ? t("pages.assessmentFlow.scanner.completeThinking")
              : t("pages.assessmentFlow.scanner.runningThinking")
          }
        />
        <AgentMessage className="mt-2 text-muted-foreground">
          {evidenceReady
            ? t("pages.assessmentFlow.scanner.completeDescription")
            : t("pages.assessmentFlow.scanner.runningDescription")}
        </AgentMessage>
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
            commitSha={repository.commitSha}
            summary={programEvidenceSummary}
            canonicalOverview={canonicalOverview}
            assessmentId={assessmentId}
          />
        ) : null}
      </AgentTurn>
    </>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

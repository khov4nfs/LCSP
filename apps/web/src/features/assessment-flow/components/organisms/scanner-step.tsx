import { resolveMessage } from "@lcsp/i18n";

import {
  AgentMessage,
  AgentTurn,
  ThinkingLine,
} from "@/features/workspace/components/molecules/agent-turn";
import { appLocale } from "@/lib/locale";

import type {
  ProgramEvidenceSummary,
  RepositoryHistory,
  ScannerActivityItem,
} from "../../types/assessment-flow.types";
import { ProgramEvidenceGraphSummary } from "../molecules/program-evidence-graph-summary";
import { RepositoryConnectionResult } from "../molecules/repository-connection-result";
import { ScannerActivitySequence } from "../molecules/scanner-activity-sequence";

type ScannerStepProps = {
  repository: RepositoryHistory;
  activities: ScannerActivityItem[];
  evidenceReady: boolean;
  programEvidenceSummary: ProgramEvidenceSummary;
};

export function ScannerStep({
  repository,
  activities,
  evidenceReady,
  programEvidenceSummary,
}: ScannerStepProps) {
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
        {evidenceReady ? (
          <ProgramEvidenceGraphSummary
            className="mt-4"
            commitSha={repository.commitSha}
            summary={programEvidenceSummary}
          />
        ) : null}
      </AgentTurn>
    </>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

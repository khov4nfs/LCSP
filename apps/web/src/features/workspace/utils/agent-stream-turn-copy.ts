import {
  ASSESSMENT_AGENT_STREAM_STAGES,
  type AssessmentAgentStreamStage,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

import type { AgentStreamRunOutcome } from "./agent-stream-projection";
import { AGENT_STREAM_RUN_OUTCOMES } from "./agent-stream-projection";

const ACTOR_KEYS: Record<AssessmentAgentStreamStage, string> = {
  [ASSESSMENT_AGENT_STREAM_STAGES.scanner]:
    "pages.appShell.agentStreamTurn.scannerActor",
  [ASSESSMENT_AGENT_STREAM_STAGES.interview]:
    "pages.appShell.agentStreamTurn.interviewActor",
  [ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis]:
    "pages.appShell.agentStreamTurn.ruleAnalysisActor",
  [ASSESSMENT_AGENT_STREAM_STAGES.gate]:
    "pages.appShell.agentStreamTurn.gateActor",
};

const MESSAGE_KEYS: Record<
  AssessmentAgentStreamStage,
  Record<Exclude<AgentStreamRunOutcome, "paused">, string>
> = {
  [ASSESSMENT_AGENT_STREAM_STAGES.scanner]: {
    running: "pages.appShell.agentStreamTurn.scannerRunning",
    completed: "pages.appShell.agentStreamTurn.scannerCompleted",
    failed: "pages.appShell.agentStreamTurn.scannerFailed",
  },
  [ASSESSMENT_AGENT_STREAM_STAGES.interview]: {
    running: "pages.appShell.agentStreamTurn.interviewRunning",
    completed: "pages.appShell.agentStreamTurn.interviewCompleted",
    failed: "pages.appShell.agentStreamTurn.interviewFailed",
  },
  [ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis]: {
    running: "pages.appShell.agentStreamTurn.investigateRunning",
    completed: "pages.appShell.agentStreamTurn.investigateCompleted",
    failed: "pages.appShell.agentStreamTurn.investigateFailed",
  },
  [ASSESSMENT_AGENT_STREAM_STAGES.gate]: {
    running: "pages.appShell.agentStreamTurn.gateRunning",
    completed: "pages.appShell.agentStreamTurn.gateCompleted",
    failed: "pages.appShell.agentStreamTurn.gateFailed",
  },
};

// A stage's own priority when picking ONE message for a multi-stage turn:
// the most-downstream stage present is the most informative one to lead with.
const STAGE_MESSAGE_PRIORITY: AssessmentAgentStreamStage[] = [
  ASSESSMENT_AGENT_STREAM_STAGES.gate,
  ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
  ASSESSMENT_AGENT_STREAM_STAGES.interview,
  ASSESSMENT_AGENT_STREAM_STAGES.scanner,
];

/**
 * One customer-facing headline (actor + one-line message) for an agent turn,
 * derived from every stage that one dispatch touched plus its run outcome.
 * Paused shares one
 * message across every stage, matching the existing cooperative-stop copy
 * already used for the raw timeline (pages.appShell.agentStreamActivities.boundaryPaused).
 */
export function buildAgentStreamTurnHeadline(
  stages: AssessmentAgentStreamStage[],
  outcome: AgentStreamRunOutcome,
): { actor: string; message: string } {
  const primaryStage =
    STAGE_MESSAGE_PRIORITY.find((stage) => stages.includes(stage)) ??
    stages[0] ??
    ASSESSMENT_AGENT_STREAM_STAGES.interview;
  const actor = t(ACTOR_KEYS[primaryStage]);
  const message =
    outcome === AGENT_STREAM_RUN_OUTCOMES.paused
      ? t("pages.appShell.agentStreamActivities.boundaryPaused")
      : t(MESSAGE_KEYS[primaryStage][outcome]);
  return { actor, message };
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

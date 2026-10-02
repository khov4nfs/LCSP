import { ASSESSMENT_AGENT_STREAM_STAGES } from "@lcsp/contracts/evidence";

import type { AgentStreamDispatchTurnsProps } from "../../types/agent-stream-dispatch-turns.types";
import {
  AGENT_STREAM_RUN_OUTCOMES,
  deriveAgentStreamRunOutcome,
} from "../../utils/agent-stream-projection";
import { splitAgentStreamActivityByStage } from "../../utils/agent-stream-stages";
import { AgentStreamTurn } from "./agent-stream-turn";

/**
 * One dispatch can run several stages back to back (Interview -> rule analysis). Each stage is its own agent turn: headline, thinking, output,
 * then its own Technical details.
 */
export function AgentStreamDispatchTurns({
  segment,
  outputs,
}: AgentStreamDispatchTurnsProps) {
  const turns = splitAgentStreamActivityByStage(segment);
  // Caller-owned results (an Interview answer's outcome) belong to the
  // Interview turn, else to the dispatch's first turn.
  const outputsIndex = Math.max(
    0,
    turns.findIndex(
      (turn) => turn.stage === ASSESSMENT_AGENT_STREAM_STAGES.interview,
    ),
  );
  const dispatchOutcome = deriveAgentStreamRunOutcome(segment.events);
  return turns.map((turn, index) => {
    const own = deriveAgentStreamRunOutcome(turn.events);
    // An earlier stage is done once a later one started; its boundary only
    // closes on the dispatch's final stage, so "running" here is stale.
    const outcome = turn.superseded
      ? own === AGENT_STREAM_RUN_OUTCOMES.running
        ? AGENT_STREAM_RUN_OUTCOMES.completed
        : own
      : dispatchOutcome;
    return (
      <AgentStreamTurn
        key={turn.turnKey}
        stages={turn.stages}
        runId={turn.runId}
        events={turn.events}
        stageEvents={turn.stageEvents}
        outcomeOverride={outcome}
        outputs={index === outputsIndex ? outputs : undefined}
      />
    );
  });
}

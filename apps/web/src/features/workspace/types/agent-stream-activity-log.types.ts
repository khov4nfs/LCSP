import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";
import type { StreamRowUsage } from "./agent-stream-usage.types";

import type {
  AgentStreamRunOutcome,
  StreamActivityKey,
  StreamRowKind,
  StreamRowStatus,
} from "../utils/agent-stream-projection";

/** One activity kind, aggregated: a stable row whose count and latest value
 *  update in place as the stream progresses, instead of one row per event. */
export type AgentStreamActivityLogRow = {
  key: string;
  label: string;
  /** What the latest event of this kind acts on (file, query), if any. */
  target: string | null;
  count: number;
  status: StreamRowStatus;
  failed: boolean;
  kind: StreamRowKind;
  activity: StreamActivityKey | null;
  usage?: StreamRowUsage;
  sharedUsage?: boolean;
};

export type AgentStreamActivityLogProps = {
  events: AssessmentAgentStreamEvent[];
  outcomeOverride?: AgentStreamRunOutcome;
};

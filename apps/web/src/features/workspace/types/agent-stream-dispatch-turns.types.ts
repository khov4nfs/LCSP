import type { ReactNode } from "react";

import type { AgentStreamGroupedActivity } from "../utils/agent-stream-stages";

export type AgentStreamDispatchTurnsProps = {
  segment: AgentStreamGroupedActivity;
  /** Rendered in the Interview turn (else the first) above Technical details. */
  outputs?: ReactNode;
};

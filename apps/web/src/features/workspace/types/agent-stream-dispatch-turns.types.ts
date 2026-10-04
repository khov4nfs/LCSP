import type { ReactNode } from "react";

import type { AgentStreamGroupedActivity } from "../utils/agent-stream-stages";
import type { AssessmentComposerRuntimeControl } from "./assessment-composer.types";

export type AgentStreamDispatchTurnsProps = {
  segment: AgentStreamGroupedActivity;
  runtimeControl?: AssessmentComposerRuntimeControl;
  /** Rendered in the Interview turn (else the first) above Technical details. */
  outputs?: ReactNode;
};

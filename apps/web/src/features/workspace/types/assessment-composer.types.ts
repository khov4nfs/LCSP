import type { AssessmentRuntimeControlState } from "@lcsp/contracts/evidence";

export type AssessmentComposerRuntimeControl = {
  state: AssessmentRuntimeControlState | null;
  targetRunId?: string;
};

export type AssessmentComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onResume?: () => void;
  placeholder?: string;
  sendLabel?: string;
  resumeLabel?: string;
  disabled?: boolean;
  submitting?: boolean;
  resuming?: boolean;
  submitReady?: boolean;
  resumeAvailable?: boolean;
  className?: string;
  turnRunning?: boolean;
  turnPaused?: boolean;
  onInterruptTurn?: () => void;
  onResumeTurn?: () => void;
  interruptingTurn?: boolean;
  resumingTurn?: boolean;
  runtimeControlState?: AssessmentRuntimeControlState | null;
};

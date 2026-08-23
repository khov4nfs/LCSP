import type { ReactNode } from "react";

import type { WizardHelperKey } from "./wizard-form.types";
import type { WizardAnswers } from "./wizard.types";
import type { WizardAgentClarificationPrompt } from "../lib/wizard-agent-clarification";

export type WizardActiveStepCardProps = {
  currentStep: number;
  effectiveIsReadOnly: boolean;
  answers: WizardAnswers;
  agentClarificationPrompts?: WizardAgentClarificationPrompt[];
  isAskingClarification?: boolean;
  canApproveAgentClarifications?: boolean;
  canAskDeepResearch?: boolean;
  onFieldBlur: () => void;
  onFieldChange: (name: keyof WizardAnswers) => void;
  onHelperOpen: (helperKey: Exclude<WizardHelperKey, null>) => void;
  onApproveAgentClarifications?: () => void;
};

export type WizardFieldWithHelperProps = {
  children: ReactNode;
  onHelperClick: () => void;
};

export type WizardHelperButtonProps = {
  onClick: () => void;
};

export type WizardReadOnlySummaryProps = {
  answers: WizardAnswers;
  onBack: () => void;
  onNext: () => void;
};

export type WizardProgressSidebarProps = {
  assessmentName: string | null;
  answers: WizardAnswers;
  currentStep: number;
  effectiveIsReadOnly: boolean;
  effectiveStatusKey: string | null;
  isDraftComplete: boolean;
  onSetCurrentStep: (step: number) => void;
  onClearForm: () => void;
};

export type WizardFormPageProps = {
  assessmentId: string;
};

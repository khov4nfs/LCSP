import type { WizardStatusCode } from "@lcsp/contracts/assessment";
import type { WizardClarificationAgentQuestion } from "@lcsp/contracts/wizard";

import { API_OUTCOME_KINDS } from "../../../lib/api/outcome-kinds.ts";

export type WizardAnswers = {
  ps_001_ai_scope?: string;
  ps_002_affected_people?: string[];
  ps_003_personal_or_sensitive_data?: string;
  ps_004_decision_importance?: string;
  businessProcess?: string;
  useCase?: string;
  primaryActors?: string;
  businessTrigger?: string;
  expectedOutcome?: string;
  aiPurpose?: string;
  autonomyLevel?: string;
  sector?: string;
  dataTypes?: string[];
  affectedSubjects?: string[];
  userImpact?: string;
  decisionRole?: string;
  humanReview?: string;
  externalLlmUsage?: string;
  specialCategoryData?: string;
  biometricData?: string;
  highImpactIndicators?: string[];
  transparencyIndicators?: string[];
  prohibitedRiskSignals?: string[];
  deploymentContext?: string[];
  postGraphContext?: string;
  postGraphRuleScope?: string;
  postGraphHumanReviewBoundary?: string;
};

export type WizardStatus = WizardStatusCode | (string & {});

export type WizardAssessment = {
  assessmentId: string;
  name: string;
  wizardStatus: WizardStatus;
};

export type WizardPageOutcome =
  | { kind: typeof API_OUTCOME_KINDS.loaded; assessment: WizardAssessment }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: string;
      detailKey: string;
    };

export type WizardSaveOutcome =
  | { kind: typeof API_OUTCOME_KINDS.saved; savedAt: string | null }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | { kind: typeof API_OUTCOME_KINDS.alreadySubmitted }
  | { kind: typeof API_OUTCOME_KINDS.error; detailKey: string };

export type WizardSubmitOutcome =
  | { kind: typeof API_OUTCOME_KINDS.submitted }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | { kind: typeof API_OUTCOME_KINDS.alreadySubmitted }
  | { kind: typeof API_OUTCOME_KINDS.error; detailKey: string };

export type WizardClarificationAskOutcome =
  | {
      kind: typeof API_OUTCOME_KINDS.loaded;
      questions: WizardClarificationAgentQuestion[];
    }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | { kind: typeof API_OUTCOME_KINDS.error; detailKey: string };

import type { MessageKey } from "@lcsp/i18n";

import {
  CLASSIFICATION_ASSESSMENT_OUTCOMES,
  CLASSIFICATION_EVIDENCE_QUALITIES,
  CLASSIFICATION_EXECUTION_STATES,
  type ClassificationAssessmentOutcome,
  type ClassificationEvidenceQuality,
  type ClassificationExecutionState,
} from "@/lib/api/classification-client";

/** UI-only visual tones; deliberately distinct from any domain status value. */
export const CLASSIFICATION_RESULT_TONES = {
  neutral: "TONE_NEUTRAL",
  success: "TONE_POSITIVE",
  warning: "TONE_CAUTION",
  destructive: "TONE_CRITICAL",
} as const;

export type ClassificationResultTone =
  (typeof CLASSIFICATION_RESULT_TONES)[keyof typeof CLASSIFICATION_RESULT_TONES];

type ResultPresentation = { labelKey: MessageKey; tone: ClassificationResultTone };

/**
 * Execution never uses success styling: a completed run (or guardrail PASSED) is not a
 * compliance conclusion. Only a COMPLIANT assessment outcome may render as success.
 */
export const EXECUTION_STATE_PRESENTATION: Record<
  ClassificationExecutionState,
  ResultPresentation
> = {
  [CLASSIFICATION_EXECUTION_STATES.queued]: {
    labelKey: "pages.classification.executionStates.queued",
    tone: CLASSIFICATION_RESULT_TONES.neutral,
  },
  [CLASSIFICATION_EXECUTION_STATES.running]: {
    labelKey: "pages.classification.executionStates.running",
    tone: CLASSIFICATION_RESULT_TONES.neutral,
  },
  [CLASSIFICATION_EXECUTION_STATES.completed]: {
    labelKey: "pages.classification.executionStates.completed",
    tone: CLASSIFICATION_RESULT_TONES.neutral,
  },
  [CLASSIFICATION_EXECUTION_STATES.failed]: {
    labelKey: "pages.classification.executionStates.failed",
    tone: CLASSIFICATION_RESULT_TONES.destructive,
  },
  [CLASSIFICATION_EXECUTION_STATES.blocked]: {
    labelKey: "pages.classification.executionStates.blocked",
    tone: CLASSIFICATION_RESULT_TONES.warning,
  },
  [CLASSIFICATION_EXECUTION_STATES.skipped]: {
    labelKey: "pages.classification.executionStates.skipped",
    tone: CLASSIFICATION_RESULT_TONES.neutral,
  },
};

export const ASSESSMENT_OUTCOME_PRESENTATION: Record<
  ClassificationAssessmentOutcome,
  ResultPresentation
> = {
  [CLASSIFICATION_ASSESSMENT_OUTCOMES.compliant]: {
    labelKey: "pages.classification.assessmentOutcomes.compliant",
    tone: CLASSIFICATION_RESULT_TONES.success,
  },
  [CLASSIFICATION_ASSESSMENT_OUTCOMES.nonCompliant]: {
    labelKey: "pages.classification.assessmentOutcomes.nonCompliant",
    tone: CLASSIFICATION_RESULT_TONES.destructive,
  },
  [CLASSIFICATION_ASSESSMENT_OUTCOMES.unknown]: {
    labelKey: "pages.classification.assessmentOutcomes.unknown",
    tone: CLASSIFICATION_RESULT_TONES.warning,
  },
  [CLASSIFICATION_ASSESSMENT_OUTCOMES.notApplicable]: {
    labelKey: "pages.classification.assessmentOutcomes.notApplicable",
    tone: CLASSIFICATION_RESULT_TONES.neutral,
  },
};

export const EVIDENCE_QUALITY_PRESENTATION: Record<
  ClassificationEvidenceQuality,
  ResultPresentation
> = {
  [CLASSIFICATION_EVIDENCE_QUALITIES.evidenceBacked]: {
    labelKey: "pages.classification.evidenceQualities.evidenceBacked",
    tone: CLASSIFICATION_RESULT_TONES.neutral,
  },
  [CLASSIFICATION_EVIDENCE_QUALITIES.limitedEvidence]: {
    labelKey: "pages.classification.evidenceQualities.limitedEvidence",
    tone: CLASSIFICATION_RESULT_TONES.warning,
  },
  [CLASSIFICATION_EVIDENCE_QUALITIES.noValidatedEvidence]: {
    labelKey: "pages.classification.evidenceQualities.noValidatedEvidence",
    tone: CLASSIFICATION_RESULT_TONES.warning,
  },
  [CLASSIFICATION_EVIDENCE_QUALITIES.coverageLimited]: {
    labelKey: "pages.classification.evidenceQualities.coverageLimited",
    tone: CLASSIFICATION_RESULT_TONES.warning,
  },
};

export const UNAVAILABLE_RESULT_PRESENTATION: ResultPresentation = {
  labelKey: "pages.classification.resultUnavailable",
  tone: CLASSIFICATION_RESULT_TONES.neutral,
};

export const UNAVAILABLE_EVIDENCE_PRESENTATION: ResultPresentation = {
  labelKey: "pages.classification.evidenceUnavailable",
  tone: CLASSIFICATION_RESULT_TONES.neutral,
};

export const CLASSIFICATION_RESULT_TONE_CLASS_NAMES: Record<
  ClassificationResultTone,
  string
> = {
  [CLASSIFICATION_RESULT_TONES.neutral]: "border-border bg-background text-foreground",
  [CLASSIFICATION_RESULT_TONES.success]:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  [CLASSIFICATION_RESULT_TONES.warning]:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  [CLASSIFICATION_RESULT_TONES.destructive]:
    "border-destructive/30 bg-destructive/10 text-destructive",
};

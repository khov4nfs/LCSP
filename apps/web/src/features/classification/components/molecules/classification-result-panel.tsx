import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import {
  ASSESSMENT_OUTCOME_PRESENTATION,
  CLASSIFICATION_RESULT_TONE_CLASS_NAMES,
  EVIDENCE_QUALITY_PRESENTATION,
  EXECUTION_STATE_PRESENTATION,
  UNAVAILABLE_EVIDENCE_PRESENTATION,
  UNAVAILABLE_RESULT_PRESENTATION,
  type ClassificationResultTone,
} from "../../config/classification-result-presentation";
import type { ClassificationResultPanelProps } from "../../types/component-props.types";

/** Renders run execution, assessment verdict, and evidence quality as separate facts. */
export function ClassificationResultPanel({
  executionState,
  assessmentOutcome,
  evidenceQuality,
}: ClassificationResultPanelProps) {
  const execution = EXECUTION_STATE_PRESENTATION[executionState];
  const outcome = assessmentOutcome
    ? ASSESSMENT_OUTCOME_PRESENTATION[assessmentOutcome]
    : UNAVAILABLE_RESULT_PRESENTATION;
  const evidence = evidenceQuality
    ? EVIDENCE_QUALITY_PRESENTATION[evidenceQuality]
    : UNAVAILABLE_EVIDENCE_PRESENTATION;

  return (
    <section
      data-slot="classification-result-panel"
      className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-3"
    >
      <ClassificationResultDatum
        slot="execution"
        labelKey="pages.classification.executionLabel"
        valueKey={execution.labelKey}
        tone={execution.tone}
      />
      <ClassificationResultDatum
        slot="assessment-outcome"
        labelKey="pages.classification.resultLabel"
        valueKey={outcome.labelKey}
        tone={outcome.tone}
      />
      <ClassificationResultDatum
        slot="evidence-quality"
        labelKey="pages.classification.evidenceLabel"
        valueKey={evidence.labelKey}
        tone={evidence.tone}
      />
    </section>
  );
}

function ClassificationResultDatum({
  slot,
  labelKey,
  valueKey,
  tone,
}: {
  slot: string;
  labelKey: MessageKey;
  valueKey: MessageKey;
  tone: ClassificationResultTone;
}) {
  return (
    <div
      data-slot={slot}
      data-tone={tone}
      className={cn(
        "rounded-md border px-3 py-2",
        CLASSIFICATION_RESULT_TONE_CLASS_NAMES[tone],
      )}
    >
      <p className="text-xs text-muted-foreground">
        {resolveMessage(appLocale, labelKey)}
      </p>
      <p className="mt-1 text-sm font-semibold">
        {resolveMessage(appLocale, valueKey)}
      </p>
    </div>
  );
}

import { resolveMessage } from "@lcsp/i18n";

import type { WorkspaceRuntimeActivityItem } from "@/features/workspace/types/workspace-runtime.types";
import type { ProgramEvidenceGraphOverview } from "@/lib/api/evidence-graph-detail-client";
import { appLocale } from "@/lib/locale";

import type {
  ProgramEvidenceMetric,
  ProgramEvidenceSummary,
} from "../types/assessment-flow.types";
import {
  PROGRAM_EVIDENCE_METRIC_FORMATS,
  PROGRAM_EVIDENCE_UNAVAILABLE_REASONS,
} from "../types/assessment-flow.types";

export const PROGRAM_EVIDENCE_OVERVIEW_FORMATS = {
  modulesAnalyzed: PROGRAM_EVIDENCE_METRIC_FORMATS.count,
  codeSymbolsIndexed: PROGRAM_EVIDENCE_METRIC_FORMATS.count,
  aiModelInvocations: PROGRAM_EVIDENCE_METRIC_FORMATS.count,
  evidenceMappedScope: PROGRAM_EVIDENCE_METRIC_FORMATS.percent,
} as const;

export function deriveProgramEvidenceSummary(input: {
  recentActivity?: WorkspaceRuntimeActivityItem[];
  canonicalOverview?: ProgramEvidenceGraphOverview | null;
}): ProgramEvidenceSummary {
  void input.recentActivity;
  const overview = input.canonicalOverview ?? null;
  return {
    modulesAnalyzed: metricFromCanonical(
      overview?.modules_analyzed ?? null,
      PROGRAM_EVIDENCE_OVERVIEW_FORMATS.modulesAnalyzed,
    ),
    codeSymbolsIndexed: metricFromCanonical(
      overview?.code_symbols_indexed ?? null,
      PROGRAM_EVIDENCE_OVERVIEW_FORMATS.codeSymbolsIndexed,
    ),
    aiModelInvocations: metricFromCanonical(
      overview?.ai_model_invocations ?? null,
      PROGRAM_EVIDENCE_OVERVIEW_FORMATS.aiModelInvocations,
    ),
    evidenceMappedScope: metricFromCanonical(
      overview?.evidence_mapped_scope ?? null,
      PROGRAM_EVIDENCE_OVERVIEW_FORMATS.evidenceMappedScope,
    ),
  };
}

function metricFromCanonical(
  value: number | null,
  format: ProgramEvidenceMetric["format"],
): ProgramEvidenceMetric {
  return value === null
    ? {
        value: null,
        format,
        unavailableReason:
          PROGRAM_EVIDENCE_UNAVAILABLE_REASONS.missingCanonicalMetric,
      }
    : { value, format };
}

export function formatProgramEvidenceMetric(metric: ProgramEvidenceMetric): string {
  if (metric.value == null) {
    return t("pages.assessmentFlow.graph.unavailableValue");
  }

  const rounded =
    metric.format === PROGRAM_EVIDENCE_METRIC_FORMATS.percent
      ? Math.round(metric.value)
      : metric.value;
  return metric.format === PROGRAM_EVIDENCE_METRIC_FORMATS.percent
    ? `${rounded}%`
    : rounded.toLocaleString();
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

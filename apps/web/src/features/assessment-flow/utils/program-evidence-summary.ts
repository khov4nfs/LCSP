import type { WorkspaceRuntimeActivityItem } from "@/features/workspace/types/workspace-runtime.types";

import type {
  ProgramEvidenceMetric,
  ProgramEvidenceSummary,
} from "../types/assessment-flow.types";
import {
  PROGRAM_EVIDENCE_METRIC_FORMATS,
  PROGRAM_EVIDENCE_UNAVAILABLE_REASONS,
} from "../types/assessment-flow.types";

const PGE_METRIC_SOURCES = {
  servicesScanned: [
    "servicesScanned",
    "serviceCount",
    "services_scanned",
    "service_count",
  ],
  codeSymbolsIndexed: [
    "codeSymbolsIndexed",
    "structuralFacts",
    "code_symbols_indexed",
    "structural_facts",
  ],
  aiProviderCallPaths: [
    "aiProviderCallPaths",
    "aiCallPaths",
    "technicalFindings",
    "ai_provider_call_paths",
    "ai_call_paths",
    "technical_findings",
  ],
  evidenceMappedScope: [
    "evidenceMappedScope",
    "evidenceMappedScopePercent",
    "evidenceMappedPercent",
    "mappedScopePercent",
    "evidenceCoveragePercent",
    "evidence_mapped_scope",
    "evidence_mapped_scope_percent",
    "evidence_mapped_percent",
    "mapped_scope_percent",
    "evidence_coverage_percent",
  ],
} as const;

type MetricKey = keyof typeof PGE_METRIC_SOURCES;

export function deriveProgramEvidenceSummary(input: {
  recentActivity?: WorkspaceRuntimeActivityItem[];
}): ProgramEvidenceSummary {
  const recentActivity = input.recentActivity ?? [];
  const summaries = recentActivity.flatMap((activity) => [
    activity.inputSummary,
    activity.outputSummary,
  ]);
  const graphBuildSummaries = recentActivity
    .filter((activity) => activity.toolName === "build_evidence_graph")
    .flatMap((activity) => [activity.inputSummary, activity.outputSummary]);

  return {
    servicesScanned: metricFromSummaries(
      summaries,
      "servicesScanned",
      PROGRAM_EVIDENCE_METRIC_FORMATS.count,
    ),
    codeSymbolsIndexed: metricFromSummaries(
      graphBuildSummaries,
      "codeSymbolsIndexed",
      PROGRAM_EVIDENCE_METRIC_FORMATS.count,
    ),
    aiProviderCallPaths: metricFromSummaries(
      graphBuildSummaries,
      "aiProviderCallPaths",
      PROGRAM_EVIDENCE_METRIC_FORMATS.count,
    ),
    evidenceMappedScope: metricFromSummaries(
      summaries,
      "evidenceMappedScope",
      PROGRAM_EVIDENCE_METRIC_FORMATS.percent,
    ),
  };
}

function metricFromSummaries(
  summaries: WorkspaceRuntimeActivityItem["inputSummary"][],
  key: MetricKey,
  format: ProgramEvidenceMetric["format"],
): ProgramEvidenceMetric {
  for (const summary of summaries) {
    const value = findNumericValue(summary, PGE_METRIC_SOURCES[key]);
    if (value !== null) {
      return { value, format };
    }
  }

  return {
    value: null,
    format,
    unavailableReason:
      PROGRAM_EVIDENCE_UNAVAILABLE_REASONS.missingCanonicalMetric,
  };
}

function findNumericValue(
  summary: WorkspaceRuntimeActivityItem["inputSummary"],
  keys: readonly string[],
): number | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return null;
  }

  const record = summary as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  for (const value of Object.values(record)) {
    const nested = findNumericValue(
      value as WorkspaceRuntimeActivityItem["inputSummary"],
      keys,
    );
    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

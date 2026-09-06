import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { ARTIFACT_TYPES, type ArtifactRef } from "@/features/artifacts/types/artifact.types";
import type { EngineeringRuleEvaluationViewModel } from "@/lib/api/classification-client";

import {
  ENGINEERING_RULE_EVALUATION_STATUSES,
  INVESTIGATION_TRACE_STATUSES,
  type EngineeringRuleEvaluationStatus,
  type EngineeringRuleFindingSource,
  type EngineeringRuleFindingViewModel,
  type EngineeringRuleFindingsViewModel,
  type FindingPriority,
  type InvestigationTraceStatus,
  type InvestigationTraceStep,
  type InvestigationTraceViewModel,
} from "../types/structured-results.types";

export function normalizeInvestigationTraceStatus(
  status: string | null | undefined,
): InvestigationTraceStatus {
  if (!status) return INVESTIGATION_TRACE_STATUSES.inProgress;
  const normalized = status.trim().toUpperCase();
  if (
    normalized === ASSESSMENT_RUNTIME_RUN_STATUSES.completed ||
    normalized === "PASSED" ||
    normalized === "DONE"
  ) {
    return INVESTIGATION_TRACE_STATUSES.completed;
  }
  if (normalized === ASSESSMENT_RUNTIME_RUN_STATUSES.failed || normalized === "ERROR") {
    return INVESTIGATION_TRACE_STATUSES.failed;
  }
  if (normalized === "PAUSED" || normalized === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting) {
    return INVESTIGATION_TRACE_STATUSES.paused;
  }
  return INVESTIGATION_TRACE_STATUSES.inProgress;
}

export type InvestigationTraceAdapterInput = {
  assessmentId: string;
  status?: string | null;
  steps?: InvestigationTraceStep[] | null;
  evidenceClaimCount?: number | null;
  summary?: string | null;
};

export function toInvestigationTraceViewModel(
  input: InvestigationTraceAdapterInput,
): InvestigationTraceViewModel {
  const steps: InvestigationTraceStep[] = Array.isArray(input.steps)
    ? input.steps.filter(
        (step): step is InvestigationTraceStep =>
          Boolean(step) &&
          typeof step.id === "string" &&
          typeof step.label === "string" &&
          step.label.trim().length > 0,
      )
    : [];

  const evidenceClaimCount =
    typeof input.evidenceClaimCount === "number" &&
    Number.isFinite(input.evidenceClaimCount) &&
    input.evidenceClaimCount >= 0
      ? input.evidenceClaimCount
      : null;

  const artifactRef: ArtifactRef = {
    assessmentId: input.assessmentId,
    type: ARTIFACT_TYPES.investigationNotes,
  };

  return {
    status: normalizeInvestigationTraceStatus(input.status),
    steps,
    evidenceClaimCount,
    summary: input.summary ?? null,
    artifactRef,
  };
}

export type EngineeringRuleFindingAdapterOptions = {
  assessmentId: string;
  priority?: FindingPriority | null;
};

export function toEngineeringRuleFindingViewModel(
  evaluation: EngineeringRuleEvaluationViewModel,
  options: EngineeringRuleFindingAdapterOptions,
): EngineeringRuleFindingViewModel {
  const primaryEvidence = evaluation.technicalEvidence.find(
    (ev) => ev.filePath !== null && ev.filePath.trim().length > 0,
  ) ?? evaluation.technicalEvidence[0];

  const source: EngineeringRuleFindingSource = {
    filePath: primaryEvidence?.filePath ?? null,
    startLine: primaryEvidence?.startLine ?? null,
    endLine: primaryEvidence?.endLine ?? null,
    symbolRef: primaryEvidence?.symbolRef ?? null,
    ruleId: evaluation.engineeringRuleId,
  };

  const status: EngineeringRuleEvaluationStatus =
    evaluation.status === "COMPLIANT"
      ? ENGINEERING_RULE_EVALUATION_STATUSES.compliant
      : evaluation.status === "NON_COMPLIANT"
        ? ENGINEERING_RULE_EVALUATION_STATUSES.nonCompliant
        : ENGINEERING_RULE_EVALUATION_STATUSES.unknown;

  const artifactRef: ArtifactRef = {
    assessmentId: options.assessmentId,
    type: ARTIFACT_TYPES.technicalEvidence,
    resourceId: evaluation.engineeringRuleId,
  };

  return {
    id: evaluation.engineeringRuleId,
    // Production authority invariant: do not derive High/Medium from NON_COMPLIANT/UNKNOWN
    priority: options.priority ?? null,
    status,
    issue: evaluation.concept,
    whyItMatters: evaluation.reason,
    source,
    artifactRef,
  };
}

export function toEngineeringRuleFindingsViewModel(
  evaluations: EngineeringRuleEvaluationViewModel[],
  options: {
    assessmentId: string;
    filterFindingsOnly?: boolean;
    prioritiesMap?: Record<string, FindingPriority>;
  },
): EngineeringRuleFindingsViewModel {
  const filterOnly = options.filterFindingsOnly ?? false;
  const filtered = filterOnly
    ? evaluations.filter((ev) => ev.status === "NON_COMPLIANT" || ev.status === "UNKNOWN")
    : evaluations;

  const findings = filtered.map((ev) =>
    toEngineeringRuleFindingViewModel(ev, {
      assessmentId: options.assessmentId,
      priority: options.prioritiesMap?.[ev.engineeringRuleId] ?? null,
    }),
  );

  const artifactRef: ArtifactRef = {
    assessmentId: options.assessmentId,
    type: ARTIFACT_TYPES.findingsReport,
  };

  return {
    findings,
    artifactRef,
  };
}

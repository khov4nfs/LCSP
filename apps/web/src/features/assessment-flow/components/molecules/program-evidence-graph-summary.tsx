import {
  ProgramEvidenceSummary,
  type ProgramEvidenceSummaryProps,
} from "@/features/workspace/components/molecules/program-evidence-summary";

export type ProgramEvidenceGraphSummaryProps = ProgramEvidenceSummaryProps;

/**
 * @deprecated Use `ProgramEvidenceSummary` from `@/features/workspace/components/molecules/program-evidence-summary` instead.
 * Retained for backwards-compatibility with existing consumers.
 */
export function ProgramEvidenceGraphSummary(
  props: ProgramEvidenceGraphSummaryProps,
) {
  return <ProgramEvidenceSummary {...props} />;
}

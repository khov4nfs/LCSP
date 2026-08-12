import type {
  RequestTargetedReanalysisInput as SharedRequestTargetedReanalysisInput,
  RequestTargetedReanalysisResponse,
} from "@lcsp/contracts/scan";

export interface RequestTargetedReanalysisInput extends SharedRequestTargetedReanalysisInput {
  assessmentId: string;
}

export type { RequestTargetedReanalysisResponse };

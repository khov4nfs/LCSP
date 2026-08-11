import type { TargetedReanalysisRequestState } from "@lcsp/contracts/scan";

export interface RequestTargetedReanalysisInput {
  assessmentId: string;
  inputEvidenceReportId: string;
  snapshotId: string;
  commitSha: string;
  analyzerId: string;
  pathPrefixes?: string[];
  subjectRefs?: string[];
  reasonRequirementId: string;
  idempotencyKey: string;
}

export interface RequestTargetedReanalysisResponse {
  requestId: string;
  state: TargetedReanalysisRequestState;
  checkpointRef: string;
  alreadyQueued: boolean;
}

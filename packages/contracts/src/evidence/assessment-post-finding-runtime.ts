import type { AssessmentRuntimeRunStatus } from "./assessment-runtime.ts";

export const REMEDIATION_DECISIONS = {
  updateGithubPat: "UPDATE_GITHUB_PAT",
  continueDetectedPr: "CONTINUE_DETECTED_PR",
  createRemediationPr: "CREATE_REMEDIATION_PR",
} as const;

export type RemediationDecision =
  (typeof REMEDIATION_DECISIONS)[keyof typeof REMEDIATION_DECISIONS];

export const POST_FINDING_RUNTIME_PHASES = {
  codeReview: "CODE_REVIEW",
  needsInput: "NEEDS_INPUT",
  existingPr: "EXISTING_PR",
  createPr: "CREATE_PR",
  verification: "VERIFICATION",
  final: "FINAL",
} as const;

export type PostFindingRuntimePhase =
  (typeof POST_FINDING_RUNTIME_PHASES)[keyof typeof POST_FINDING_RUNTIME_PHASES];

export const REMEDIATION_APPROVAL_STATUSES = {
  notRequired: "NOT_REQUIRED",
  pendingCustomer: "PENDING_CUSTOMER",
  approved: "APPROVED",
  invalidated: "INVALIDATED",
} as const;

export type RemediationApprovalStatus =
  (typeof REMEDIATION_APPROVAL_STATUSES)[keyof typeof REMEDIATION_APPROVAL_STATUSES];

export const VERIFICATION_RESULT_STATUSES = {
  pending: "PENDING",
  running: "RUNNING",
  passed: "PASSED",
  failed: "FAILED",
} as const;

export type VerificationResultStatus =
  (typeof VERIFICATION_RESULT_STATUSES)[keyof typeof VERIFICATION_RESULT_STATUSES];

export const FINAL_ASSESSMENT_RESULT_STATUSES = {
  verified: "VERIFIED",
  unresolved: "UNRESOLVED",
} as const;

export type FinalAssessmentResultStatus =
  (typeof FINAL_ASSESSMENT_RESULT_STATUSES)[keyof typeof FINAL_ASSESSMENT_RESULT_STATUSES];

export type AssessmentPostFindingActivity = {
  id: string;
  label: string;
  detail?: string;
  status: AssessmentRuntimeRunStatus;
};

export type AssessmentPostFindingArtifactRefs = {
  remediationPatchResourceId?: string;
  verificationReportResourceId?: string;
  finalReportResourceId?: string;
};

export type AssessmentDetectedPullRequest = {
  number: number;
  url?: string;
  branch: string;
  patchVersion: string;
};

/**
 * Customer-safe, orchestration-owned state for the post-finding assessment flow.
 * The runtime is authoritative; clients may only render this state and submit an
 * explicitly available customer action.
 */
export type AssessmentPostFindingRuntimeState = {
  assessmentId: string;
  phase: PostFindingRuntimePhase;
  codeReviewActivities: AssessmentPostFindingActivity[];
  decisionAvailability: RemediationDecision[];
  selectedDecision?: RemediationDecision;
  selectedDecisionAt?: string;
  detectedPullRequest?: AssessmentDetectedPullRequest;
  createdPullRequest?: AssessmentDetectedPullRequest;
  approvalStatus: RemediationApprovalStatus;
  approvedPatchVersion?: string;
  verificationActivities: AssessmentPostFindingActivity[];
  verificationStatus?: VerificationResultStatus;
  finalResult?: FinalAssessmentResultStatus;
  canContinueRemediation?: boolean;
  artifacts?: AssessmentPostFindingArtifactRefs;
};

export type AssessmentPostFindingDecisionInput = {
  decision: RemediationDecision;
};

export function isRemediationDecision(
  value: unknown,
): value is RemediationDecision {
  return (
    typeof value === "string" &&
    Object.values(REMEDIATION_DECISIONS).includes(value as RemediationDecision)
  );
}

export function isPostFindingRuntimePhase(
  value: unknown,
): value is PostFindingRuntimePhase {
  return (
    typeof value === "string" &&
    Object.values(POST_FINDING_RUNTIME_PHASES).includes(
      value as PostFindingRuntimePhase,
    )
  );
}

export const RECONCILE_VERIFIED_PROFILE_TOOL = {
  name: "reconcile_profile_to_verified_profile",
  version: "1.0.0",
  configHash: "sha256:verified-profile-v1",
  providerVersion: "lcsp.reconcile-verified-profile.v1",
} as const;

export const RECONCILE_VERIFIED_PROFILE_STATUSES = {
  ready: "READY",
  conflict: "CONFLICT",
  needsInput: "NEEDS_INPUT",
  blocked: "BLOCKED",
  failed: "FAILED",
} as const;

export type ReconcileVerifiedProfileStatus =
  (typeof RECONCILE_VERIFIED_PROFILE_STATUSES)[keyof typeof RECONCILE_VERIFIED_PROFILE_STATUSES];

export type ReconcileVerifiedProfileInput = {
  assessmentId: string;
  wizardProfileId: string;
  technicalEvidenceReportId: string;
  aiUsageFlowId: string;
  reconciliationDecisionRefs: string[];
  idempotencyKey: string;
};

export type ReconcileVerifiedProfileResult = {
  verifiedProfileId: string;
  lifecycleStatus: string;
  factEvidenceRefs: string[];
  sourceArtifactRefs: string[];
  outboxEventRef: string;
};

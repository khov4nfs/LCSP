"use client";

export const apiQueryKeys = {
  auth: {
    settingsProfile: () => ["auth", "settings-profile"] as const,
    sessions: () => ["auth", "sessions"] as const,
    repositories: () => ["auth", "repositories"] as const,
  },
  workspace: {
    detail: () => ["workspace"] as const,
    assessments: () => ["assessments"] as const,
    selection: () => ["mock-workspace-selection"] as const,
  },
  assessment: {
    classification: (assessmentId: string) =>
      ["assessment", assessmentId, "classification"] as const,
    readiness: (assessmentId: string) =>
      ["assessment", assessmentId, "readiness"] as const,
    wizard: (assessmentId: string) =>
      ["assessment", assessmentId, "wizard"] as const,
    conflicts: (assessmentId: string) =>
      ["assessment", assessmentId, "conflicts", "pending"] as const,
    evidence: (assessmentId: string) =>
      ["assessment", assessmentId, "evidence"] as const,
    documents: (assessmentId: string) =>
      ["assessment", assessmentId, "documents"] as const,
    documentStatus: (assessmentId: string, documentRequestId: string) =>
      ["assessment", assessmentId, "documents", documentRequestId] as const,
  },
} as const;

export const ARTIFACT_TYPES = {
  finalReport: "FINAL_REPORT",
} as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[keyof typeof ARTIFACT_TYPES];

export const ARTIFACT_STATUSES = {
  ready: "AVAILABLE",
  waiting: "WAITING",
  updating: "UPDATING",
  paused: "PAUSED",
  unavailable: "UNAVAILABLE",
} as const;

export type ArtifactStatus =
  (typeof ARTIFACT_STATUSES)[keyof typeof ARTIFACT_STATUSES];

export type ArtifactRef = {
  assessmentId: string;
  type: ArtifactType;
  resourceId?: string;
};

export type ArtifactListItemModel = {
  ref: ArtifactRef;
  title: string;
  context?: string;
  status: ArtifactStatus;
};

export type ArtifactGroup = {
  assessmentId: string;
  title: string;
  context?: string;
  updatedAt?: string;
  artifacts: ArtifactListItemModel[];
};

export const ARTIFACT_TABS = {
  all: "ALL",
  yours: "YOURS",
  sharedWithYou: "SHARED_WITH_YOU",
} as const;

export type ArtifactTab = (typeof ARTIFACT_TABS)[keyof typeof ARTIFACT_TABS];

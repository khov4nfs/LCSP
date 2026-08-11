export const WORKSPACE_RUNTIME_CONNECTION_STATES = {
  connecting: "CONNECTING",
  connected: "CONNECTED",
  disconnected: "DISCONNECTED",
} as const;

export type WorkspaceRuntimeConnectionState =
  (typeof WORKSPACE_RUNTIME_CONNECTION_STATES)[keyof typeof WORKSPACE_RUNTIME_CONNECTION_STATES];

export type WorkspaceRuntimeScanJob = {
  id: string;
  assessmentId: string;
  snapshotId: string;
  status: string;
  attemptCount: number;
  blockedReason: string | null;
  updatedAt: string;
};

export type WorkspaceRuntimeEvidenceReport = {
  id: string;
  assessmentId: string;
  scanJobId: string;
  snapshotId: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
};

export type WorkspaceRuntimeSnapshot = {
  emittedAt: string | null;
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
};

export type WorkspaceRuntimeContextValue = WorkspaceRuntimeSnapshot & {
  connectionState: WorkspaceRuntimeConnectionState;
};

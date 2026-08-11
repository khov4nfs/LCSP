"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { apiQueryKeys } from "@/lib/api/query-keys";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeContextValue,
  type WorkspaceRuntimeEvidenceReport,
  type WorkspaceRuntimeScanJob,
} from "../../types/workspace-runtime.types";

const initialRuntime: WorkspaceRuntimeContextValue = {
  connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
  emittedAt: null,
  scanJobs: [],
  evidenceReports: [],
};

const WorkspaceRuntimeContext =
  createContext<WorkspaceRuntimeContextValue>(initialRuntime);

export function WorkspaceRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState(initialRuntime);
  const queryClient = useQueryClient();
  const latestFingerprint = useRef<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/workspace/runtime-events");
    const onRuntime = (event: MessageEvent<string>) => {
      const parsed = parseRuntimeEvent(event.data);
      if (parsed !== null) {
        setRuntime({
          connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
          ...parsed,
        });
        const fingerprint = runtimeFingerprint(parsed);
        if (latestFingerprint.current !== fingerprint) {
          latestFingerprint.current = fingerprint;
          for (const assessmentId of affectedAssessmentIds(parsed)) {
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.readiness(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.evidence(assessmentId),
            });
            void queryClient.invalidateQueries({
              queryKey: apiQueryKeys.assessment.classification(assessmentId),
            });
          }
        }
      }
    };

    source.addEventListener("workspace.runtime", onRuntime);
    source.onopen = () => {
      setRuntime((current) => ({
        ...current,
        connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      }));
    };
    source.onerror = () => {
      setRuntime((current) => ({
        ...current,
        connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
      }));
    };

    return () => {
      source.removeEventListener("workspace.runtime", onRuntime);
      source.close();
    };
  }, [queryClient]);

  return (
    <WorkspaceRuntimeContext.Provider value={runtime}>
      {children}
    </WorkspaceRuntimeContext.Provider>
  );
}

export function useWorkspaceRuntime() {
  return useContext(WorkspaceRuntimeContext);
}

function parseRuntimeEvent(data: string) {
  const payload = parseObject(data);
  if (payload === null || typeof payload.emitted_at !== "string") {
    return null;
  }

  const scanJobs = Array.isArray(payload.scan_jobs)
    ? payload.scan_jobs.map(parseScanJob).filter(isDefined)
    : [];
  const evidenceReports = Array.isArray(payload.evidence_reports)
    ? payload.evidence_reports.map(parseEvidenceReport).filter(isDefined)
    : [];

  return { emittedAt: payload.emitted_at, scanJobs, evidenceReports };
}

function parseScanJob(value: unknown): WorkspaceRuntimeScanJob | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.id !== "string" ||
    typeof item.assessment_id !== "string" ||
    typeof item.snapshot_id !== "string" ||
    typeof item.status !== "string" ||
    typeof item.attempt_count !== "number" ||
    typeof item.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    assessmentId: item.assessment_id,
    snapshotId: item.snapshot_id,
    status: item.status,
    attemptCount: item.attempt_count,
    blockedReason:
      typeof item.blocked_reason === "string" ? item.blocked_reason : null,
    updatedAt: item.updated_at,
  };
}

function parseEvidenceReport(
  value: unknown,
): WorkspaceRuntimeEvidenceReport | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.id !== "string" ||
    typeof item.assessment_id !== "string" ||
    typeof item.scan_job_id !== "string" ||
    typeof item.snapshot_id !== "string" ||
    typeof item.status !== "string" ||
    typeof item.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    assessmentId: item.assessment_id,
    scanJobId: item.scan_job_id,
    snapshotId: item.snapshot_id,
    status: item.status,
    rejectionReason:
      typeof item.rejection_reason === "string" ? item.rejection_reason : null,
    createdAt: item.created_at,
  };
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function runtimeFingerprint(runtime: {
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
}) {
  return JSON.stringify({
    scanJobs: runtime.scanJobs.map((scanJob) => [
      scanJob.id,
      scanJob.status,
      scanJob.attemptCount,
      scanJob.blockedReason,
      scanJob.updatedAt,
    ]),
    evidenceReports: runtime.evidenceReports.map((report) => [
      report.id,
      report.status,
      report.rejectionReason,
      report.createdAt,
    ]),
  });
}

function affectedAssessmentIds(runtime: {
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
}) {
  return new Set([
    ...runtime.scanJobs.map((scanJob) => scanJob.assessmentId),
    ...runtime.evidenceReports.map((report) => report.assessmentId),
  ]);
}

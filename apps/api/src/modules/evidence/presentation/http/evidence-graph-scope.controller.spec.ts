/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import {
  type RepositoryScanJobStatus,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { EvidenceController } from "./evidence.controller.js";

const request = {
  correlationId: "scope-test",
  rbacContext: { role: AUTH_USER_ROLES.admin, userId: "admin" },
} as never;

function build() {
  const jobs: Array<{
    id: string;
    snapshotId: string;
    status: RepositoryScanJobStatus;
  }> = [
    {
      id: "job-new",
      snapshotId: "snapshot-new",
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
    },
    {
      id: "job-old",
      snapshotId: "snapshot-old",
      status: REPOSITORY_SCAN_JOB_STATUSES.completed,
    },
  ];
  const report = {
    id: "report-old",
    assessmentId: "assessment",
    scanJobId: "job-old",
    snapshotId: "snapshot-old",
    createdAt: new Date(),
    snapshot: null,
  };
  const findScan = jest.fn(
    async (args: {
      where: { assessmentId: string; id?: string; snapshotId?: string };
    }) => {
      if (args.where.assessmentId !== "assessment") return null;
      return (
        jobs.find(
          (job) =>
            (!args.where.id || args.where.id === job.id) &&
            (!args.where.snapshotId ||
              args.where.snapshotId === job.snapshotId),
        ) ?? null
      );
    },
  );
  const findReport = jest.fn(
    async (args: {
      where: { scanJobId: string; snapshotId?: string; status: string };
    }) => {
      return args.where.scanJobId === report.scanJobId &&
        (!args.where.snapshotId ||
          args.where.snapshotId === report.snapshotId) &&
        args.where.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted
        ? report
        : null;
    },
  );
  const graphDetail = {
    projectAcceptedReport: jest.fn(async () => ({
      provenance: {
        evidence_report_id: report.id,
        snapshot_id: report.snapshotId,
        scan_job_id: report.scanJobId,
      },
    })),
    projectAcceptedOverview: jest.fn(async () => ({
      report_id: report.id,
      snapshot_id: report.snapshotId,
      scan_job_id: report.scanJobId,
      graph_ready: true,
    })),
  };
  const controller = new EvidenceController(
    {} as never,
    {
      repositoryScanJob: { findFirst: findScan },
      technicalEvidenceReport: { findFirst: findReport },
    } as never,
    graphDetail as never,
    {} as never,
  );
  return { controller, jobs, findScan, findReport, graphDetail };
}

describe("Graph current and historical run selection", () => {
  it("does not return the old accepted report while the current run has no report", async () => {
    const { controller, findReport, graphDetail } = build();
    await expect(
      controller.getEvidenceGraph("assessment", request),
    ).rejects.toMatchObject({
      response: {
        problem: {
          code: EVIDENCE_ERROR_CODES.notReady,
          meta: { scanJobId: "job-new", snapshotId: "snapshot-new" },
        },
      },
    });
    expect(findReport).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scanJobId: "job-new",
          snapshotId: "snapshot-new",
        }),
      }),
    );
    expect(graphDetail.projectAcceptedReport).not.toHaveBeenCalled();
  });

  it("returns only the explicitly selected historical graph", async () => {
    const { controller, findScan } = build();
    await expect(
      controller.getEvidenceGraph(
        "assessment",
        request,
        "snapshot-old",
        "job-old",
      ),
    ).resolves.toMatchObject({
      data: {
        provenance: {
          evidence_report_id: "report-old",
          scan_job_id: "job-old",
        },
      },
    });
    expect(findScan).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: "assessment",
          id: "job-old",
          snapshotId: "snapshot-old",
        },
      }),
    );
  });

  it("returns not-found for a mismatched job/snapshot without falling back", async () => {
    const { controller, findReport } = build();
    await expect(
      controller.getEvidenceGraph(
        "assessment",
        request,
        "snapshot-old",
        "job-new",
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: EVIDENCE_ERROR_CODES.notFound } },
    });
    expect(findReport).not.toHaveBeenCalled();
  });

  it("uses the requested run, not the latest run, for failure guidance", async () => {
    const { controller, jobs } = build();
    jobs[1].status = REPOSITORY_SCAN_JOB_STATUSES.failed;
    await expect(
      controller.getEvidenceGraph(
        "assessment",
        request,
        "snapshot-old",
        "job-missing",
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: EVIDENCE_ERROR_CODES.notFound } },
    });
    jobs[1].id = "job-failed";
    await expect(
      controller.getEvidenceGraph(
        "assessment",
        request,
        "snapshot-old",
        "job-failed",
      ),
    ).rejects.toMatchObject({
      response: {
        problem: {
          code: EVIDENCE_ERROR_CODES.buildFailed,
          meta: { scanJobId: "job-failed", snapshotId: "snapshot-old" },
        },
      },
    });
  });

  it("uses the same selection and checked readiness for Overview", async () => {
    const { controller } = build();
    await expect(
      controller.getEvidenceGraphOverview("assessment", request),
    ).rejects.toMatchObject({
      response: {
        problem: {
          code: EVIDENCE_ERROR_CODES.notReady,
          meta: { scanJobId: "job-new" },
        },
      },
    });
    await expect(
      controller.getEvidenceGraphOverview(
        "assessment",
        request,
        "snapshot-old",
        "job-old",
      ),
    ).resolves.toMatchObject({
      data: {
        graph_ready: true,
        report_id: "report-old",
        snapshot_id: "snapshot-old",
        scan_job_id: "job-old",
      },
    });
  });
});

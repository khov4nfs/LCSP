/* eslint-disable @typescript-eslint/require-await */
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";
import { ProgramEvidenceGraphDetailService } from "./program-evidence-graph-detail.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

const report = {
  id: "graph-readiness-report",
  assessmentId: "graph-readiness-assessment",
  scanJobId: "graph-readiness-run",
  snapshotId: "graph-readiness-snapshot",
  createdAt: new Date("2026-10-02T00:00:00Z"),
};

function input(evidencePayload: unknown) {
  return {
    report,
    snapshot: null,
    correlationId: "graph-readiness-test",
    loadEvidencePayload: async () => evidencePayload,
  };
}

function serviceWithArtifact(read: () => Promise<Record<string, unknown>>) {
  return new ProgramEvidenceGraphDetailService({
    readJsonArtifactReference: read,
    statJsonArtifactReference: async () => ({ size: 12, mtimeMs: 1 }),
  } as unknown as ArtifactStorageService);
}

describe("accepted Graph readiness", () => {
  it("does not infer readiness from metrics or an accepted report identifier", async () => {
    const service = serviceWithArtifact(async () => ({ nodes: [], edges: [] }));
    const overview = await service.projectAcceptedOverview(
      input({ modulesAnalyzed: 12 }),
    );
    expect(overview).toMatchObject({
      report_id: report.id,
      modules_analyzed: 12,
      graph_ready: false,
    });
    await expect(
      service.projectAcceptedReport(input({ modulesAnalyzed: 12 })),
    ).rejects.toMatchObject({
      status: HttpStatus.ACCEPTED,
      response: { problem: { code: EVIDENCE_ERROR_CODES.notReady } },
    });
  });

  it("accepts a valid empty inline graph; zero AI findings is not a missing graph", async () => {
    const service = serviceWithArtifact(async () => {
      throw new Error("must not read an artifact");
    });
    const request = input({
      modulesAnalyzed: 0,
      evidence_graph: { nodes: [], edges: [] },
    });
    const overview = await service.projectAcceptedOverview(request);
    expect(overview).toMatchObject({
      graph_ready: true,
      modules_analyzed: 0,
      snapshot_id: report.snapshotId,
      scan_job_id: report.scanJobId,
    });
    const detail = await service.projectAcceptedReport(request);
    expect(detail.overview.graph_ready).toBe(true);
    expect(detail.paths.nodes).toEqual([]);
  });

  it.each([
    {},
    { nodes: [] },
    { nodes: null, edges: [] },
    { nodes: [null], edges: [] },
    { nodes: [{}], edges: [] },
    { nodes: [{ node_id: "same" }, { node_id: "same" }], edges: [] },
    {
      nodes: [{ node_id: "one" }],
      edges: [{ edge_id: "edge", source: "one", target: "missing" }],
    },
    { nodes: [], edges: [42] },
  ])("does not claim readiness for a malformed topology: %p", async (graph) => {
    const service = serviceWithArtifact(async () => graph);
    const overview = await service.projectAcceptedOverview(
      input({ evidence_graph: graph }),
    );
    expect(overview.graph_ready).toBe(false);
  });

  it("does not fall back to metadata or inline placeholders when a referenced artifact cannot be read", async () => {
    const service = serviceWithArtifact(async () => {
      throw new Error("artifact unavailable");
    });
    const request = input({
      evidence_graph: {
        evidence_graph_ref: "graph.json",
        nodes: [],
        edges: [],
      },
    });
    expect((await service.projectAcceptedOverview(request)).graph_ready).toBe(
      false,
    );
    await expect(service.projectAcceptedReport(request)).rejects.toMatchObject({
      response: {
        problem: {
          code: EVIDENCE_ERROR_CODES.notReady,
          meta: { scanJobId: report.scanJobId, snapshotId: report.snapshotId },
        },
      },
    });
  });

  it("retries unavailable artifacts rather than caching a negative result", async () => {
    let available = false;
    let reads = 0;
    const service = serviceWithArtifact(async () => {
      reads += 1;
      if (!available) throw new Error("not yet available");
      return { nodes: [], edges: [] };
    });
    const request = input({
      evidence_graph: { evidence_graph_ref: "graph.json" },
    });
    expect((await service.projectAcceptedOverview(request)).graph_ready).toBe(
      false,
    );
    available = true;
    expect((await service.projectAcceptedOverview(request)).graph_ready).toBe(
      true,
    );
    const detail = await service.projectAcceptedReport(request);
    expect(detail.overview.graph_ready).toBe(true);
    expect(reads).toBe(2);
  });
});

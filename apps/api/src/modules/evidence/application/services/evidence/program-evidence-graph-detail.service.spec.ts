import { ProgramEvidenceGraphDetailService } from "./program-evidence-graph-detail.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

describe("ProgramEvidenceGraphDetailService", () => {
  it("projects canonical graph data and preserves real zero metrics", async () => {
    const result = await new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference: () => Promise.reject(new Error("missing")),
    } as unknown as ArtifactStorageService).project({
      report: {
        id: "report-1",
        assessmentId: "assessment-1",
        scanJobId: "scan-1",
        snapshotId: "snapshot-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        evidencePayload: {
          modulesAnalyzed: 0,
          evidence_graph: {
            nodes: [
              {
                node_id: "node-1",
                node_type: "FUNCTION",
                label: "authorize",
                source: { file_path: "src/auth.ts", line_number: 12 },
              },
              { node_id: "node-2", node_type: "AI_PROVIDER", label: "OpenAI" },
            ],
            edges: [
              {
                edge_id: "edge-1",
                source_node_id: "node-1",
                target_node_id: "node-2",
                edge_type: "SENDS_TO_AI",
              },
              {
                edge_id: "orphan",
                source_node_id: "missing",
                target_node_id: "node-2",
              },
            ],
          },
          claims: [
            {
              claim_id: "claim-1",
              meaning: "Authorization reaches the provider boundary",
              evidence_refs: ["node-1", "/app/deepagents/tmp/secret.json"],
              symbol_ref: "authorize",
              file_path: "src/auth.ts",
              line_number: 12,
            },
          ],
          token: "must-not-be-exposed",
        },
      },
      snapshot: {
        repositoryFullName: "org/repo",
        branch: "develop",
        ref: "refs/heads/develop",
        commitSha: "abc123",
        status: "READY",
      },
    });

    expect(result.overview.modules_analyzed).toBe(0);
    expect(result.paths.nodes).toHaveLength(2);
    expect(result.paths.edges).toEqual([
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        relationship: "SENDS_TO_AI",
      },
    ]);
    expect(result.claims[0]).toMatchObject({
      id: "claim-1",
      file: "src/auth.ts",
      line: 12,
    });
    expect(result.provenance.finding).toMatchObject({
      meaning: "Authorization reaches the provider boundary",
      source: {
        file: "src/auth.ts",
        symbol: "authorize",
        start_line: 12,
        end_line: 12,
      },
    });
    expect(result.provenance.source).toMatchObject({
      file: "src/auth.ts",
      start_line: 12,
      end_line: 12,
    });
    expect(result.claims[0]?.evidence_refs).toEqual(["node-1"]);
    expect(JSON.stringify(result)).not.toContain("must-not-be-exposed");
  });

  it("does not fabricate repository branch or unavailable metrics", async () => {
    const result = await new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference: () => Promise.reject(new Error("missing")),
    } as unknown as ArtifactStorageService).project({
      report: {
        id: "report-1",
        assessmentId: "assessment-1",
        scanJobId: "scan-1",
        snapshotId: "snapshot-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        evidencePayload: {},
      },
      snapshot: null,
    });
    expect(result.repository.branch).toBeNull();
    expect(result.overview.code_symbols_indexed).toBeNull();
    expect(result.provenance.finding).toBeNull();
    expect(result.provenance.source).toBeNull();
  });

  it("reads a durable graph reference and returns a bounded deterministic projection", async () => {
    const nodes = Array.from({ length: 300 }, (_, index) => ({
      node_id: `node-${String(index).padStart(3, "0")}`,
      node_type: index === 0 ? "AI_PROVIDER" : "FUNCTION",
      label: `node-${index}`,
    }));
    const edges = Array.from({ length: 299 }, (_, index) => ({
      edge_id: `edge-${String(index).padStart(3, "0")}`,
      source_node_id: `node-${String(index).padStart(3, "0")}`,
      target_node_id: `node-${String(index + 1).padStart(3, "0")}`,
      edge_type: "CALLS",
    }));
    const result = await new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference: () => Promise.resolve({ nodes, edges }),
    } as unknown as ArtifactStorageService).project({
      report: {
        id: "report-1",
        assessmentId: "assessment-1",
        scanJobId: "scan-1",
        snapshotId: "snapshot-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        evidencePayload: {
          evidence_graph: {
            evidence_graph_ref: "/app/deepagents/tmp/graph.json",
          },
        },
      },
      snapshot: null,
    });
    expect(result.paths.nodes.length).toBeLessThanOrEqual(240);
    expect(result.paths.edges.length).toBeLessThanOrEqual(480);
    expect(result.paths.nodes[0]?.kind).toBe("AI_PROVIDER");
  });
});

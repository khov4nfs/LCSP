import { jest } from "@jest/globals";
import { ProgramEvidenceGraphDetailService } from "./program-evidence-graph-detail.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

describe("ProgramEvidenceGraphDetailService", () => {
  it("projects persisted overview metrics without reading graph artifacts", () => {
    let artifactReads = 0;
    const service = new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference: () => {
        artifactReads += 1;
        return Promise.resolve(null);
      },
    } as unknown as ArtifactStorageService);

    expect(
      service.projectOverview({
        modules_analyzed: 1539,
        code_symbols_indexed: 7113,
        ai_model_invocations: 2,
        evidence_mapped_scope: 99,
      }),
    ).toEqual({
      modules_analyzed: 1539,
      code_symbols_indexed: 7113,
      ai_model_invocations: 2,
      evidence_mapped_scope: 99,
    });
    expect(
      service.projectOverview({
        modulesAnalyzed: 0,
        codeSymbolsIndexed: 0,
        aiModelInvocations: 0,
        evidenceMappedScope: 0,
      }),
    ).toEqual({
      modules_analyzed: 0,
      code_symbols_indexed: 0,
      ai_model_invocations: 0,
      evidence_mapped_scope: 0,
    });
    expect(service.projectOverview({})).toEqual({
      modules_analyzed: null,
      code_symbols_indexed: null,
      ai_model_invocations: null,
      evidence_mapped_scope: null,
    });
    expect(artifactReads).toBe(0);
  });

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

  it("selects the same seed ordering as a full stable sort, including ties and non-ASCII ids", async () => {
    const ids = ["é-1", "E-1", "a-10", "a-2", "Z-1", "ä-3", "b_1", "B-1"];
    const nodes = Array.from({ length: 400 }, (_, index) => ({
      node_id: `${ids[index % ids.length]}-${index}`,
      node_type:
        index % 5 === 0
          ? "ai_model"
          : index % 7 === 0
            ? "HTTP_ROUTE"
            : "FUNCTION",
      label: `node-${index}`,
    }));
    const edges = Array.from({ length: 800 }, (_, index) => ({
      edge_id: `edge-${index}`,
      source_node_id: nodes[(index * 13) % nodes.length].node_id,
      target_node_id: nodes[(index * 29 + 7) % nodes.length].node_id,
      edge_type: "CALLS",
    }));
    const service = new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference: () => Promise.reject(new Error("missing")),
    } as unknown as ArtifactStorageService);

    const result = await service.project({
      report: {
        id: "report-rank",
        assessmentId: "assessment-1",
        scanJobId: "scan-1",
        snapshotId: "snapshot-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        evidencePayload: { evidence_graph: { nodes, edges } },
      },
      snapshot: null,
    });

    const score = (kind: string) => {
      const upper = kind.toUpperCase();
      return upper.includes("AI_") || upper.includes("HTTP_ROUTE") ? 0 : 1;
    };
    const expectedSeeds = new Set(
      [...nodes]
        .sort(
          (left, right) =>
            score(left.node_type) - score(right.node_type) ||
            left.node_id.localeCompare(right.node_id),
        )
        .slice(0, 24)
        .map((node) => node.node_id),
    );
    const projectedIds = new Set(result.paths.nodes.map((node) => node.id));
    for (const seed of expectedSeeds) {
      expect(projectedIds.has(seed)).toBe(true);
    }
    expect(result.paths.nodes.length).toBeLessThanOrEqual(240);
  });

  it("keeps the first minimal provenance source like a stable sort", async () => {
    const service = new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference: () => Promise.reject(new Error("missing")),
    } as unknown as ArtifactStorageService);
    const result = await service.project({
      report: {
        id: "report-source",
        assessmentId: "assessment-1",
        scanJobId: "scan-1",
        snapshotId: "snapshot-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        evidencePayload: {
          evidence_graph: {
            nodes: [
              {
                node_id: "n1",
                node_type: "FUNCTION",
                source: { file_path: "src/b.ts", line_number: 1 },
              },
              {
                node_id: "n2",
                node_type: "FUNCTION",
                source: {
                  file_path: "src/a.ts",
                  line_number: 9,
                  symbol_ref: "z",
                },
                evidence_refs: ["first"],
              },
              {
                node_id: "n3",
                node_type: "FUNCTION",
                source: {
                  file_path: "src/a.ts",
                  line_number: 9,
                  symbol_ref: "z",
                },
                evidence_refs: ["second"],
              },
              {
                node_id: "n4",
                node_type: "FUNCTION",
                source: { file_path: "<workspace>", line_number: 1 },
              },
            ],
            edges: [],
          },
        },
      },
      snapshot: null,
    });

    expect(result.provenance.source).toEqual({
      file: "src/a.ts",
      symbol: "z",
      start_line: 9,
      end_line: 9,
      evidence_reference: "first",
    });
  });

  it("reuses an accepted report projection without reloading the payload or artifact", async () => {
    const readJsonArtifactReference = jest.fn(() =>
      Promise.resolve({
        nodes: [{ node_id: "n1", node_type: "AI_PROVIDER", label: "provider" }],
        edges: [],
      }),
    );
    let mtimeMs = 1;
    const statJsonArtifactReference = jest.fn(() =>
      Promise.resolve({ size: 10, mtimeMs }),
    );
    const service = new ProgramEvidenceGraphDetailService({
      readJsonArtifactReference,
      statJsonArtifactReference,
    } as unknown as ArtifactStorageService);
    const loadEvidencePayload = jest.fn(() =>
      Promise.resolve({
        evidence_graph: {
          evidence_graph_ref: "/app/deepagents/tmp/graph.json",
        },
      }),
    );
    const report = {
      id: "report-cached",
      assessmentId: "assessment-1",
      scanJobId: "scan-1",
      snapshotId: "snapshot-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const first = await service.projectAcceptedReport({
      report,
      snapshot: null,
      loadEvidencePayload,
    });
    first.paths.nodes[0].label = "mutated by a caller";
    const second = await service.projectAcceptedReport({
      report,
      snapshot: {
        repositoryFullName: "org/repo",
        branch: "main",
        ref: null,
        commitSha: "abc",
        status: "READY",
      },
      loadEvidencePayload,
    });

    expect(loadEvidencePayload).toHaveBeenCalledTimes(1);
    expect(readJsonArtifactReference).toHaveBeenCalledTimes(1);
    expect(second.paths.nodes[0].label).toBe("provider");
    expect(second.repository.repository_full_name).toBe("org/repo");

    mtimeMs = 2;
    await service.projectAcceptedReport({
      report,
      snapshot: null,
      loadEvidencePayload,
    });
    expect(loadEvidencePayload).toHaveBeenCalledTimes(2);
    expect(readJsonArtifactReference).toHaveBeenCalledTimes(2);
  });
});

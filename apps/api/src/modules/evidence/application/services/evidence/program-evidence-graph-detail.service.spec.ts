import { jest } from "@jest/globals";
import {
  AI_DISCOVERY_EVIDENCE_STATES,
  AI_DISCOVERY_RESOLUTION_STATES,
} from "@lcsp/contracts/evidence";
import { ProgramEvidenceGraphDetailService } from "./program-evidence-graph-detail.service.js";
import type { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

const baseReport = {
  id: "report-1",
  assessmentId: "assessment-1",
  scanJobId: "scan-1",
  snapshotId: "snapshot-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function projectGraph(graph: { nodes: unknown[]; edges: unknown[] }) {
  return new ProgramEvidenceGraphDetailService({
    readJsonArtifactReference: () => Promise.reject(new Error("missing")),
  } as unknown as ArtifactStorageService).project({
    report: {
      ...baseReport,
      evidencePayload: {
        modulesAnalyzed: 0,
        evidence_graph: graph,
      },
    },
    snapshot: null,
  });
}

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
              {
                node_id: "node-2",
                node_type: "AI_MODEL_INVOCATION",
                label: "responses.create",
                resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
              },
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
    expect(result.paths.edges).toMatchObject([
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        relationship: "SENDS_TO_AI",
        resolution_state: AI_DISCOVERY_RESOLUTION_STATES.unresolved,
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

  it("projects a direct AI SDK flow back to its module", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "module:web", node_type: "MODULE", label: "Web module" },
        {
          node_id: "route:chat",
          node_type: "HTTP_ROUTE",
          label: "POST /chat",
        },
        {
          node_id: "service:chat",
          node_type: "FUNCTION",
          label: "ChatService.ask",
        },
        {
          node_id: "sdk:openai",
          node_type: "AI_MODEL_INVOCATION",
          label: "responses.create",
          attributes: { provider: "OPENAI" },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        { node_id: "noise", node_type: "FUNCTION", label: "BillingService" },
      ],
      edges: [
        {
          edge_id: "module-route",
          source_node_id: "module:web",
          target_node_id: "route:chat",
          edge_type: "CONTAINS",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        {
          edge_id: "route-service",
          source_node_id: "route:chat",
          target_node_id: "service:chat",
          edge_type: "HANDLED_BY",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        {
          edge_id: "service-sdk",
          source_node_id: "service:chat",
          target_node_id: "sdk:openai",
          edge_type: "CALLS",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
    });

    expect(result.paths.nodes.map((node) => node.id)).toEqual([
      "sdk:openai",
      "module:web",
      "projection-provider:sdk:openai:OPENAI",
      "route:chat",
      "service:chat",
    ]);
    expect(result.paths.edges.map((edge) => edge.id)).toEqual([
      "module-route",
      "projection-provider-edge:sdk:openai:OPENAI",
      "route-service",
      "service-sdk",
    ]);
    expect(
      result.paths.nodes.find((node) => node.id === "noise"),
    ).toBeUndefined();
  });

  it("projects REST AI provider flow without frontend provider guessing", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "module:api", node_type: "MODULE", label: "API module" },
        {
          node_id: "handler:chat",
          node_type: "FUNCTION",
          label: "chatHandler",
        },
        {
          node_id: "endpoint:openai",
          node_type: "AI_API_CANDIDATE",
          label: "known AI API call",
          attributes: {
            discoveryState: AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall,
            provider: "OPENAI",
            host: "api.openai.com",
            endpointSource: "LITERAL",
          },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.corroborated,
        },
      ],
      edges: [
        {
          edge_id: "module-handler",
          source_node_id: "module:api",
          target_node_id: "handler:chat",
          edge_type: "CONTAINS",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        {
          edge_id: "handler-endpoint",
          source_node_id: "handler:chat",
          target_node_id: "endpoint:openai",
          edge_type: "CALLS_EXTERNAL",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.corroborated,
        },
      ],
    });

    expect(result.paths.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "endpoint:openai",
          ai_usage_role: "AI_API_ENDPOINT",
          evidence_state: AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall,
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.corroborated,
        }),
        expect.objectContaining({
          id: "projection-provider:endpoint:openai:OPENAI",
          kind: "AI_PROVIDER",
          label: "OPENAI",
        }),
      ]),
    );
  });

  it("keeps custom AI gateways unresolved and does not assign a provider", async () => {
    const result = await projectGraph({
      nodes: [
        {
          node_id: "route:chat",
          node_type: "HTTP_ROUTE",
          label: "POST /chat",
        },
        {
          node_id: "gateway:custom",
          node_type: "AI_API_CANDIDATE",
          label: "unresolved AI-capable outbound API",
          attributes: {
            discoveryState: AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall,
            endpointSource: "ENV:MODEL_GATEWAY_URL",
          },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.unresolved,
        },
      ],
      edges: [
        {
          edge_id: "route-gateway",
          source_node_id: "route:chat",
          target_node_id: "gateway:custom",
          edge_type: "CALLS_EXTERNAL",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.unresolved,
        },
      ],
    });

    expect(result.paths.nodes).toEqual([
      expect.objectContaining({
        id: "gateway:custom",
        evidence_state: AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall,
        resolution_state: AI_DISCOVERY_RESOLUTION_STATES.unresolved,
      }),
      expect.objectContaining({ id: "route:chat" }),
    ]);
    expect(result.paths.nodes.some((node) => node.kind === "AI_PROVIDER")).toBe(
      false,
    );
    expect(result.paths.edges[0]).toMatchObject({
      id: "route-gateway",
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.unresolved,
    });
  });

  it("renders multiple AI usage paths without mixing unrelated edges", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "module:web", node_type: "MODULE", label: "Web module" },
        { node_id: "module:api", node_type: "MODULE", label: "API module" },
        { node_id: "service:web", node_type: "FUNCTION", label: "webAsk" },
        { node_id: "service:api", node_type: "FUNCTION", label: "apiAsk" },
        {
          node_id: "sdk:web",
          node_type: "AI_MODEL_INVOCATION",
          label: "generateText",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        {
          node_id: "rest:api",
          node_type: "AI_API_CANDIDATE",
          label: "known AI API call",
          attributes: {
            discoveryState: AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall,
            provider: "ANTHROPIC",
          },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
      edges: [
        {
          edge_id: "web-service",
          source_node_id: "module:web",
          target_node_id: "service:web",
          edge_type: "CONTAINS",
        },
        {
          edge_id: "web-ai",
          source_node_id: "service:web",
          target_node_id: "sdk:web",
          edge_type: "CALLS",
        },
        {
          edge_id: "api-service",
          source_node_id: "module:api",
          target_node_id: "service:api",
          edge_type: "CONTAINS",
        },
        {
          edge_id: "api-ai",
          source_node_id: "service:api",
          target_node_id: "rest:api",
          edge_type: "CALLS_EXTERNAL",
        },
        {
          edge_id: "unrelated-cross-edge",
          source_node_id: "service:web",
          target_node_id: "service:api",
          edge_type: "CALLS",
        },
      ],
    });

    expect(result.paths.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "module:web",
        "service:web",
        "sdk:web",
        "module:api",
        "service:api",
        "rest:api",
      ]),
    );
    expect(result.paths.edges.map((edge) => edge.id)).not.toContain(
      "unrelated-cross-edge",
    );
  });

  it("returns an empty AI projection when no governed AI usage exists", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "module:billing", node_type: "MODULE", label: "Billing" },
        { node_id: "handler:billing", node_type: "FUNCTION", label: "charge" },
      ],
      edges: [
        {
          edge_id: "billing-handler",
          source_node_id: "module:billing",
          target_node_id: "handler:billing",
          edge_type: "CONTAINS",
        },
      ],
    });

    expect(result.paths).toEqual({
      nodes: [],
      edges: [],
      usage_flow_count: 0,
      rendered_usage_flow_count: 0,
      omitted_usage_flow_count: 0,
      usage_group_count: 0,
      rendered_usage_group_count: 0,
      omitted_usage_group_count: 0,
      usage_flow_groups: [],
    });
  });

  it("does not promote AI-relevant package dependencies into active usage", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "repository", node_type: "REPOSITORY", label: "repo" },
        {
          node_id: "dependency:openai",
          node_type: "PACKAGE_DEPENDENCY",
          label: "openai",
          attributes: { aiRelevant: true },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
      edges: [
        {
          edge_id: "repo-dep",
          source_node_id: "repository",
          target_node_id: "dependency:openai",
          edge_type: "DEPENDS_ON",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
    });

    expect(result.paths).toEqual({
      nodes: [],
      edges: [],
      usage_flow_count: 0,
      rendered_usage_flow_count: 0,
      omitted_usage_flow_count: 0,
      usage_group_count: 0,
      rendered_usage_group_count: 0,
      omitted_usage_group_count: 0,
      usage_flow_groups: [],
    });
  });

  it("does not promote AI SDK client references into active usage", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "module:api", node_type: "MODULE", label: "API module" },
        {
          node_id: "sdk-client:openai",
          node_type: "SDK_CLIENT",
          label: "OpenAIClient",
          attributes: { semanticRole: "PROVIDER_OPENAI" },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
      edges: [
        {
          edge_id: "module-client",
          source_node_id: "module:api",
          target_node_id: "sdk-client:openai",
          edge_type: "IMPORTS",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
    });

    expect(result.paths.nodes).toEqual([]);
    expect(result.paths.usage_flow_count).toBe(0);
  });

  it("allows dependency evidence only as context for a governed invocation", async () => {
    const result = await projectGraph({
      nodes: [
        { node_id: "module:api", node_type: "MODULE", label: "API module" },
        {
          node_id: "dependency:openai",
          node_type: "PACKAGE_DEPENDENCY",
          label: "openai",
          attributes: { aiRelevant: true },
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        {
          node_id: "sdk:openai",
          node_type: "AI_MODEL_INVOCATION",
          label: "responses.create",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
      edges: [
        {
          edge_id: "module-dep",
          source_node_id: "module:api",
          target_node_id: "dependency:openai",
          edge_type: "DEPENDS_ON",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
        {
          edge_id: "dep-sdk",
          source_node_id: "dependency:openai",
          target_node_id: "sdk:openai",
          edge_type: "CALLS",
          resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
        },
      ],
    });

    expect(result.paths.nodes.map((node) => node.id)).toEqual([
      "sdk:openai",
      "dependency:openai",
      "module:api",
    ]);
    expect(result.paths.usage_flow_count).toBe(1);
  });

  it("reads a durable graph reference and returns a complete deterministic AI projection", async () => {
    const nodes = Array.from({ length: 17 }, (_, index) => ({
      node_id: `node-${String(index).padStart(3, "0")}`,
      node_type: "AI_MODEL_INVOCATION",
      label: `node-${index}`,
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));
    const edges = Array.from({ length: 16 }, (_, index) => ({
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
    expect(result.paths.nodes).toHaveLength(17);
    expect(result.paths.usage_flow_count).toBe(17);
    expect(result.paths.rendered_usage_flow_count).toBe(17);
    expect(result.paths.omitted_usage_flow_count).toBe(0);
    expect(result.paths.nodes.map((node) => node.id)).toContain("node-016");
  });

  it("bounds rendered AI usage flows while preserving total governed counts", async () => {
    const ids = ["é-1", "E-1", "a-10", "a-2", "Z-1", "ä-3", "b_1", "B-1"];
    const nodes = Array.from({ length: 400 }, (_, index) => ({
      node_id: `${ids[index % ids.length]}-${index}`,
      node_type:
        index % 5 === 0
          ? "AI_MODEL_INVOCATION"
          : index % 7 === 0
            ? "HTTP_ROUTE"
            : "FUNCTION",
      label: `node-${index}`,
      resolution_state:
        index % 5 === 0 ? AI_DISCOVERY_RESOLUTION_STATES.observed : undefined,
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

    expect(
      result.paths.nodes.some((node) => node.kind === "AI_MODEL_INVOCATION"),
    ).toBe(true);
    expect(
      result.paths.nodes.every((node) =>
        ["AI_MODEL_INVOCATION", "FUNCTION", "HTTP_ROUTE"].includes(node.kind),
      ),
    ).toBe(true);
    expect(result.paths.usage_flow_count).toBe(80);
    expect(result.paths.rendered_usage_flow_count).toBe(64);
    expect(result.paths.omitted_usage_flow_count).toBe(16);
    expect(result.paths.nodes.length).toBeLessThanOrEqual(704);
    expect(result.paths.edges.length).toBeLessThanOrEqual(640);
  });

  it("returns deterministic overflow metadata for large independent AI graphs", async () => {
    const nodes = Array.from({ length: 1_000 }, (_, index) => ({
      node_id: `flow-${String(index).padStart(4, "0")}`,
      node_type: "AI_MODEL_INVOCATION",
      label: `flow-${index}`,
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));
    const result = await projectGraph({ nodes, edges: [] });

    expect(result.paths.usage_flow_count).toBe(1_000);
    expect(result.paths.rendered_usage_flow_count).toBe(64);
    expect(result.paths.omitted_usage_flow_count).toBe(936);
    expect(result.paths.usage_group_count).toBe(1);
    expect(result.paths.rendered_usage_group_count).toBe(1);
    expect(result.paths.omitted_usage_group_count).toBe(0);
    expect(result.paths.nodes).toHaveLength(64);
    expect(result.paths.edges).toHaveLength(0);
    expect(result.paths.nodes.map((node) => node.id)).toContain("flow-0063");
    expect(result.paths.nodes.map((node) => node.id)).not.toContain(
      "flow-0064",
    );
    expect(
      result.paths.nodes.every(
        (node) =>
          node.kind === "AI_MODEL_INVOCATION" &&
          node.resolution_state === AI_DISCOVERY_RESOLUTION_STATES.observed,
      ),
    ).toBe(true);
    expect(result.paths.usage_flow_groups).toEqual([
      expect.objectContaining({
        usage_flow_count: 1_000,
        rendered_usage_flow_count: 64,
        omitted_usage_flow_count: 936,
      }),
    ]);
  });

  it("bounds group metadata for high-cardinality distinct AI usage groups", async () => {
    const flowCount = 20_000;
    const nodes = Array.from({ length: flowCount }, (_, index) => [
      {
        node_id: `module:${String(index).padStart(5, "0")}`,
        node_type: "MODULE",
        label: `Module ${index}`,
      },
      {
        node_id: `ai:${String(index).padStart(5, "0")}`,
        node_type: "AI_MODEL_INVOCATION",
        label: `Invocation ${index}`,
        resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
      },
    ]).flat();
    const edges = Array.from({ length: flowCount }, (_, index) => ({
      edge_id: `edge:${String(index).padStart(5, "0")}`,
      source_node_id: `module:${String(index).padStart(5, "0")}`,
      target_node_id: `ai:${String(index).padStart(5, "0")}`,
      edge_type: "CALLS",
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));

    const result = await projectGraph({ nodes, edges });
    const payloadBytes = Buffer.byteLength(JSON.stringify(result.paths));
    const omittedGroupSummaries = result.paths.usage_flow_groups.filter(
      (group) => group.rendered_usage_flow_count === 0,
    );

    expect(result.paths.usage_flow_count).toBe(flowCount);
    expect(result.paths.rendered_usage_flow_count).toBe(64);
    expect(result.paths.omitted_usage_flow_count).toBe(flowCount - 64);
    expect(result.paths.usage_group_count).toBe(flowCount);
    expect(result.paths.rendered_usage_group_count).toBe(64);
    expect(result.paths.omitted_usage_group_count).toBe(flowCount - 64);
    expect(result.paths.usage_flow_groups).toHaveLength(68);
    expect(omittedGroupSummaries).toHaveLength(4);
    expect(result.paths.nodes.length).toBeLessThanOrEqual(128);
    expect(payloadBytes).toBeLessThan(80_000);
  });

  it("keeps every module usage group represented before filling overflow slots", async () => {
    const moduleASeeds = Array.from({ length: 64 }, (_, index) => ({
      node_id: `ai:a-${String(index).padStart(2, "0")}`,
      node_type: "AI_MODEL_INVOCATION",
      label: `A invocation ${index}`,
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));
    const moduleBSeeds = Array.from({ length: 6 }, (_, index) => ({
      node_id: `ai:z-${String(index).padStart(2, "0")}`,
      node_type: "AI_MODEL_INVOCATION",
      label: `B invocation ${index}`,
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));
    const nodes = [
      { node_id: "module:a", node_type: "MODULE", label: "Module A" },
      { node_id: "module:b", node_type: "MODULE", label: "Module B" },
      ...moduleASeeds,
      ...moduleBSeeds,
    ];
    const edges = [
      ...moduleASeeds.map((seed) => ({
        edge_id: `edge:${seed.node_id}`,
        source_node_id: "module:a",
        target_node_id: seed.node_id,
        edge_type: "CALLS",
        resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
      })),
      ...moduleBSeeds.map((seed) => ({
        edge_id: `edge:${seed.node_id}`,
        source_node_id: "module:b",
        target_node_id: seed.node_id,
        edge_type: "CALLS",
        resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
      })),
    ];

    const result = await projectGraph({ nodes, edges });
    const renderedIds = result.paths.nodes.map((node) => node.id);
    const moduleBGroup = result.paths.usage_flow_groups.find(
      (group) => group.source_node_id === "module:b",
    );

    expect(result.paths.usage_flow_count).toBe(70);
    expect(result.paths.rendered_usage_flow_count).toBe(64);
    expect(result.paths.omitted_usage_flow_count).toBe(6);
    expect(result.paths.usage_group_count).toBe(2);
    expect(result.paths.rendered_usage_group_count).toBe(2);
    expect(result.paths.omitted_usage_group_count).toBe(0);
    expect(renderedIds).toContain("module:a");
    expect(renderedIds).toContain("module:b");
    expect(renderedIds.some((id) => id.startsWith("ai:z-"))).toBe(true);
    expect(moduleBGroup).toMatchObject({
      label: "Module B -> AI_MODEL_INVOCATION",
      usage_flow_count: 6,
      rendered_usage_flow_count: 1,
      omitted_usage_flow_count: 5,
    });
  });

  it("keeps provider groups represented before lower-priority same-group overflow", async () => {
    const openAiSeeds = Array.from({ length: 40 }, (_, index) => ({
      node_id: `ai:a-openai-${String(index).padStart(2, "0")}`,
      node_type: "AI_MODEL_INVOCATION",
      label: `OpenAI invocation ${index}`,
      attributes: { provider: "OPENAI" },
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));
    const anthropicSeeds = Array.from({ length: 40 }, (_, index) => ({
      node_id: `ai:z-anthropic-${String(index).padStart(2, "0")}`,
      node_type: "AI_MODEL_INVOCATION",
      label: `Anthropic invocation ${index}`,
      attributes: { provider: "ANTHROPIC" },
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));
    const nodes = [
      { node_id: "module:shared", node_type: "MODULE", label: "AI module" },
      ...openAiSeeds,
      ...anthropicSeeds,
    ];
    const edges = [...openAiSeeds, ...anthropicSeeds].map((seed) => ({
      edge_id: `edge:${seed.node_id}`,
      source_node_id: "module:shared",
      target_node_id: seed.node_id,
      edge_type: "CALLS",
      resolution_state: AI_DISCOVERY_RESOLUTION_STATES.observed,
    }));

    const result = await projectGraph({ nodes, edges });
    const providers = result.paths.usage_flow_groups.map(
      (group) => group.provider_label,
    );

    expect(result.paths.usage_flow_count).toBe(80);
    expect(result.paths.rendered_usage_flow_count).toBe(64);
    expect(result.paths.omitted_usage_flow_count).toBe(16);
    expect(result.paths.usage_group_count).toBe(2);
    expect(result.paths.rendered_usage_group_count).toBe(2);
    expect(result.paths.omitted_usage_group_count).toBe(0);
    expect(providers).toEqual(expect.arrayContaining(["OPENAI", "ANTHROPIC"]));
    expect(
      result.paths.usage_flow_groups.every(
        (group) => group.rendered_usage_flow_count > 0,
      ),
    ).toBe(true);
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
    expect(first.paths.nodes).toEqual([]);
    first.paths.usage_flow_count = 99;
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
    expect(second.paths.usage_flow_count).toBe(0);
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

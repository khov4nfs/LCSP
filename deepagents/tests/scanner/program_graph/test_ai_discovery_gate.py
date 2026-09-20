from __future__ import annotations

from pathlib import Path

from tools.common.capabilities.evidence.graph.construction.assembly.builder import (
    ProgramGraphBuilder,
)
from tools.common.capabilities.evidence.graph.construction.extraction.extractor import (
    RepositorySemanticExtractor,
)
from tools.common.capabilities.evidence.graph.lineage.ai.ai_discovery import (
    AIDiscoveryEnricher,
    summarize_ai_discovery,
)
from tools.common.capabilities.evidence.graph.lineage.ai.ai_invocation_gate import (
    AIInvocationSemanticGate,
)
from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)


def _discovery(
    tmp_path: Path,
    source: str,
    *,
    filename: str = "app.ts",
    coverage_note: str | None = None,
):
    (tmp_path / filename).write_text(source, encoding="utf-8")
    program = RepositorySemanticExtractor(tmp_path).extract()
    AIInvocationSemanticGate().enrich(program)
    AIDiscoveryEnricher(tmp_path).enrich(program)
    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
    )
    builder.add_program(program)
    if coverage_note:
        builder.add_coverage_note(coverage_note)
    return summarize_ai_discovery(builder.build())


def test_direct_sdk_invocation_is_confirmed_and_persists_only_snippet_metadata(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function summarize(input: string) {
  return client.responses.create({ model: process.env.OPENAI_MODEL, input });
}
""",
    )

    assert discovery["gate"] == "AI_CONFIRMED"
    finding = next(
        item
        for item in discovery["findings"]
        if item["state"] == "CONFIRMED_AI_CALL"
    )
    assert finding["kind"] == "SDK_INVOCATION"
    assert finding["clarification_kind"] == "AI_PURPOSE_FEATURE_MAPPING"
    assert finding["snippet_ref"]["file_path"] == "app.ts"
    assert finding["snippet_ref"]["commit_sha"] == "abc123"
    assert "source" not in finding
    assert "raw_source" not in finding


def test_known_provider_rest_signature_is_confirmed(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function ask(messages: unknown[]) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5", messages })
  });
}
""",
    )

    assert discovery["gate"] == "AI_CONFIRMED"
    outbound = next(
        item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API"
    )
    assert outbound["state"] == "CONFIRMED_AI_CALL"
    assert outbound["provider"] == "OPENAI"
    assert outbound["host"] == "api.openai.com"


def test_custom_gateway_remains_unresolved_and_provider_is_not_guessed(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
const gatewayUrl = process.env.MODEL_GATEWAY_URL;
export async function ask(messages: unknown[]) {
  return fetch(gatewayUrl, {
    method: "POST",
    body: JSON.stringify({ model: "customer-model", messages })
  });
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API"
    )
    assert finding["state"] == "POSSIBLE_AI_CALL"
    assert finding["clarification_kind"] == "OUTBOUND_AI_CONFIRMATION"
    assert finding["clarification_owner"] == "CUSTOMER"
    assert finding["endpoint_source"] == "ENV:MODEL_GATEWAY_URL"
    assert "provider" not in finding


def test_httpx_async_client_instance_custom_gateway_is_not_false_absence(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
import httpx
import os

async def ask(model, messages):
    async with httpx.AsyncClient() as client:
        return await client.post(
            os.getenv("MODEL_GATEWAY_URL"),
            json={"model": model, "messages": messages},
        )
""",
        filename="app.py",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API"
    )
    assert finding["state"] == "POSSIBLE_AI_CALL"
    assert finding["endpoint_source"] == "ENV:MODEL_GATEWAY_URL"
    assert finding["method"] == "POST"


def test_requests_session_instance_custom_gateway_is_not_false_absence(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
import os
import requests

def ask(model, messages):
    session = requests.Session()
    return session.post(
        os.getenv("MODEL_GATEWAY_URL"),
        json={"model": model, "messages": messages},
    )
""",
        filename="app.py",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API"
    )
    assert finding["state"] == "POSSIBLE_AI_CALL"
    assert finding["endpoint_source"] == "ENV:MODEL_GATEWAY_URL"
    assert finding["method"] == "POST"


def test_axios_created_client_custom_gateway_is_not_false_absence(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
import axios from "axios";
const api = axios.create({ baseURL: process.env.MODEL_GATEWAY_URL });
export async function ask(model: string, messages: unknown[]) {
  return api.post("/v1/chat/completions", { model, messages });
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API"
    )
    assert finding["state"] == "POSSIBLE_AI_CALL"
    assert finding["endpoint_source"] == "ENV:MODEL_GATEWAY_URL"
    assert finding["method"] == "POST"


def test_unproven_instance_http_client_with_ai_shaped_dynamic_target_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function ask(client: unknown, model: string, messages: unknown[]) {
  return client.post(process.env.MODEL_GATEWAY_URL, { model, messages });
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )
    assert not any(
        item["kind"] == "OUTBOUND_API"
        and item["clarification_owner"] == "CUSTOMER"
        for item in discovery["findings"]
    )


def test_instance_http_clients_are_typed_as_http_by_semantic_extractor(
    tmp_path: Path,
) -> None:
    (tmp_path / "python_client.py").write_text(
        """
import httpx
import requests

async def send(url):
    async with httpx.AsyncClient() as client:
        await client.post(url)
    session = requests.Session()
    session.post(url)
""",
        encoding="utf-8",
    )
    (tmp_path / "axios_client.ts").write_text(
        'import axios from "axios";\nconst api = axios.create();\napi.post(endpoint);\n',
        encoding="utf-8",
    )

    program = RepositorySemanticExtractor(tmp_path).extract()
    instance_calls = {
        node.label: node
        for node in program.nodes
        if node.label in {"client.post", "session.post", "api.post"}
    }

    assert set(instance_calls) == {"client.post", "session.post", "api.post"}
    assert all(
        node.attributes.get("integrationType") == "HTTP"
        for node in instance_calls.values()
    )


def test_feature_flag_alias_guards_invocation_and_asks_only_runtime_fact(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
const aiEnabled = process.env.ENABLE_AI === "true";
export async function summarize(text: string) {
  if (!aiEnabled) return text;
  return client.responses.create({
    model: process.env.OPENAI_MODEL,
    input: text
  });
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item
        for item in discovery["findings"]
        if item["state"] == "CONFIRMED_AI_CALL"
    )
    assert finding["runtime_guard"] == "ENABLE_AI"
    assert finding["clarification_kind"] == "AI_RUNTIME_REACHABILITY"
    assert finding["clarification_owner"] == "CUSTOMER"


def test_config_object_feature_flag_guards_ai_invocation(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
const flags = loadRuntimeConfig();
export async function summarize(text: string) {
  if (flags.aiAssistantEnabled) {
    return client.responses.create({ model: "gpt-5", input: text });
  }
  return text;
}
""",
    )

    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert discovery["gate"] == "AI_UNKNOWN"
    assert finding["runtime_guard"] == "flags.aiAssistantEnabled"
    assert finding["clarification_kind"] == "AI_RUNTIME_REACHABILITY"


def test_parameter_propagated_feature_flag_guards_ai_invocation(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}
""",
    )

    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert discovery["gate"] == "AI_UNKNOWN"
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "AI_RUNTIME_REACHABILITY"


def test_di_backed_feature_flag_guards_ai_invocation(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
export class AiService {
  constructor(private readonly runtimeConfig: RuntimeConfig) {}

  async summarize(text: string) {
    if (this.runtimeConfig.features.aiAssistantEnabled) {
      return client.responses.create({ model: "gpt-5", input: text });
    }
    return text;
  }
}
""",
    )

    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert discovery["gate"] == "AI_UNKNOWN"
    assert finding["runtime_guard"] == "this.runtimeConfig.features.aiAssistantEnabled"
    assert finding["clarification_kind"] == "AI_RUNTIME_REACHABILITY"


def test_non_ai_rest_call_is_not_promoted_and_ready_graph_can_confirm_absence(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function charge(amount: number) {
  return fetch("https://payments.example.com/v1/charges", {
    method: "POST",
    body: JSON.stringify({ amount })
  });
}
""",
    )

    assert discovery["coverage_state"] == "READY"
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert discovery["findings"] == []


def test_partial_coverage_never_becomes_ai_absent_confirmed(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        "export function add(a: number, b: number) { return a + b; }",
        coverage_note="dynamic module unavailable",
    )

    assert discovery["coverage_state"] == "PARTIAL"
    assert discovery["gate"] == "AI_UNKNOWN"



def test_unmodeled_graphql_grpc_and_retrofit_clients_preserve_ai_frontier(
    tmp_path: Path,
) -> None:
    cases = (
        (
            "graphql",
            "client.ts",
            'import { GraphQLClient } from "graphql-request";\nconst client = new GraphQLClient(endpoint);\n',
        ),
        (
            "grpc",
            "client.go",
            'conn, err := grpc.Dial(target, grpc.WithTransportCredentials(creds))\n',
        ),
        (
            "retrofit",
            "Gateway.kt",
            'val client = Retrofit.Builder().baseUrl(endpoint).build()\n',
        ),
    )

    for case_name, filename, source in cases:
        case_dir = tmp_path / case_name
        case_dir.mkdir()
        discovery = _discovery(case_dir, source, filename=filename)
        assert discovery["gate"] == "AI_UNKNOWN"
        assert discovery["coverage_state"] == "PARTIAL"
        assert discovery["material_unresolved_frontiers"]
        assert any(
            item["kind"] == "DYNAMIC_TARGET"
            and item["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
            for item in discovery["findings"]
        )


def test_dynamic_outbound_target_blocks_false_absence_until_pge_resolves_flow(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function forward(endpoint: string, request: unknown) {
  return fetch(endpoint, { method: "POST", body: JSON.stringify(request) });
}
""",
    )

    assert discovery["coverage_state"] == "PARTIAL"
    assert discovery["gate"] == "AI_UNKNOWN"
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
        for item in discovery["findings"]
    )


def test_unsupported_source_language_preserves_unresolved_ai_frontier(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        "def charge(amount)\n  BillingClient.charge(amount)\nend\n",
        filename="billing.rb",
    )

    assert discovery["coverage_state"] == "PARTIAL"
    assert discovery["gate"] == "AI_UNKNOWN"
    assert discovery["material_unresolved_frontiers"]
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )

def test_lookalike_provider_domain_is_not_confirmed(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function ask(messages: unknown[]) {
  return fetch("https://api.openai.com.attacker.example/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-5", messages })
  });
}
""",
    )

    finding = next(item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API")
    assert discovery["gate"] == "AI_UNKNOWN"
    assert finding["state"] == "POSSIBLE_AI_CALL"
    assert "provider" not in finding


def test_unrelated_provider_url_in_request_window_does_not_bind_dynamic_target(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function forward(target: string, messages: unknown[]) {
  return fetch(target, {
    headers: { "x-docs": "https://api.openai.com/v1/chat/completions" },
    body: JSON.stringify({ model: "custom", messages })
  });
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    assert not any(
        item["kind"] == "OUTBOUND_API"
        and (item.get("provider") or item.get("host"))
        for item in discovery["findings"]
    )
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_nearby_unrelated_feature_flag_is_not_emitted_as_guard(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
const aiEnabled = process.env.ENABLE_AI === "true";
export async function summarize(text: string) {
  if (aiEnabled) { console.log("telemetry"); }
  return client.responses.create({ model: process.env.OPENAI_MODEL, input: text });
}
""",
    )

    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert discovery["gate"] == "AI_CONFIRMED"
    assert "runtime_guard" not in finding


def test_same_line_feature_flag_is_a_verified_guard(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function summarize(text: string) {
  if (process.env.ENABLE_AI) return client.responses.create({ model: "gpt-5", input: text });
  return text;
}
""",
    )

    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert discovery["gate"] == "AI_UNKNOWN"
    assert finding["runtime_guard"] == "ENABLE_AI"


def test_go_and_rust_http_sources_remain_partial_until_deterministically_modeled(tmp_path: Path) -> None:
    cases = (
        ("client.go", 'http.Post("https://api.openai.com/v1/chat/completions", "application/json", body)\n'),
        ("client.rs", 'reqwest::Client::new().post("https://api.openai.com/v1/chat/completions").send().await;\n'),
    )
    for filename, source in cases:
        case_dir = tmp_path / filename.replace(".", "-")
        case_dir.mkdir()
        discovery = _discovery(case_dir, source, filename=filename)
        assert discovery["coverage_state"] == "PARTIAL"
        assert discovery["gate"] == "AI_UNKNOWN"
        assert discovery["material_unresolved_frontiers"]


def test_targeted_scope_does_not_scan_excluded_ai_source(tmp_path: Path) -> None:
    (tmp_path / "safe.ts").write_text(
        'export const add = (a: number, b: number) => a + b;\n', encoding="utf-8"
    )
    (tmp_path / "excluded.ts").write_text(
        'client.responses.create({ model: "gpt-5", input: "x" });\n', encoding="utf-8"
    )
    scope = ("safe.ts",)
    program = RepositorySemanticExtractor(tmp_path).extract(include_files=scope)
    AIInvocationSemanticGate().enrich(program)
    AIDiscoveryEnricher(tmp_path, include_files=scope).enrich(program)
    builder = ProgramGraphBuilder(
        tmp_path, scan_job_id="scan-scope", snapshot_id="snapshot-scope", commit_sha="scope123"
    )
    builder.add_program(program)
    discovery = summarize_ai_discovery(builder.build())

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert discovery["findings"] == []


def test_source_seeded_graphql_frontier_is_reconciled_after_trusted_non_ai_resolution(tmp_path: Path) -> None:
    (tmp_path / "client.ts").write_text(
        'const client = new GraphQLClient(endpoint);\nclient.request(query);\n',
        encoding="utf-8",
    )
    program = SemanticProgram(
        nodes=[
            SemanticNodeFact(
                "graphql-call", "CALL_SITE", "GraphQLClient", "client.ts", 1, 1
            ),
            SemanticNodeFact(
                "billing-handler", "FUNCTION", "loadInvoices", "billing.ts", 3, 8
            ),
        ],
        edges=[SemanticEdgeFact("RESOLVES_TO", "graphql-call", "billing-handler")],
    )
    enricher = AIDiscoveryEnricher(tmp_path)
    enricher.enrich(program)
    assert program.unresolved_frontiers
    enricher.finalize(program)
    builder = ProgramGraphBuilder(
        tmp_path, scan_job_id="scan-reconcile", snapshot_id="snapshot-reconcile", commit_sha="abc123"
    )
    builder.add_program(program)
    discovery = summarize_ai_discovery(builder.build())

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert discovery["material_unresolved_frontiers"] == []


def _graph_discovery(tmp_path: Path, nodes, edges):
    program = SemanticProgram(nodes=list(nodes), edges=list(edges))
    AIDiscoveryEnricher(tmp_path).finalize(program)
    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="scan-graph",
        snapshot_id="snapshot-graph",
        commit_sha="deadbeef",
    )
    builder.add_program(program)
    return summarize_ai_discovery(builder.build())


def test_pge_parameter_and_config_propagation_preserves_ai_frontier(tmp_path: Path) -> None:
    discovery = _graph_discovery(
        tmp_path,
        [
            SemanticNodeFact("env", "ENV_SOURCE", "AI_GATEWAY_URL", "config.ts", 1, 1),
            SemanticNodeFact("parameter", "PARAMETER", "endpoint", "client.ts", 3, 3),
            SemanticNodeFact("messages", "PARAMETER", "messages", "client.ts", 3, 3),
            SemanticNodeFact("helper", "FUNCTION", "postGateway", "client.ts", 3, 8),
            SemanticNodeFact("outbound", "EXTERNAL_API", "custom gateway", "client.ts", 7, 7),
            SemanticNodeFact(
                "dynamic",
                "UNRESOLVED_DYNAMIC_TARGET",
                "runtime endpoint",
                "client.ts",
                7,
                7,
                resolution_state="UNRESOLVED",
            ),
        ],
        [
            SemanticEdgeFact("ASSIGNS", "env", "parameter"),
            SemanticEdgeFact("PASSES_ARGUMENT", "parameter", "helper"),
            SemanticEdgeFact("PASSES_ARGUMENT", "messages", "helper"),
            SemanticEdgeFact("CALLS_EXTERNAL", "helper", "outbound"),
            SemanticEdgeFact("RESOLVES_TO", "outbound", "dynamic", resolution_state="UNRESOLVED"),
        ],
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    assert discovery["material_unresolved_frontiers"]
    assert not any(
        item["kind"] == "OUTBOUND_API"
        and item.get("clarification_owner") == "CUSTOMER"
        for item in discovery["findings"]
    )
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_pge_helper_di_cross_module_chain_reaches_provider_client(tmp_path: Path) -> None:
    discovery = _graph_discovery(
        tmp_path,
        [
            SemanticNodeFact(
                "provider",
                "SDK_CLIENT",
                "OpenAIClient",
                "infra/openai.ts",
                2,
                2,
                attributes={"semanticRole": "PROVIDER_OPENAI"},
            ),
            SemanticNodeFact("service", "CLASS", "AiService", "services/ai.ts", 1, 12),
            SemanticNodeFact("helper", "FUNCTION", "complete", "services/helper.ts", 4, 8),
            SemanticNodeFact("gateway", "EXTERNAL_API", "service gateway", "api/controller.ts", 10, 10),
        ],
        [
            SemanticEdgeFact("DEPENDS_ON", "service", "provider"),
            SemanticEdgeFact("CALLS", "helper", "service"),
            SemanticEdgeFact("HANDLED_BY", "gateway", "helper"),
        ],
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    assert any(item["kind"] == "OUTBOUND_API" for item in discovery["findings"])


def test_pge_graphql_grpc_and_cross_language_service_boundaries_are_not_absence(tmp_path: Path) -> None:
    discovery = _graph_discovery(
        tmp_path,
        [
            SemanticNodeFact("graphql", "GRAPHQL_OPERATION", "aiCompletion", "web/query.ts", 4, 4),
            SemanticNodeFact("prompt", "PARAMETER", "prompt", "web/query.ts", 4, 4),
            SemanticNodeFact("grpc", "GRPC_METHOD", "InferenceGateway.Generate", "proto/ai.proto", 8, 8),
            SemanticNodeFact("go-helper", "FUNCTION", "invokeRemote", "service/invoke.go", 12, 20),
            SemanticNodeFact("rust-client", "FUNCTION", "llm_transport", "worker/src/client.rs", 7, 16),
        ],
        [
            SemanticEdgeFact("PASSES_ARGUMENT", "prompt", "graphql"),
            SemanticEdgeFact("CALLS_API", "graphql", "grpc"),
            SemanticEdgeFact("HANDLED_BY", "grpc", "go-helper"),
            SemanticEdgeFact("CALLS", "go-helper", "rust-client"),
        ],
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    kinds = [item["kind"] for item in discovery["findings"]]
    assert "OUTBOUND_API" in kinds
    assert len([item for item in discovery["findings"] if item["kind"] == "OUTBOUND_API"]) >= 2



def test_graph_walk_does_not_cross_shared_caller_into_sibling_ai_call(tmp_path: Path) -> None:
    discovery = _graph_discovery(
        tmp_path,
        [
            SemanticNodeFact("caller", "FUNCTION", "run", "app.ts", 1, 10),
            SemanticNodeFact(
                "ai",
                "SDK_CLIENT",
                "OpenAIClient",
                "ai.ts",
                1,
                1,
                attributes={"semanticRole": "PROVIDER_OPENAI"},
            ),
            SemanticNodeFact("billing", "EXTERNAL_API", "billing API", "billing.ts", 4, 4),
        ],
        [
            SemanticEdgeFact("CALLS", "caller", "ai"),
            SemanticEdgeFact("CALLS_EXTERNAL", "caller", "billing"),
        ],
    )

    assert not any(
        item["kind"] == "OUTBOUND_API" and item.get("endpoint_source") == "PGE_MULTI_HOP"
        for item in discovery["findings"]
    )


def test_unresolved_graph_edge_stays_technical_instead_of_customer_confirmation(tmp_path: Path) -> None:
    discovery = _graph_discovery(
        tmp_path,
        [
            SemanticNodeFact("boundary", "EXTERNAL_API", "gateway", "api.ts", 1, 1),
            SemanticNodeFact(
                "unknown",
                "UNRESOLVED_DYNAMIC_TARGET",
                "openai messages endpoint",
                "api.ts",
                1,
                1,
                resolution_state="UNRESOLVED",
            ),
        ],
        [
            SemanticEdgeFact(
                "RESOLVES_TO",
                "boundary",
                "unknown",
                coverage_state="LIMITED",
                resolution_state="UNRESOLVED",
            )
        ],
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    assert any(item["clarification_owner"] == "TECHNICAL" for item in discovery["findings"])
    assert not any(
        item["kind"] == "OUTBOUND_API" and item["clarification_owner"] == "CUSTOMER"
        for item in discovery["findings"]
    )


def test_exact_hop_limit_without_unseen_neighbor_does_not_create_false_frontier(tmp_path: Path) -> None:
    nodes = [SemanticNodeFact("boundary", "EXTERNAL_API", "gateway", "api.ts", 1, 1)]
    edges = []
    previous = "boundary"
    for index in range(1, 13):
        key = f"hop-{index}"
        nodes.append(SemanticNodeFact(key, "FUNCTION", f"hop{index}", "api.ts", index + 1, index + 1))
        edges.append(SemanticEdgeFact("CALLS", previous, key))
        previous = key
    nodes.append(
        SemanticNodeFact(
            "ai-capability", "AI_CAPABILITY", "openai messages", "api.ts", 20, 20
        )
    )
    # Replace the final ordinary hop with the trusted AI endpoint exactly at depth 12.
    edges[-1] = SemanticEdgeFact("CALLS", "hop-11", "ai-capability")
    nodes = [node for node in nodes if node.key != "hop-12"]

    discovery = _graph_discovery(tmp_path, nodes, edges)

    assert not any(
        "MAX_GRAPH_HOPS_REACHED" in str(item)
        for item in discovery["findings"]
    )
    assert discovery["material_unresolved_frontiers"] == []



def test_generic_graphql_transport_without_ai_semantics_still_allows_absence(tmp_path: Path) -> None:
    discovery = _graph_discovery(
        tmp_path,
        [
            SemanticNodeFact("graphql", "GRAPHQL_OPERATION", "getInvoices", "billing/query.ts", 4, 4),
            SemanticNodeFact("invoice", "PARAMETER", "invoiceId", "billing/query.ts", 4, 4),
        ],
        [SemanticEdgeFact("PASSES_ARGUMENT", "invoice", "graphql")],
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert discovery["findings"] == []


def test_shadowed_python_http_client_does_not_inherit_other_scope_provenance(
    tmp_path: Path,
) -> None:
    source = """
import httpx

async def ordinary(url):
    client = httpx.AsyncClient()
    return await client.post(url)

async def unrelated(client):
    return await client.post(
        "https://api.openai.com/v1/chat/completions",
        json={"model": "gpt-5", "messages": []},
    )
"""
    (tmp_path / "app.py").write_text(source, encoding="utf-8")
    program = RepositorySemanticExtractor(tmp_path).extract()
    client_calls = [
        node
        for node in program.nodes
        if node.label == "client.post" and node.key.startswith("call:")
    ]
    assert len(client_calls) == 2
    assert client_calls[0].attributes.get("integrationType") == "HTTP"
    assert client_calls[1].attributes.get("integrationType") is None

    discovery = _discovery(tmp_path, source, filename="app.py")
    assert discovery["gate"] == "AI_UNKNOWN"
    assert not any(
        item["kind"] == "OUTBOUND_API"
        for item in discovery["findings"]
    )
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_mutable_config_object_guard_remains_unknown_without_closed_def_use(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
const flags = { aiAssistantEnabled: false };
function summarize(text: string) {
  if (flags.aiAssistantEnabled) {
    return client.responses.create({ model: "gpt-5", input: text });
  }
  return text;
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["runtime_guard"] == "flags.aiAssistantEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_config_object_mutation_through_called_sibling_remains_unknown(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
const flags = { aiAssistantEnabled: false };
function enableAI() { flags.aiAssistantEnabled = true; }
function summarize(text: string) {
  if (flags.aiAssistantEnabled) {
    return client.responses.create({ model: "gpt-5", input: text });
  }
  return text;
}
enableAI();
summarize("x");
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["runtime_guard"] == "flags.aiAssistantEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_local_literal_false_caller_resolves_unreachable_with_trusted_pge_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
async function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}

summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_aliased_function_invocation_with_conflicting_bool_remains_unknown(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
async function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}

const run = summarize;
summarize("hello", false);
run("x", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_local_literal_true_caller_resolves_reachable_with_trusted_pge_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
async function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}

summarize("hello", true);
""",
    )

    assert discovery["gate"] == "AI_CONFIRMED"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "AI_PURPOSE_FEATURE_MAPPING"
    assert finding["clarification_owner"] == "CUSTOMER"
    assert not any(item["kind"] == "DYNAMIC_TARGET" for item in discovery["findings"])


def test_same_name_functions_across_modules_do_not_cross_contaminate_parameter_proof(
    tmp_path: Path,
) -> None:
    (tmp_path / "a.ts").write_text(
        """
function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}
summarize("a", false);
""",
        encoding="utf-8",
    )
    (tmp_path / "b.ts").write_text(
        """
function summarize(text: string, aiEnabled: boolean) {
  return aiEnabled ? text : text;
}
summarize("b", true);
""",
        encoding="utf-8",
    )
    program = RepositorySemanticExtractor(tmp_path).extract()
    AIInvocationSemanticGate().enrich(program)
    AIDiscoveryEnricher(tmp_path).enrich(program)
    builder = ProgramGraphBuilder(
        tmp_path,
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
    )
    builder.add_program(program)
    discovery = summarize_ai_discovery(builder.build())

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])


def test_local_js_call_is_governed_by_resolves_to_edge(tmp_path: Path) -> None:
    (tmp_path / "app.ts").write_text(
        """
function summarize(text: string, aiEnabled: boolean) {
  return text;
}
summarize("hello", false);
""",
        encoding="utf-8",
    )
    program = RepositorySemanticExtractor(tmp_path).extract()

    symbol = next(
        node
        for node in program.nodes
        if node.key == "symbol:app.ts:summarize"
        and node.node_type == "FUNCTION"
    )
    call = next(
        node
        for node in program.nodes
        if node.key == "call:app.ts:5:summarize"
        and node.node_type == "CALL_SITE"
    )
    assert symbol.attributes["externalReachability"] == "REPOSITORY_LOCAL"
    assert any(
        edge.edge_type == "RESOLVES_TO"
        and edge.source_key == call.key
        and edge.target_key == symbol.key
        for edge in program.edges
    )


def test_exported_js_function_does_not_claim_closed_repository_call_set(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
export async function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}
summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["clarification_kind"] == "AI_RUNTIME_REACHABILITY"
    assert finding["clarification_owner"] == "CUSTOMER"


def test_js_local_resolution_requires_lexical_scope_access(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
function outer() {
  async function summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_callback_escape_keeps_local_parameter_guard_unknown(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
async function summarize(text: string, aiEnabled: boolean) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}

registerCallback(summarize);
summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_nested_python_literal_false_helper_resolves_statically(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
def outer():
    def summarize(text, ai_enabled):
        if ai_enabled:
            return client.responses.create(model="gpt-5", input=text)
        return text

    return summarize("hello", False)

outer()
""",
        filename="app.py",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_nested_python_literal_true_helper_resolves_statically(tmp_path: Path) -> None:
    discovery = _discovery(
        tmp_path,
        """
def outer():
    def summarize(text, ai_enabled):
        if ai_enabled:
            return client.responses.create(model="gpt-5", input=text)
        return text

    return summarize("hello", True)

outer()
""",
        filename="app.py",
    )

    assert discovery["gate"] == "AI_CONFIRMED"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["runtime_guard"] == "ai_enabled"
    assert finding["clarification_kind"] == "AI_PURPOSE_FEATURE_MAPPING"


def test_python_nested_callable_has_local_pge_identity_independent_of_name(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text(
        """
def outer():
    def summarize(text, ai_enabled):
        return text
    return summarize("hello", False)
""",
        encoding="utf-8",
    )
    program = RepositorySemanticExtractor(tmp_path).extract()

    symbol = next(
        node
        for node in program.nodes
        if node.label == "summarize" and node.start_line == 3
    )
    call = next(
        node
        for node in program.nodes
        if node.label == "summarize"
        and node.node_type == "CALL_SITE"
        and node.start_line == 5
    )
    assert symbol.attributes["externalReachability"] == "REPOSITORY_LOCAL"
    assert any(
        edge.edge_type == "RESOLVES_TO"
        and edge.source_key == call.key
        and edge.target_key == symbol.key
        for edge in program.edges
    )


def test_python_top_level_underscore_name_is_not_treated_as_private_proof(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
def _summarize(text, ai_enabled):
    if ai_enabled:
        return client.responses.create(model="gpt-5", input=text)
    return text

_summarize("hello", False)
""",
        filename="app.py",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION")
    assert finding["clarification_kind"] == "AI_RUNTIME_REACHABILITY"
    assert finding["clarification_owner"] == "CUSTOMER"


def test_immutable_scalar_const_guard_can_still_resolve_without_mutation_surface(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
const aiAssistantEnabled = false;
function summarize(text: string) {
  if (aiAssistantEnabled) {
    return client.responses.create({ model: "gpt-5", input: text });
  }
  return text;
}
""",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])


def test_shadowed_typescript_http_client_does_not_inherit_other_scope_provenance(
    tmp_path: Path,
) -> None:
    source = """
import axios from "axios";

function ordinary() {
  const api = axios.create();
  return api.post("https://payments.example.com/v1/charges", { amount: 1 });
}

function unrelated(api: unknown) {
  return api.post("https://api.openai.com/v1/chat/completions", {
    model: "gpt-5", messages: []
  });
}
"""
    (tmp_path / "app.ts").write_text(source, encoding="utf-8")
    program = RepositorySemanticExtractor(tmp_path).extract()
    api_calls = [
        node
        for node in program.nodes
        if node.label == "api.post" and node.key.startswith("call:")
    ]
    assert len(api_calls) == 2
    assert api_calls[0].attributes.get("integrationType") == "HTTP"
    assert api_calls[1].attributes.get("integrationType") is None

    discovery = _discovery(tmp_path, source)
    assert discovery["gate"] == "AI_UNKNOWN"
    assert not any(item["kind"] == "OUTBOUND_API" for item in discovery["findings"])
    assert any(
        item["kind"] == "DYNAMIC_TARGET"
        and item["clarification_owner"] == "TECHNICAL"
        for item in discovery["findings"]
    )


def test_local_arrow_literal_false_resolves_unreachable_with_trusted_pge_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
const summarize = async (text: string, aiEnabled: boolean) => {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
};

summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_local_arrow_literal_true_resolves_reachable_with_trusted_pge_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
const summarize = async (text: string, aiEnabled: boolean) => {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
};

summarize("hello", true);
""",
    )

    assert discovery["gate"] == "AI_CONFIRMED"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "AI_PURPOSE_FEATURE_MAPPING"
    assert finding["clarification_owner"] == "CUSTOMER"


def test_local_class_method_literal_false_resolves_unreachable_before_interview(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_local_class_method_literal_true_resolves_reachable_before_interview(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("hello", true);
""",
    )

    assert discovery["gate"] == "AI_CONFIRMED"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "AI_PURPOSE_FEATURE_MAPPING"
    assert finding["clarification_owner"] == "CUSTOMER"


def test_optional_chain_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);
service?.summarize("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_bracket_literal_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);
service["summarize"]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_template_literal_computed_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);
service[`summarize`]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_dynamic_element_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
service[method]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_same_class_receiver_alias_dynamic_call_still_breaks_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
const secondService = new AiService();
const alias = secondService;
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_typed_asserted_and_parenthesized_receiver_aliases_break_closure(
    tmp_path: Path,
) -> None:
    alias_declarations = (
        "const alias: AiService = service;",
        "const alias = service as AiService;",
        "const alias = (service);",
    )

    for alias_declaration in alias_declarations:
        discovery = _discovery(
            tmp_path,
            f"""
class AiService {{
  summarize(text: string, aiEnabled: boolean) {{
    if (!aiEnabled) return text;
    return client.responses.create({{ model: "gpt-5", input: text }});
  }}
}}

const service = new AiService();
{alias_declaration}
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""",
        )

        assert discovery["gate"] == "AI_UNKNOWN", alias_declaration
        finding = next(
            item
            for item in discovery["findings"]
            if item["kind"] == "SDK_INVOCATION"
        )
        assert (
            finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
        ), alias_declaration
        assert finding["clarification_owner"] == "TECHNICAL", alias_declaration


def test_later_receiver_alias_assignments_break_closure(tmp_path: Path) -> None:
    alias_flows = (
        "let alias: AiService;\nalias = service;",
        "let alias = recorder;\nalias = service;",
    )

    for alias_flow in alias_flows:
        discovery = _discovery(
            tmp_path,
            f"""
class AiService {{
  summarize(text: string, aiEnabled: boolean) {{
    if (!aiEnabled) return text;
    return client.responses.create({{ model: "gpt-5", input: text }});
  }}
}}

const service = new AiService();
{alias_flow}
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""",
        )

        assert discovery["gate"] == "AI_UNKNOWN", alias_flow
        finding = next(
            item
            for item in discovery["findings"]
            if item["kind"] == "SDK_INVOCATION"
        )
        assert (
            finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
        ), alias_flow
        assert finding["clarification_owner"] == "TECHNICAL", alias_flow


def test_conditional_receiver_alias_flows_break_closure(tmp_path: Path) -> None:
    alias_declarations = (
        "const alias = useAi ? service : recorder;",
        "const alias = useAi as boolean ? recorder : service;",
        "const alias = maybeService ?? service;",
    )

    for alias_declaration in alias_declarations:
        discovery = _discovery(
            tmp_path,
            f"""
class AiService {{
  summarize(text: string, aiEnabled: boolean) {{
    if (!aiEnabled) return text;
    return client.responses.create({{ model: "gpt-5", input: text }});
  }}
}}

const service = new AiService();
const recorder = new LocalRecorder();
{alias_declaration}
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""",
        )

        assert discovery["gate"] == "AI_UNKNOWN", alias_declaration
        finding = next(
            item
            for item in discovery["findings"]
            if item["kind"] == "SDK_INVOCATION"
        )
        assert (
            finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
        ), alias_declaration
        assert finding["clarification_owner"] == "TECHNICAL", alias_declaration


def test_dynamic_template_element_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
const suffix = "marize";
service.summarize("closed", false);
service[`sum${suffix}`]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_unrelated_dynamic_element_call_does_not_break_closed_method_call_set(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);

function dispatch(action: string) {
  handlers[action]();
}
""",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])
    assert not any(
        item.get("clarification_kind") == "TARGETED_TECHNICAL_REANALYSIS"
        for item in discovery["findings"]
    )


def test_parenthesized_computed_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);
(service)["summarize"]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_optional_element_true_call_breaks_false_method_call_set_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);
service?.["summarize"]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_dynamic_optional_element_call_preserves_unresolved_method_frontier(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
service?.[method]("runtime", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_parameter_shadow_does_not_reuse_outer_instance_receiver_identity(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);

function run(service: LocalRecorder) {
  service.summarize("shadowed", true);
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_owner"] == "TECHNICAL"


def test_local_declaration_shadow_does_not_reuse_outer_instance_receiver_identity(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
service.summarize("closed", false);

function run() {
  const service = recorder;
  service.summarize("shadowed", true);
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_owner"] == "TECHNICAL"


def test_second_declarator_shadow_does_not_fabricate_class_method_identity(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();

function run() {
  const marker = 1, service = recorder;
  service.summarize("local-only", true);
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"


def test_reassignment_invalidates_instance_receiver_identity(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

let service = new AiService();
service.summarize("closed", false);
service = recorder;
service.summarize("reassigned", true);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["clarification_owner"] == "TECHNICAL"


def test_multiline_function_and_method_signatures_resolve_parameter_guards(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
async function summarize(
  text: string,
  aiEnabled: boolean,
) {
  if (!aiEnabled) return text;
  return client.responses.create({ model: "gpt-5", input: text });
}

class AiService {
  summarize(
    text: string,
    aiEnabled: boolean,
  ) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

summarize("function", false);
const service = new AiService();
service.summarize("method", false);
""",
    )

    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"
    assert not any(item["kind"] == "SDK_INVOCATION" for item in discovery["findings"])
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_di_incomplete_method_dispatch_stays_technical_not_customer_runtime(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

function run(service: AiService) {
  return service.summarize("hello", false);
}
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_aliased_service_receiver_dispatch_stays_technical_not_customer_runtime(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
const alias = service;
alias.summarize("hello", false);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )


def test_dynamic_method_dispatch_stays_technical_not_customer_runtime(
    tmp_path: Path,
) -> None:
    discovery = _discovery(
        tmp_path,
        """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}

const service = new AiService();
const method = "summarize";
service[method]("hello", false);
""",
    )

    assert discovery["gate"] == "AI_UNKNOWN"
    finding = next(
        item for item in discovery["findings"] if item["kind"] == "SDK_INVOCATION"
    )
    assert finding["runtime_guard"] == "aiEnabled"
    assert finding["clarification_kind"] == "TARGETED_TECHNICAL_REANALYSIS"
    assert finding["clarification_owner"] == "TECHNICAL"
    assert not any(
        item.get("clarification_kind") == "AI_RUNTIME_REACHABILITY"
        for item in discovery["findings"]
    )



def test_receiver_provenance_tracks_lexical_binding_and_reassignment_interval(
    tmp_path: Path,
) -> None:
    source = """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    return text;
  }
}

const service = new AiService();
service.summarize("outer-proven", false);

function parameterShadow(service: LocalRecorder) {
  service.summarize("param-shadow", true);
}

function localShadow() {
  const service = recorder;
  service.summarize("local-shadow", true);
}

function unrelated() {
  let service = recorder;
  service = anotherRecorder;
  service.summarize("unrelated-local", true);
}

function multiDeclaratorShadow() {
  const marker = 1, service = recorder;
  service.summarize("multi-shadow", true);
}

function multilineDeclaratorShadow() {
  const marker = 1,
    service = recorder;
  service.summarize("multiline-shadow", true);
}

function destructuredShadow() {
  const { service } = recorder;
  service.summarize("destructure-shadow", true);
}

service.summarize("outer-after-shadows", false);

let mutable = new AiService();
mutable.summarize("before-reassign", false);
mutable = recorder;
mutable.summarize("after-reassign", true);

const alias = service;
alias.summarize("alias-call", true);
"""
    (tmp_path / "app.ts").write_text(source, encoding="utf-8")
    program = RepositorySemanticExtractor(tmp_path).extract()
    method = next(
        node
        for node in program.nodes
        if node.node_type == "METHOD" and node.label == "summarize"
    )

    def targets_for_marker(marker: str) -> set[str]:
        line_no = next(
            index
            for index, line in enumerate(source.splitlines(), start=1)
            if marker in line
        )
        call = next(
            node
            for node in program.nodes
            if node.node_type == "CALL_SITE" and node.start_line == line_no
        )
        return {
            edge.target_key
            for edge in program.edges
            if edge.edge_type == "RESOLVES_TO" and edge.source_key == call.key
        }

    assert targets_for_marker("outer-proven") == {method.key}
    assert targets_for_marker("param-shadow") == set()
    assert targets_for_marker("local-shadow") == set()
    assert targets_for_marker("unrelated-local") == set()
    assert targets_for_marker("multi-shadow") == set()
    assert targets_for_marker("multiline-shadow") == set()
    assert targets_for_marker("destructure-shadow") == set()
    assert targets_for_marker("outer-after-shadows") == {method.key}
    assert targets_for_marker("before-reassign") == {method.key}
    assert targets_for_marker("after-reassign") == set()
    assert targets_for_marker("alias-call") == set()


def test_arrow_and_method_calls_have_canonical_pge_identity_and_parameters(
    tmp_path: Path,
) -> None:
    (tmp_path / "app.ts").write_text(
        """
const summarizeArrow = async (text: string, aiEnabled: boolean) => {
  return text;
};

class AiService {
  summarize(text: string, aiEnabled: boolean) {
    return text;
  }
}

summarizeArrow("arrow", false);
const service = new AiService();
service.summarize("method", false);
""",
        encoding="utf-8",
    )
    program = RepositorySemanticExtractor(tmp_path).extract()
    node_by_key = {node.key: node for node in program.nodes}

    arrow = next(
        node
        for node in program.nodes
        if node.node_type == "FUNCTION" and node.label == "summarizeArrow"
    )
    method = next(
        node
        for node in program.nodes
        if node.node_type == "METHOD" and node.label == "summarize"
    )
    assert arrow.attributes["externalReachability"] == "REPOSITORY_LOCAL"
    assert method.attributes["ownerClass"] == "AiService"

    arrow_params = [
        node_by_key[edge.target_key].label
        for edge in program.edges
        if edge.edge_type == "HAS_PARAMETER" and edge.source_key == arrow.key
    ]
    method_params = [
        node_by_key[edge.target_key].label
        for edge in program.edges
        if edge.edge_type == "HAS_PARAMETER" and edge.source_key == method.key
    ]
    assert arrow_params == ["text", "aiEnabled"]
    assert method_params == ["text", "aiEnabled"]
    assert any(
        edge.edge_type == "RESOLVES_TO"
        and edge.target_key == arrow.key
        and node_by_key[edge.source_key].label == "summarizeArrow"
        for edge in program.edges
    )
    assert any(
        edge.edge_type == "RESOLVES_TO"
        and edge.target_key == method.key
        and node_by_key[edge.source_key].label == "service.summarize"
        for edge in program.edges
    )


def test_function_return_receiver_flow_keeps_dynamic_dispatch_technical(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function pickService() { return service; }
const alias = pickService();
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_parameter_receiver_flow_keeps_dynamic_dispatch_technical(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function dispatch(receiver: AiService) {
  const method = "summarize";
  receiver[method]("runtime", true);
}
service.summarize("closed", false);
dispatch(service);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unrelated_helper_receiver_flow_does_not_poison_closed_method(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function pickRecorder() { return recorder; }
const unrelated = pickRecorder();
service.summarize("closed", false);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_resolved_foreign_class_method_does_not_poison_target_closure(tmp_path: Path) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
class OtherService {
  summarize(text: string, aiEnabled: boolean) { return text; }
}
const service = new AiService();
const other = new OtherService();
service.summarize("closed", false);
other.summarize("other", true);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_conditional_return_receiver_flow_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
function pickService() {
  return useAi ? service : recorder;
}
const alias = pickService();
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_nullish_return_receiver_flow_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function pickService() {
  return maybeService ?? service;
}
const alias = pickService();
const method = "summarize";
service.summarize("closed", false);
alias[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_call_result_computed_receiver_flow_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function pickService() {
  return useAi ? service : recorder;
}
const method = "summarize";
service.summarize("closed", false);
pickService()[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unrelated_conditional_return_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function pickRecorder() {
  return useRecorder ? recorder : other;
}
const unrelated = pickRecorder();
service.summarize("closed", false);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_lexical_shadow_receiver_flow_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function unrelated() {
  const service = recorder;
  const alias = service;
  const method = "summarize";
  alias[method]("local", true);
}
service.summarize("closed", false);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_unrelated_parameter_receiver_flow_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function unrelated(service: LocalRecorder) {
  const alias = service;
  const method = "summarize";
  alias[method]("local", true);
}
service.summarize("closed", false);
unrelated(recorder);
    """)
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_nested_same_name_parameter_receiver_flow_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function outer(receiver: LocalRecorder) {
  function inner(receiver: AiService) {
    const alias = receiver;
    const method = "summarize";
    alias[method]("runtime", true);
  }
  inner(service);
}
service.summarize("closed", false);
outer(recorder);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unrelated_same_name_parameter_direct_dispatch_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function unrelated(service: LocalRecorder) {
  const method = "flush";
  service[method]();
}
service.summarize("closed", false);
unrelated(recorder);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_unrelated_same_name_local_direct_dispatch_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
function unrelated() {
  const service = recorder;
  const method = "flush";
  service[method]();
}
service.summarize("closed", false);
unrelated();
    """)
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_this_computed_dispatch_inside_owner_class_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
  dispatch(method: string) {
    this[method]("runtime", true);
  }
}
const service = new AiService();
service.summarize("closed", false);
service.dispatch("summarize");
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_member_projection_of_governed_receiver_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
const method = "summarize";
service.summarize("closed", false);
holder.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_factory_call_result_receiver_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
class Factory {
  pickService() {
    return service;
  }
}
const service = new AiService();
const factory = new Factory();
const method = "summarize";
service.summarize("closed", false);
factory.pickService()[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_new_owner_class_call_result_receiver_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
new AiService()[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_foreign_this_computed_dispatch_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
class OtherService {
  dispatch(method: string) {
    this[method]("foreign", true);
  }
}
const service = new AiService();
const other = new OtherService();
service.summarize("closed", false);
other.dispatch("summarize");
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_foreign_member_projection_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { recorder };
const method = "flush";
service.summarize("closed", false);
holder.recorder[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_foreign_factory_call_result_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
class OtherService {
  summarize(text: string, aiEnabled: boolean) {
    return text;
  }
}
class Factory {
  pickService() {
    return other;
  }
}
const service = new AiService();
const other = new OtherService();
const factory = new Factory();
const method = "summarize";
service.summarize("closed", false);
factory.pickService()[method]("foreign", true);
    """)
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_asserted_receiver_wrapper_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
(service as AiService)[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_nonnull_receiver_wrapper_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
service![method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_grouped_factory_call_result_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
class Factory {
  pickService() {
    return service;
  }
}
const service = new AiService();
const factory = new Factory();
const method = "summarize";
service.summarize("closed", false);
(factory.pickService())[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_grouped_owner_constructor_result_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
(new AiService())[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_mixed_object_foreign_member_projection_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const holder = { service, recorder };
const method = "flush";
service.summarize("closed", false);
holder.recorder[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_mixed_object_governed_member_projection_keeps_dynamic_dispatch_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const holder = { service: service, recorder: recorder };
const method = "summarize";
service.summarize("closed", false);
holder.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_conditional_unresolved_receiver_containing_service_breaks_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const flag = runtimeFlag();
const method = "summarize";
service.summarize("closed", false);
(flag ? service : recorder)[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_logical_unresolved_receiver_containing_service_breaks_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const enabled = runtimeFlag();
const method = "summarize";
service.summarize("closed", false);
(enabled && service || recorder)[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_multiline_asserted_receiver_breaks_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
(service as AiService)
  [method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unresolved_foreign_receiver_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const foreign = new LocalRecorder();
const flag = runtimeFlag();
const method = "flush";
service.summarize("closed", false);
(flag ? foreign : recorder)[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_property_write_preserves_governed_member_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const method = "summarize";
holder.service = service;
service.summarize("closed", false);
holder.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_foreign_property_write_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const holder = {};
const method = "flush";
holder.recorder = recorder;
service.summarize("closed", false);
holder.recorder[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_dynamic_property_write_preserves_receiver_uncertainty(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const property = runtimeProperty();
const method = "summarize";
holder[property] = service;
service.summarize("closed", false);
holder.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_holder_alias_property_write_reaches_original_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const alias = holder;
const method = "summarize";
alias.service = service;
service.summarize("closed", false);
holder.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_original_property_write_reaches_holder_alias_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const alias = holder;
const method = "summarize";
holder.service = service;
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_dynamic_property_write_through_holder_alias_stays_uncertain(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const alias = holder;
const property = runtimeProperty();
const method = "summarize";
alias[property] = service;
service.summarize("closed", false);
holder.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unrelated_holder_aliases_with_same_property_stay_isolated(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const foreign = {};
const recorder = new LocalRecorder();
const method = "flush";
holder.service = service;
foreign.service = recorder;
service.summarize("closed", false);
foreign.service[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_multiline_computed_receiver_expression_breaks_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const method = "summarize";
service.summarize("closed", false);
service
  [
    method
  ]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_multiline_foreign_computed_receiver_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const method = "flush";
service.summarize("closed", false);
recorder
  [
    method
  ]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_over_budget_computed_key_preserves_receiver_uncertainty(
    tmp_path: Path,
) -> None:
    long_key = "x" * 300
    discovery = _discovery(tmp_path, f"""
class AiService {{
  summarize(text: string, aiEnabled: boolean) {{
    if (!aiEnabled) return text;
    return client.responses.create({{ model: "gpt-5", input: text }});
  }}
}}
const service = new AiService();
service.summarize("closed", false);
service["{long_key}"]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unbalanced_computed_receiver_preserves_technical_frontier(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
service.summarize("closed", false);
service[
  method("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unbalanced_receiver_ignores_later_unrelated_closing_bracket(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
service.summarize("closed", false);
service[
  method("runtime", true);
const values = [0];
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_nested_object_literal_projection_reaches_computed_dispatch(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { nested: { service } };
const method = "summarize";
service.summarize("closed", false);
holder.nested.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_nested_property_write_reaches_computed_dispatch(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const method = "summarize";
holder.nested.service = service;
service.summarize("closed", false);
holder.nested.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_nested_foreign_projection_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const holder = { nested: { recorder } };
const method = "flush";
service.summarize("closed", false);
holder.nested.recorder[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_nested_projection_through_holder_alias_preserves_identity(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { nested: { service } };
const alias = holder;
const method = "summarize";
service.summarize("closed", false);
alias.nested.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_transitive_holder_alias_projection_preserves_identity(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let holder = { nested: { service } };
const firstAlias = holder;
const secondAlias = firstAlias;
holder = {};
const method = "summarize";
service.summarize("closed", false);
secondAlias.nested.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_index_read_followed_by_unrelated_call_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
service.summarize("closed", false);
service[0];
logStatus();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_index_string_read_followed_by_unrelated_call_does_not_poison_closed_method(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
service.summarize("closed", false);
service["status"];
foo();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_dynamic_middle_projection_segment_reaches_computed_dispatch(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = {};
const property = runtimeProperty();
const method = "summarize";
holder[property].service = service;
service.summarize("closed", false);
holder.foo.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_computed_object_literal_projection_reaches_dispatch(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { [runtimeProperty()]: { service } };
const method = "summarize";
service.summarize("closed", false);
holder.foo.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unrelated_dynamic_middle_projection_stays_closed(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
const holder = {};
const property = runtimeProperty();
const method = "flush";
holder[property].recorder = recorder;
service.summarize("closed", false);
holder.foo.recorder[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_reassigned_holder_alias_to_foreign_object_does_not_poison_closure(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let alias = holder;
alias = {};
const method = "flush";
service.summarize("closed", false);
alias.service[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_unknown_holder_alias_reassignment_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let alias = holder;
alias = maybeHolder();
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_holder_alias_dispatch_before_later_reassignment_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let alias = holder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
alias = {};
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_comment_assignment_does_not_break_holder_alias_flow(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let alias = holder;
// alias = recorder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_block_comment_assignment_does_not_break_holder_alias_flow(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let alias = holder;
/* alias = recorder; */
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_source_rebinding_after_alias_capture_preserves_snapshot(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let holder = { service };
const alias = holder;
holder = {};
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_intermediate_alias_rebinding_after_downstream_capture_preserves_snapshot(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let firstAlias = holder;
const secondAlias = firstAlias;
firstAlias = {};
const method = "summarize";
service.summarize("closed", false);
secondAlias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_three_hop_alias_snapshot_survives_middle_rebinding(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let firstAlias = holder;
let secondAlias = firstAlias;
const thirdAlias = secondAlias;
secondAlias = {};
const method = "summarize";
service.summarize("closed", false);
thirdAlias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_intermediate_rebinding_before_downstream_capture_uses_new_value(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let firstAlias = holder;
firstAlias = {};
const secondAlias = firstAlias;
const method = "summarize";
service.summarize("closed", false);
secondAlias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_unresolved_source_value_at_alias_capture_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let holder = { service };
holder = maybeHolder();
const alias = holder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unresolved_intermediate_alias_at_capture_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let holder = { service };
holder = maybeHolder();
const firstAlias = holder;
const secondAlias = firstAlias;
const method = "summarize";
service.summarize("closed", false);
secondAlias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_source_rebinding_before_alias_capture_uses_new_value(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let holder = { service };
holder = {};
const alias = holder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_identifier_rebinding_before_alias_capture_does_not_leak_old_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
let holder = { service };
const recorderHolder = { recorder };
holder = recorderHolder;
const alias = holder;
const method = "flush";
service.summarize("closed", false);
alias.service[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_identifier_rebinding_to_governed_holder_before_alias_capture_is_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
let holder = { recorder };
const serviceHolder = { service };
holder = serviceHolder;
const alias = holder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_later_same_property_write_after_rebind_preserves_old_alias_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
let holder = { service };
const alias = holder;
holder = {};
holder.service = recorder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_later_same_property_write_on_foreign_constructor_preserves_old_alias_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
let holder = { service };
const alias = holder;
holder = new ForeignHolder();
holder.service = recorder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_new_alias_after_rebind_uses_new_same_property_projection(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
let holder = { service };
const oldAlias = holder;
holder = {};
holder.service = recorder;
const newAlias = holder;
const method = "flush";
service.summarize("closed", false);
newAlias.service[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_foreign_old_projection_rebound_to_governed_same_property_is_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const recorder = new LocalRecorder();
let holder = { service: recorder };
holder = {};
holder.service = service;
const alias = holder;
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_foreign_constructor_reassignment_can_close_projection_dispatch(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let alias = null;
alias = new LocalRecorder();
const method = "flush";
service.summarize("closed", false);
alias.service[method]();
""")
    assert discovery["gate"] == "AI_ABSENT_CONFIRMED"


def test_same_name_reassignment_in_nested_scope_does_not_cross_bindings(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
const holder = { service };
let alias = holder;
function unrelated() {
  let alias = {};
  alias.service = new LocalRecorder();
}
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_container_constructor_with_governed_value_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let alias = null;
alias = new Holder(service);
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_multiline_container_reassignment_stays_technical(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
let alias = null;
alias = {
  service,
};
const method = "summarize";
service.summarize("closed", false);
alias.service[method]("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unbalanced_receiver_ignores_bracket_in_line_comment(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
service.summarize("closed", false);
service[
  // ] generated source is incomplete
  method("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"


def test_unbalanced_receiver_ignores_bracket_in_block_comment(
    tmp_path: Path,
) -> None:
    discovery = _discovery(tmp_path, """
class AiService {
  summarize(text: string, aiEnabled: boolean) {
    if (!aiEnabled) return text;
    return client.responses.create({ model: "gpt-5", input: text });
  }
}
const service = new AiService();
service.summarize("closed", false);
service[
  /* ] generated source is incomplete */
  method("runtime", true);
""")
    assert discovery["gate"] == "AI_UNKNOWN"

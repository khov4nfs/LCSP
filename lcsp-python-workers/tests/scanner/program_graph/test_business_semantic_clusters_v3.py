from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from lcsp_workers.scanner.program_graph.assembler import ProgramGraphAssembler
from lcsp_workers.scanner.program_graph.business_semantic_enrichment import (
    BusinessSemanticEnricher,
)


class _FakeLlm:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def complete_with_tools(self, prompt: str, **kwargs):
        self.prompts.append(prompt)
        # The production contract sends one compact JSON context after the prompt
        # preamble. Parse that contract instead of tokenizing the string: replacing ':'
        # destroyed canonical ``node:<id>`` refs and made the fake submit invalid
        # provenance even though the clustered context itself was correct.
        context = json.loads(prompt.rsplit("\n\n", 1)[1])
        support = next(
            str(node["nodeId"])
            for node in context["nodes"]
            if str(node.get("nodeId") or "").startswith("node:")
        )
        index = len(self.prompts)
        return SimpleNamespace(
            tool_calls=[
                SimpleNamespace(
                    name="submit_business_semantics",
                    arguments={
                        "nodes": [
                            {
                                "proposalNodeId": "process",
                                "nodeType": "BUSINESS_PROCESS",
                                "label": f"Business process {index}",
                                "supportRefs": [support],
                            }
                        ],
                        "edges": [],
                    },
                )
            ]
        )


def _graph(tmp_path: Path):
    (tmp_path / "app.py").write_text(
        '''
@app.post("/first")
def first(payload):
    return repository.save(payload)

@app.post("/second")
def second(payload):
    return repository.save(payload)
''',
        encoding="utf-8",
    )
    return ProgramGraphAssembler().assemble(
        scan_job_id="scan-cluster",
        snapshot_id="snapshot-cluster",
        commit_sha="cluster-sha",
        workspace_path=tmp_path,
    )


def test_business_enrichment_clusters_independent_entrypoints(tmp_path: Path) -> None:
    graph = _graph(tmp_path)
    llm = _FakeLlm()

    enriched = BusinessSemanticEnricher(llm).enrich(
        graph,
        workflow_run_id="workflow-cluster",
    )

    assert len(llm.prompts) >= 2
    assert any('"entrypointLabel":"POST /first"' in prompt for prompt in llm.prompts)
    assert any('"entrypointLabel":"POST /second"' in prompt for prompt in llm.prompts)
    semantic = [
        node
        for node in enriched.nodes
        if node.get("origin") == "LLM_SEMANTIC_ENRICHMENT"
        and node.get("node_type") == "BUSINESS_PROCESS"
    ]
    assert len(semantic) >= 2
    assert all(node.get("support_refs") for node in semantic)


def test_later_cluster_cannot_use_prior_llm_node_as_provenance(tmp_path: Path) -> None:
    graph = _graph(tmp_path)
    technical_support = BusinessSemanticEnricher._technical_support_refs(graph)
    first_payload = {
        "nodes": [
            {
                "proposalNodeId": "first_process",
                "nodeType": "BUSINESS_PROCESS",
                "label": "First process",
                "supportRefs": [next(iter(sorted(technical_support)))],
            }
        ],
        "edges": [],
    }
    first, added, _ = BusinessSemanticEnricher.validate_and_merge(
        graph,
        first_payload,
        trusted_support_refs=technical_support,
        base_graph_id=graph.graph_id,
    )
    assert added == 1
    semantic_ref = next(
        node["node_id"]
        for node in first.nodes
        if node.get("origin") == "LLM_SEMANTIC_ENRICHMENT"
    )

    second_payload = {
        "nodes": [
            {
                "proposalNodeId": "self_supported",
                "nodeType": "BUSINESS_PROCESS",
                "label": "Self supported process",
                "supportRefs": [semantic_ref],
            }
        ],
        "edges": [],
    }
    second, added_again, _ = BusinessSemanticEnricher.validate_and_merge(
        first,
        second_payload,
        trusted_support_refs=technical_support,
        base_graph_id=graph.graph_id,
    )

    assert second is first
    assert added_again == 0


def test_cluster_namespacing_prevents_local_proposal_id_collision() -> None:
    payload = {
        "nodes": [
            {
                "proposalNodeId": "process",
                "nodeType": "BUSINESS_PROCESS",
                "label": "A process",
                "supportRefs": ["node:technical"],
            }
        ],
        "edges": [
            {
                "edgeType": "PART_OF_PROCESS",
                "sourceRef": "node:technical",
                "targetRef": "proposal:process",
                "supportRefs": ["node:technical"],
            }
        ],
    }

    first = BusinessSemanticEnricher._namespace_payload(payload, "cluster-a")
    second = BusinessSemanticEnricher._namespace_payload(payload, "cluster-b")

    first_id = first["nodes"][0]["proposalNodeId"]
    second_id = second["nodes"][0]["proposalNodeId"]
    assert first_id != second_id
    assert first["edges"][0]["targetRef"] == f"proposal:{first_id}"
    assert second["edges"][0]["targetRef"] == f"proposal:{second_id}"

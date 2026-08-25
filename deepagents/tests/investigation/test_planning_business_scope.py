from __future__ import annotations

from types import SimpleNamespace

from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket
from tools.common.capabilities.assessment.planning.engineering_rule.planning_business_scope import (
    BusinessAwareScopedEngineeringRulePlanningCandidate,
    BusinessAwareScopedMaterialEngineeringRulePlanner,
    RulePlanningBusinessScopeProjector,
)
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph


def _node(
    node_id: str,
    node_type: str,
    label: str,
    *,
    origin: str = "STATIC_ANALYSIS",
    resolution_state: str = "OBSERVED",
    support_refs: list[str] | None = None,
    semantic_types: list[str] | None = None,
) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "label": label,
        "source": {"file_path": "src/app.py", "symbol_ref": label},
        "attributes": {},
        "semantic_types": list(semantic_types or []),
        "evidence_refs": [f"evidence:{node_id}"],
        "coverage_state": "SUFFICIENT",
        "origin": origin,
        "resolution_state": resolution_state,
        "support_refs": list(support_refs or []),
    }


def _edge(edge_id: str, edge_type: str, source: str, target: str) -> dict:
    return {
        "edge_id": edge_id,
        "edge_type": edge_type,
        "source_node_id": source,
        "target_node_id": target,
        "confidence": 1.0,
        "attributes": {},
        "evidence_refs": [f"evidence:{edge_id}"],
        "coverage_state": "SUFFICIENT",
        "origin": "STATIC_ANALYSIS",
        "resolution_state": "OBSERVED",
        "support_refs": [],
    }


def _graph(*, with_human_review: bool = True) -> ProgramEvidenceGraph:
    nodes = [
        _node("ai", "AI_OUTPUT", "risk score"),
        _node(
            "process",
            "BUSINESS_PROCESS",
            "Loan application assessment",
            origin="LLM_SEMANTIC_ENRICHMENT",
            resolution_state="CORROBORATED",
            support_refs=["evidence:ai"],
        ),
        _node(
            "decision",
            "BUSINESS_DECISION",
            "Applicant eligibility",
            origin="LLM_SEMANTIC_ENRICHMENT",
            resolution_state="CORROBORATED",
            support_refs=["evidence:ai"],
        ),
        _node(
            "subject",
            "DATA_SUBJECT",
            "Applicant",
            origin="LLM_SEMANTIC_ENRICHMENT",
            resolution_state="CORROBORATED",
            support_refs=["evidence:ai"],
        ),
        _node(
            "capability",
            "AI_CAPABILITY",
            "Risk scoring",
            origin="LLM_SEMANTIC_ENRICHMENT",
            resolution_state="CORROBORATED",
            support_refs=["evidence:ai"],
        ),
        _node(
            "sensitive",
            "SENSITIVE_DATA",
            "Financial profile",
            semantic_types=["SENSITIVE.FINANCIAL"],
        ),
        _node("repo", "REPOSITORY_ACCESS", "applicationRepository.update"),
        _node(
            "unrelated",
            "BUSINESS_PROCESS",
            "Healthcare triage",
            origin="LLM_SEMANTIC_ENRICHMENT",
            resolution_state="CORROBORATED",
            support_refs=["evidence:other"],
        ),
    ]
    edges = [
        _edge("e1", "INFLUENCES_DECISION", "ai", "decision"),
        _edge("e2", "WRITES_BUSINESS_STATE", "decision", "repo"),
        _edge("e3", "PART_OF_PROCESS", "decision", "process"),
        _edge("e4", "AFFECTS_SUBJECT", "decision", "subject"),
        _edge("e5", "USES_DATA", "decision", "sensitive"),
        _edge("e6", "INVOKES_AI", "process", "capability"),
    ]
    if with_human_review:
        nodes.append(
            _node(
                "human",
                "HUMAN_REVIEW",
                "Manual eligibility review",
            )
        )
        edges.append(_edge("e7", "REQUIRES_HUMAN_REVIEW", "decision", "human"))
    return ProgramEvidenceGraph(
        graph_id="graph-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
        graph_hash="sha256:graph",
        schema_version="3.0.0",
    )


def _packet() -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-loan",
        concept="AI-assisted eligibility decision",
        investigation_goals=("Trace AI decision influence",),
        initial_results=(
            {
                "query": "ai-output",
                "nodes": [_node("ai", "AI_OUTPUT", "risk score")],
                "evidenceRefs": ["evidence:ai"],
                "materialHitCount": 1,
                "unresolvedFrontiers": [],
            },
        ),
        starting_node_types=("AI_OUTPUT",),
        target_node_types=("BUSINESS_DECISION",),
        graph_queries=(
            {
                "name": "ai-output",
                "startNodeTypes": ["AI_OUTPUT"],
                "semanticTypes": [],
            },
        ),
        evidence_refs=("evidence:ai",),
        required_evidence=("DECISION_PATH",),
    )


def _rule():
    return SimpleNamespace(
        engineering_rule_id="eng-loan",
        concept="AI-assisted eligibility decision",
        legal_intent={},
        investigation_goals=("Trace AI decision influence",),
        required_evidence=("DECISION_PATH",),
        starting_node_types=("AI_OUTPUT",),
        target_node_types=("BUSINESS_DECISION",),
    )


def test_rule_planning_business_scope_projects_connected_semantics() -> None:
    scope = RulePlanningBusinessScopeProjector(_graph()).project(_packet())

    assert scope.business_processes == ("Loan application assessment",)
    assert scope.business_decisions == ("Applicant eligibility",)
    assert scope.affected_subjects == ("Applicant",)
    assert "Financial profile" in scope.data_categories
    assert "SENSITIVE.FINANCIAL" in scope.data_categories
    assert scope.ai_capabilities == ("Risk scoring",)
    assert scope.decision_influence_state == "HUMAN_IN_LOOP_PRESENT"
    assert scope.human_oversight_state == "PRESENT"
    assert "Healthcare triage" not in scope.business_processes
    assert "evidence:ai" in scope.material_source_refs


def test_rule_planning_business_scope_detects_bounded_no_human_path() -> None:
    scope = RulePlanningBusinessScopeProjector(_graph(with_human_review=False)).project(
        _packet()
    )

    assert scope.decision_influence_state == "AUTOMATED_DECISION_CANDIDATE"
    assert scope.human_oversight_state == "ABSENT_WITH_BOUNDED_PATH"


def test_business_aware_candidate_exposes_semantics_to_planner_prompt() -> None:
    graph = _graph()
    candidate = BusinessAwareScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(),
        RulePlanningBusinessScopeProjector(graph),
    )
    payload = candidate.to_prompt_dict()

    assert payload["planningBusinessScope"]["businessProcesses"] == [
        "Loan application assessment"
    ]
    assert payload["planningBusinessScope"]["businessDecisions"] == [
        "Applicant eligibility"
    ]
    assert payload["planningBusinessScope"]["affectedSubjects"] == ["Applicant"]
    assert payload["planningBusinessScope"]["authority"] == (
        "TECHNICAL_INVESTIGATION_SCOPE_ONLY"
    )

    prompt = BusinessAwareScopedMaterialEngineeringRulePlanner._prompt(
        (candidate,),
        {"sector": "FINANCIAL_SERVICES"},
        graph,
    )
    assert "planningBusinessScope" in prompt
    assert "Loan application assessment" in prompt
    assert "not legal applicability" in prompt


def test_business_scope_rejects_llm_semantics_without_rule_material_support() -> None:
    graph = _graph()
    graph.nodes.append(
        _node(
            "deep-agent-process",
            "BUSINESS_PROCESS",
            "LCSP internal Deep Agent runtime operation",
            origin="LLM_SEMANTIC_ENRICHMENT",
            resolution_state="CORROBORATED",
            support_refs=["evidence:deep-agent-runtime"],
        )
    )
    graph.edges.append(
        _edge("e-deep-agent", "PART_OF_PROCESS", "ai", "deep-agent-process")
    )

    scope = RulePlanningBusinessScopeProjector(graph).project(_packet())

    assert "Loan application assessment" in scope.business_processes
    assert "LCSP internal Deep Agent runtime operation" not in scope.business_processes


def test_planner_prompt_excludes_internal_llm_runtime_from_graph_summary() -> None:
    graph = _graph()
    graph.nodes.append(
        {
            "node_id": "internal-provider",
            "node_type": "AI_PROVIDER",
            "label": "OpenAI provider used by LCSP worker",
            "source": {
                "file_path": (
                    "deepagents/tools/common/capabilities/assessment/investigation/"
                    "engineering_rule/investigator.py"
                ),
                "symbol_ref": "LangChainAgent",
            },
            "attributes": {},
            "semantic_types": [],
            "evidence_refs": ["evidence:internal-provider"],
            "coverage_state": "SUFFICIENT",
            "origin": "STATIC_ANALYSIS",
            "resolution_state": "OBSERVED",
            "support_refs": [],
        }
    )
    candidate = BusinessAwareScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(),
        RulePlanningBusinessScopeProjector(graph),
    )

    prompt = BusinessAwareScopedMaterialEngineeringRulePlanner._prompt(
        (candidate,),
        {"sector": "FINANCIAL_SERVICES"},
        graph,
    )

    assert '"AI_PROVIDER"' not in prompt
    assert "internalRuntimePolicy" in prompt

from __future__ import annotations

from types import SimpleNamespace

from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedBusinessContextStatement,
    ConfirmedStructuredBusinessContext,
)
from tools.common.capabilities.assessment.planning.engineering_rule.planning_business_scope import (
    BusinessAwareScopedEngineeringRulePlanningCandidate,
    BusinessAwareScopedMaterialEngineeringRulePlanner,
    RulePlanningBusinessScope,
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


def _confirmed_context() -> ConfirmedStructuredBusinessContext:
    return ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=3,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-sector",
                topic="sector",
                statement="FINANCIAL_SERVICES",
                normalized_value="FINANCIAL_SERVICES",
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:1",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-05T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
    )


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


def test_business_scope_defaults_unknown_when_decision_effect_was_not_evidenced() -> None:
    scope = RulePlanningBusinessScope()

    assert scope.decision_influence_state == "DECISION_PATH_UNRESOLVED"
    assert scope.human_oversight_state == "UNKNOWN"


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
        _confirmed_context(),
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
        _confirmed_context(),
        graph,
    )

    assert '"AI_PROVIDER"' not in prompt
    assert "internalRuntimePolicy" in prompt


def _empty_scope_graph() -> ProgramEvidenceGraph:
    nodes = [
        _node("ai", "AI_OUTPUT", "risk score"),
        _node("repo", "REPOSITORY_ACCESS", "applicationRepository.update"),
    ]
    return ProgramEvidenceGraph(
        graph_id="graph-empty-scope",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=len(nodes),
        edge_count=0,
        nodes=nodes,
        edges=[],
        graph_hash="sha256:graph",
        schema_version="3.0.0",
    )


def test_empty_rule_scoped_projection_does_not_drop_confirmed_interview_context() -> None:
    graph = _empty_scope_graph()
    projector = RulePlanningBusinessScopeProjector(graph)
    candidate = BusinessAwareScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(),
        projector,
    )
    scope_payload = candidate.to_prompt_dict()["planningBusinessScope"]

    assert scope_payload["businessProcesses"] == []
    assert scope_payload["businessDecisions"] == []
    assert scope_payload["affectedSubjects"] == []
    assert scope_payload["dataCategories"] == []
    assert scope_payload["aiCapabilities"] == []
    # Bounded graph with an AI seed but no decision edges yields an explicit
    # authoritative negative, not UNKNOWN substitution.
    assert scope_payload["decisionInfluenceState"] == "NO_DECISION_EFFECT_EVIDENCED"
    assert scope_payload["humanOversightState"] == "NO_DECISION_EFFECT_EVIDENCED"

    confirmed = ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=12,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-ai-usage-1",
                topic="ai_usage",
                statement="The service drafts onboarding recommendations.",
                normalized_value=True,
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:1",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-14T00:00:00Z",
                supersedes_statement_id=None,
            ),
            ConfirmedBusinessContextStatement(
                statement_id="stmt-affected-subjects-1",
                topic="affected_subjects",
                statement="Customers and their organizations.",
                normalized_value="CUSTOMERS_AND_ORGANIZATIONS",
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:2",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-14T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
    )

    prompt = BusinessAwareScopedMaterialEngineeringRulePlanner._prompt(
        (candidate,),
        confirmed,
        graph,
    )

    assert "stmt-ai-usage-1" in prompt
    assert "stmt-affected-subjects-1" in prompt
    assert "confirmedStructuredBusinessContext" in prompt
    assert "The service drafts onboarding recommendations." in prompt


def test_confirmed_negative_statement_stays_explicit_in_planner_prompt() -> None:
    graph = _graph()
    candidate = BusinessAwareScopedEngineeringRulePlanningCandidate.from_rule_packet(
        _rule(),
        _packet(),
        RulePlanningBusinessScopeProjector(graph),
    )
    confirmed = ConfirmedStructuredBusinessContext(
        assessment_id="assessment-1",
        context_revision=12,
        statements=(
            ConfirmedBusinessContextStatement(
                statement_id="stmt-decision-influence-1",
                topic="decision_influence",
                statement="No automated decision is made without human approval.",
                normalized_value=False,
                scope={"assessmentId": "assessment-1"},
                evidence_refs=("evidence:customer:3",),
                respondent_ref="actor:authenticated:1",
                created_at="2026-09-14T00:00:00Z",
                supersedes_statement_id=None,
            ),
        ),
    )

    prompt = BusinessAwareScopedMaterialEngineeringRulePlanner._prompt(
        (candidate,),
        confirmed,
        graph,
    )

    assert '"normalizedValue":false' in prompt
    assert '"normalizedValue":"UNKNOWN"' not in prompt

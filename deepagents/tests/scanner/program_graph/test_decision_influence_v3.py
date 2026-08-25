from __future__ import annotations

from pathlib import Path

from tools.common.capabilities.evidence.graph.construction.assembly.assembler import ProgramGraphAssembler
from tools.common.capabilities.evidence.graph.query.query_engine import ProgramGraphQueryEngine


def _graph(tmp_path: Path, source: str):
    (tmp_path / "decision.py").write_text(source, encoding="utf-8")
    return ProgramGraphAssembler().assemble(
        scan_job_id="scan-decision",
        snapshot_id="snapshot-decision",
        commit_sha="decision-sha",
        workspace_path=tmp_path,
    )


def _decision_summary(graph):
    engine = ProgramGraphQueryEngine(graph)
    invocation = engine.provider_invocations()[0]
    result = engine.inspect_decision_path(
        start_ref=str(invocation["node_id"]),
        max_hops=20,
        max_results=120,
    )
    return result.to_dict()["aiDecisionInfluence"], result


def test_ai_decision_persisted_without_human_is_automated_candidate(tmp_path: Path) -> None:
    graph = _graph(
        tmp_path,
        '''
from openai import OpenAI
client = OpenAI()

def evaluate(applicant):
    result = client.responses.create(input=applicant)
    decision = reject(result)
    repository.save(decision)
    return decision
''',
    )

    summary, result = _decision_summary(graph)

    assert any(node.get("node_type") == "BUSINESS_DECISION" for node in result.nodes)
    assert any(node.get("node_type") == "REPOSITORY_ACCESS" for node in result.nodes)
    assert summary["aiInfluencesDecision"] is True
    assert summary["aiPersistsDecision"] is True
    assert summary["humanInLoopPresent"] is False
    assert summary["boundedComplete"] is True
    assert summary["automatedDecisionCandidate"] is True
    assert summary["state"] == "AUTOMATED_DECISION_CANDIDATE"


def test_human_review_on_decision_path_prevents_automated_candidate(tmp_path: Path) -> None:
    graph = _graph(
        tmp_path,
        '''
from openai import OpenAI
client = OpenAI()

def evaluate(applicant):
    result = client.responses.create(input=applicant)
    decision = reject(result)
    reviewed = manual_review(decision)
    repository.save(reviewed)
    return reviewed
''',
    )

    summary, result = _decision_summary(graph)

    assert any(node.get("node_type") == "HUMAN_REVIEW" for node in result.nodes)
    assert summary["aiInfluencesDecision"] is True
    assert summary["aiPersistsDecision"] is True
    assert summary["humanInLoopPresent"] is True
    assert summary["automatedDecisionCandidate"] is False
    assert summary["state"] == "HUMAN_IN_LOOP_PRESENT"


def test_unresolved_framework_path_never_becomes_automated_candidate(tmp_path: Path) -> None:
    graph = _graph(
        tmp_path,
        '''
from openai import OpenAI
client = OpenAI()

def evaluate(applicant, registry, key):
    result = client.responses.create(input=applicant)
    decision = reject(result)
    handler = registry[key]
    handler(decision)
    return decision
''',
    )

    summary, result = _decision_summary(graph)

    assert result.unresolved_frontiers
    assert summary["boundedComplete"] is False
    assert summary["automatedDecisionCandidate"] is False
    assert summary["state"] == "DECISION_PATH_UNRESOLVED"

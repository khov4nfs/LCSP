from __future__ import annotations

import json

from conftest import use_model_routes
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from deepagents.backends import LocalShellBackend
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from tools.common.capabilities.evidence.repository_analysis import analyzer
from tools.common.capabilities.evidence.repository_analysis.analyzer import (
    RepositoryDeepAnalyzer,
)


def test_repository_deep_analyzer_runs_as_standalone_root_without_checkpointer(
    monkeypatch,
) -> None:
    """One bounded Deep Agent task for scan-time AI discovery.

    Repository hydration and Codebase Memory indexing happen before this boundary
    (middleware/system_event_dispatch.py); this task runs analyze() against the
    hydrated repository via the current LCSP repository sandbox backend.
    """
    calls: dict[str, object] = {}
    fake_agent = object()
    fake_backend = MagicMock()

    monkeypatch.setattr(analyzer, "configure_lcsp_harness", lambda: None)
    monkeypatch.setattr(
        analyzer,
        "resolve_agent_model",
        lambda role: "fake-model",
    )

    def fake_create_deep_agent(**kwargs):
        calls["create_kwargs"] = kwargs
        return fake_agent

    def fake_invoke_with_stream(agent, inputs, *, config, stage=None):
        calls["invoke"] = {
            "agent": agent,
            "inputs": inputs,
            "config": config,
            "stage": stage,
        }
        return {
            "structured_response": {
                "summary": "Repository inspected",
                "coverage_state": "PARTIAL",
                "coverage_notes": ["unit test"],
                "languages": [],
                "frameworks": [],
                "source_anchors": [],
                "ai_discovery": {
                    "gate": "AI_UNKNOWN",
                    "coverage_state": "PARTIAL",
                    "findings": [],
                    "material_unresolved_frontiers": ["not executed"],
                },
            }
        }

    monkeypatch.setattr(analyzer, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(analyzer, "invoke_with_stream", fake_invoke_with_stream)

    result = RepositoryDeepAnalyzer()._invoke(
        fake_backend,
        snapshot_id="snapshot-1",
        commit_sha="abc1234",
        scan_job_id="scan-1",
    )

    create_kwargs = calls["create_kwargs"]
    assert isinstance(create_kwargs, dict)
    assert create_kwargs["name"] == "ai-discovery-analyst"
    assert create_kwargs["backend"] is fake_backend
    assert "checkpointer" not in create_kwargs
    # Bounded scan-time AI discovery only: no EngineeringRule analysis.
    assert "Do not analyze EngineeringRules" in create_kwargs["system_prompt"]
    assert "Codebase Memory index" in create_kwargs["system_prompt"]
    assert "already built" in create_kwargs["system_prompt"]
    assert "inspect source before reporting" in create_kwargs["system_prompt"]
    assert "Stop as soon as those facts are sufficiently" in create_kwargs["system_prompt"]
    assert "Do not broadly understand the repository" in create_kwargs["system_prompt"]
    assert "return AI_UNKNOWN with coverage_state PARTIAL" in create_kwargs["system_prompt"]
    for legacy in ("Scanner", "Planner", "Investigator", "RuleDiscoveryTask"):
        assert legacy not in create_kwargs["system_prompt"]
    from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS

    assert create_kwargs["tools"] is CODEBASE_MEMORY_GRAPH_TOOLS
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    assert create_kwargs["response_format"] is RepositoryAnalysisResult
    middleware_names = {type(item).__name__ for item in create_kwargs["middleware"]}
    assert "AgentRunBudgetMiddleware" in middleware_names
    assert "AgentRoleMiddleware" in middleware_names
    invoke = calls["invoke"]
    assert isinstance(invoke, dict)
    assert invoke["agent"] is fake_agent
    assert invoke["config"]["configurable"]["thread_id"] == (
        "ai-discovery:scan-1"
    )
    from orchestration.agent_stream import AGENT_STREAM_STAGES

    assert invoke["stage"] == AGENT_STREAM_STAGES["scanner"]
    assert invoke["stage"] == "SCANNER"
    assert result.summary == "Repository inspected"


def test_repository_deep_analyzer_allows_more_than_two_model_calls(
    monkeypatch,
) -> None:
    calls: dict[str, object] = {}
    fake_agent = object()
    fake_backend = MagicMock()
    simulated_model_calls = 0

    monkeypatch.setattr(analyzer, "configure_lcsp_harness", lambda: None)
    monkeypatch.setattr(
        analyzer,
        "resolve_agent_model",
        lambda role: "fake-model",
    )

    def fake_create_deep_agent(**kwargs):
        calls["create_kwargs"] = kwargs
        return fake_agent

    def fake_invoke_with_stream(agent, inputs, *, config, stage=None):
        nonlocal simulated_model_calls
        for _ in range(3):
            simulated_model_calls += 1
        return {
            "structured_response": {
                "summary": "Repository inspected after extended analysis",
                "coverage_state": "PARTIAL",
                "coverage_notes": ["more than two model calls were required"],
                "languages": [],
                "frameworks": [],
                "source_anchors": [],
                "ai_discovery": {
                    "gate": "AI_UNKNOWN",
                    "coverage_state": "PARTIAL",
                    "findings": [],
                    "material_unresolved_frontiers": ["not executed"],
                },
            }
        }

    monkeypatch.setattr(analyzer, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(analyzer, "invoke_with_stream", fake_invoke_with_stream)

    result = RepositoryDeepAnalyzer()._invoke(
        fake_backend,
        snapshot_id="snapshot-1",
        commit_sha="abc1234",
        scan_job_id="scan-extended",
    )

    create_kwargs = calls["create_kwargs"]
    assert isinstance(create_kwargs, dict)
    middleware_names = {
        type(item).__name__ for item in create_kwargs["middleware"]
    }
    assert "ModelCallLimitMiddleware" not in middleware_names
    from middleware.agent_run_budget import AgentRunBudgetMiddleware

    budgets = [
        item
        for item in create_kwargs["middleware"]
        if isinstance(item, AgentRunBudgetMiddleware)
    ]
    assert len(budgets) == 1
    assert budgets[0].finalize_after == 12
    assert simulated_model_calls == 3
    assert result.summary == "Repository inspected after extended analysis"


def test_repository_deep_analyzer_revalidates_structured_response_contract(
    monkeypatch,
) -> None:
    fake_agent = object()
    fake_backend = MagicMock()

    monkeypatch.setattr(analyzer, "configure_lcsp_harness", lambda: None)
    monkeypatch.setattr(
        analyzer,
        "resolve_agent_model",
        lambda role: "fake-model",
    )
    monkeypatch.setattr(
        analyzer,
        "create_deep_agent",
        lambda **_kwargs: fake_agent,
    )
    # AI_ABSENT_CONFIRMED requires READY AI coverage: PARTIAL must fail closed.
    monkeypatch.setattr(
        analyzer,
        "invoke_with_stream",
        lambda *_args, **_kwargs: {
            "structured_response": {
                "summary": "Invalid repository result",
                "coverage_state": "PARTIAL",
                "coverage_notes": [],
                "languages": [],
                "frameworks": [],
                "source_anchors": [],
                "ai_discovery": {
                    "gate": "AI_ABSENT_CONFIRMED",
                    "coverage_state": "PARTIAL",
                    "findings": [],
                    "material_unresolved_frontiers": [],
                },
            }
        },
    )

    with pytest.raises(Exception, match="AI_ABSENT_CONFIRMED"):
        RepositoryDeepAnalyzer()._invoke(
            fake_backend,
            snapshot_id="snapshot-1",
            commit_sha="abc1234",
            scan_job_id="scan-invalid",
        )


def test_repository_deep_analyzer_create_deep_agent_smoke_uses_gemini_native_output(
    monkeypatch,
    tmp_path,
) -> None:
    """Exercise the managed repository analyzer graph through a tool turn and final result."""

    class FakeGeminiModel(BaseChatModel):
        calls: int = 0
        model_name: str = "future-model-v99"
        seen_bind_kwargs: list[dict[str, object]] = Field(default_factory=list)
        __module__ = "langchain_google_genai.chat_models"

        @property
        def _llm_type(self) -> str:
            return "fake-gemini"

        def bind_tools(self, tools, **kwargs):
            self.seen_bind_kwargs.append(dict(kwargs))
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                message = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "ls",
                            "args": {"path": "/"},
                            "id": "call_ls_1",
                            "type": "tool_call",
                        }
                    ],
                )
            else:
                message = AIMessage(content=json.dumps(_valid_repository_result()))
            return ChatResult(generations=[ChatGeneration(message=message)])

    FakeGeminiModel.model_rebuild()
    model = FakeGeminiModel()
    # Model identity is always enforced against the routes file, with or without a run state.
    use_model_routes(
        monkeypatch,
        {
            "routes": {"a": {"provider": "google_genai", "model": "future-model-v99"}},
            "roles": {"default": "a"},
        },
    )
    monkeypatch.setattr(analyzer, "configure_lcsp_harness", lambda: None)
    monkeypatch.setattr(
        analyzer,
        "resolve_agent_model",
        lambda role: model,
    )
    (tmp_path / "app.py").write_text("print('hello')\n", encoding="utf-8")

    result = RepositoryDeepAnalyzer()._invoke(
        LocalShellBackend(tmp_path, inherit_env=False, timeout=5),
        snapshot_id="snapshot-smoke",
        commit_sha="abc1234",
        scan_job_id="scan-smoke",
    )

    assert result.summary == "Tiny repository inspected through managed Deep Agent graph"
    assert result.ai_discovery.gate == "AI_UNKNOWN"
    assert model.calls == 2
    response_formats = [
        kwargs.get("response_format")
        for kwargs in model.seen_bind_kwargs
        if kwargs.get("response_format") is not None
    ]
    assert response_formats
    assert all(item["type"] == "json_schema" for item in response_formats)
    assert all(
        "additionalProperties" not in json.dumps(item)
        for item in response_formats
    )
    assert all(
        kwargs.get("automatic_function_calling") == {"disable": True}
        for kwargs in model.seen_bind_kwargs
    )


def _valid_repository_result() -> dict[str, object]:
    return {
        "summary": "Tiny repository inspected through managed Deep Agent graph",
        "coverage_state": "PARTIAL",
        "coverage_notes": ["bounded local smoke"],
        "languages": ["Python"],
        "frameworks": [],
        "source_anchors": [
            {
                "anchor_id": "a1",
                "file_path": "app.py",
                "start_line": 1,
                "end_line": 1,
                "symbol_ref": "app",
            }
        ],
        "ai_discovery": {
            "gate": "AI_UNKNOWN",
            "coverage_state": "PARTIAL",
            "findings": [],
            "material_unresolved_frontiers": [
                "bounded local smoke did not run exhaustive scan"
            ],
        },
    }


def _evidence_payload_for(tmp_path, result: dict[str, object]) -> dict[str, object]:
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    (tmp_path / "app.py").write_text("app = object()\n", encoding="utf-8")
    return RepositoryDeepAnalyzer._evidence_payload(
        LocalShellBackend(root_dir=str(tmp_path), virtual_mode=True),
        RepositoryAnalysisResult.model_validate(result),
        snapshot_id="snapshot-1",
        commit_sha="abc1234",
        scan_job_id="scan-1",
    )


def test_partial_evidence_payload_carries_interview_coverage_policy(tmp_path) -> None:
    # The new analyzer emits no repository evidence graph (nodes/edges stay empty
    # by design: no discovery tasks or graph-provider queries). A scan-only
    # PARTIAL therefore carries an auditable policy decision but never suffices
    # for Initial Interview on its own; per-rule evidence governs.
    from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
        _can_start_initial_interview,
        _technical_coverage,
    )

    payload = _evidence_payload_for(tmp_path, _valid_repository_result())

    policy = payload["partialCoveragePolicyDecision"]
    assert policy["permittedForInterview"] is False
    assert policy["policyVersion"] == "initial-interview-bounded-evidence-v1"
    assert policy["policyDecisionRef"].startswith("coverage-policy:")
    assert policy["limitations"] == ["bounded local smoke"]
    graph = payload["evidence_graph"]
    assert graph["graph_id"] == "deep-agent:scan-1"
    assert graph["nodes"] == []
    assert graph["edges"] == []
    report = {"evidence_payload": payload}
    coverage_state, coverage_notes = _technical_coverage(report)
    assert coverage_state == "PARTIAL"
    assert _can_start_initial_interview(coverage_state, coverage_notes, report) is False


def test_partial_evidence_payload_without_evidence_does_not_permit_interview(tmp_path) -> None:
    from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
        _can_start_initial_interview,
        _technical_coverage,
    )

    result = _valid_repository_result()
    result["source_anchors"] = []

    payload = _evidence_payload_for(tmp_path, result)

    assert payload["partialCoveragePolicyDecision"]["permittedForInterview"] is False
    report = {"evidence_payload": payload}
    coverage_state, coverage_notes = _technical_coverage(report)
    assert _can_start_initial_interview(coverage_state, coverage_notes, report) is False


def test_ready_evidence_payload_needs_no_partial_coverage_policy(tmp_path) -> None:
    result = _valid_repository_result()
    result["coverage_state"] = "READY"

    payload = _evidence_payload_for(tmp_path, result)

    assert "partialCoveragePolicyDecision" not in payload


def _ai_absent_result() -> dict[str, object]:
    result = _valid_repository_result()
    result["coverage_state"] = "READY"
    result["ai_discovery"] = {
        "gate": "AI_ABSENT_CONFIRMED",
        "coverage_state": "READY",
        "findings": [],
        "material_unresolved_frontiers": [],
    }
    return result


def _enforce(tmp_path, files: dict[str, str]):
    from tools.common.capabilities.evidence.repository_analysis.analyzer import (
        enforce_ai_absence_backstop,
    )
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    for relative, content in files.items():
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    backend = LocalShellBackend(root_dir=str(tmp_path), virtual_mode=True)
    return enforce_ai_absence_backstop(
        backend, RepositoryAnalysisResult.model_validate(_ai_absent_result())
    )


def test_ai_absent_claim_contradicted_by_sdk_import_is_downgraded(tmp_path) -> None:
    # Regression: scan d880c2f5 declared AI_ABSENT_CONFIRMED for a repository whose
    # runtime imports AI SDKs, dismissing them as "development harness code".
    result = _enforce(
        tmp_path,
        {
            "app.py": "app = object()\n",
            "agent/runtime.py": "from langchain_openai import ChatOpenAI\n",
            "web/src/client.ts": 'import OpenAI from "openai";\n',
        },
    )

    discovery = result.ai_discovery
    assert discovery.gate == "AI_UNKNOWN"
    providers = {finding.provider for finding in discovery.findings}
    assert {"langchain", "openai"} <= providers
    assert all(finding.state == "AI_PROVIDER_REFERENCE" for finding in discovery.findings)
    # The full scan already failed to trace these calls; a technical rerun would repeat
    # the miss, so production use is a Customer question (assessment 7976a135).
    assert all(finding.clarification_owner == "CUSTOMER" for finding in discovery.findings)
    assert all(
        finding.clarification_kind == "OUTBOUND_AI_CONFIRMATION" for finding in discovery.findings
    )
    anchors = {anchor.anchor_id: anchor for anchor in result.source_anchors}
    for finding in discovery.findings:
        anchor = anchors[finding.anchor_id]
        assert anchor.file_path in {"agent/runtime.py", "web/src/client.ts"}
        assert anchor.start_line == 1
    assert discovery.material_unresolved_frontiers == []
    # Absence downgrade never finalizes absence: the deterministic check only
    # moves AI_ABSENT_CONFIRMED to AI_UNKNOWN for upstream-pending review.
    assert any(
        "AI_ABSENT_CONFIRMED" in note and "downgraded to AI_UNKNOWN" in note
        for note in result.coverage_notes
    )


def test_ai_absent_claim_contradicted_by_manifest_dependency_is_downgraded(tmp_path) -> None:
    result = _enforce(
        tmp_path,
        {
            "app.py": "app = object()\n",
            "package.json": '{"dependencies": {"@google/genai": "^1.0.0"}}\n',
        },
    )

    assert result.ai_discovery.gate == "AI_UNKNOWN"
    assert [finding.provider for finding in result.ai_discovery.findings] == ["google-genai"]


def test_vendored_and_test_only_references_do_not_contradict_absence(tmp_path) -> None:
    result = _enforce(
        tmp_path,
        {
            "app.py": "app = object()\n",
            "node_modules/openai/index.js": 'module.exports = require("openai");\n',
            "tests/test_fixture.py": "import openai\n",
        },
    )

    assert result.ai_discovery.gate == "AI_ABSENT_CONFIRMED"
    assert result.ai_discovery.findings == []


def test_clean_repository_keeps_ai_absent_confirmed(tmp_path) -> None:
    result = _enforce(tmp_path, {"app.py": "app = object()\n"})

    assert result.ai_discovery.gate == "AI_ABSENT_CONFIRMED"


def test_absence_backstop_fails_closed_when_search_errors(tmp_path) -> None:
    from tools.common.capabilities.evidence.repository_analysis.analyzer import (
        enforce_ai_absence_backstop,
    )
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    class BrokenBackend:
        def grep(self, *_args, **_kwargs):
            return SimpleNamespace(error="sandbox unavailable", matches=None, truncated=False)

    result = enforce_ai_absence_backstop(
        BrokenBackend(), RepositoryAnalysisResult.model_validate(_ai_absent_result())
    )

    assert result.ai_discovery.gate == "AI_UNKNOWN"
    assert result.ai_discovery.material_unresolved_frontiers


def test_non_absent_results_are_untouched(tmp_path) -> None:
    from tools.common.capabilities.evidence.repository_analysis.analyzer import (
        enforce_ai_absence_backstop,
    )
    from tools.common.capabilities.evidence.repository_analysis.models import (
        RepositoryAnalysisResult,
    )

    original = RepositoryAnalysisResult.model_validate(_valid_repository_result())

    assert enforce_ai_absence_backstop(MagicMock(), original) is original


def test_repository_analyst_task_subagents_run_under_model_governance(
    monkeypatch,
    tmp_path,
) -> None:
    """The single bounded AI-discovery task runs under model governance.

    The rewritten analyzer has no `task` subagents: one Deep Agent call carries
    AgentRunBudget + billing + MODEL_GOVERNANCE middleware directly. Its failure
    still yields AI_UNKNOWN/upstream-pending and never invalidates per-rule
    evidence (NOT_OBSERVED stays epistemic; no absence finalization).
    """
    captured: dict[str, object] = {}
    fake_agent = object()
    fake_backend = MagicMock()

    monkeypatch.setattr(analyzer, "configure_lcsp_harness", lambda: None)
    monkeypatch.setattr(
        analyzer,
        "resolve_agent_model",
        lambda role: "fake-model",
    )

    def fake_create_deep_agent(**kwargs):
        captured["create_kwargs"] = kwargs
        return fake_agent

    def fake_invoke_with_stream(agent, inputs, *, config, stage=None):
        return {"structured_response": _valid_repository_result()}

    monkeypatch.setattr(analyzer, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(analyzer, "invoke_with_stream", fake_invoke_with_stream)

    result = RepositoryDeepAnalyzer()._invoke(
        fake_backend,
        snapshot_id="snapshot-governed",
        commit_sha="abc1234",
        scan_job_id="scan-governed",
    )

    assert result.ai_discovery.gate == "AI_UNKNOWN"
    create_kwargs = captured["create_kwargs"]
    assert isinstance(create_kwargs, dict)
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE

    middleware = list(create_kwargs["middleware"])
    assert any(isinstance(item, AgentRunBudgetMiddleware) for item in middleware)
    governed_names = {type(item).__name__ for item in middleware}
    for required in (
        "AgentRoleMiddleware",
        "ModelRetryMiddleware",
        "ProviderFallbackMiddleware",
        "TokenFallbackMiddleware",
        "UsageMeteringMiddleware",
    ):
        assert required in governed_names
    assert len(MODEL_GOVERNANCE_MIDDLEWARE) > 0


class _NeverCalledModel(BaseChatModel):
    @property
    def _llm_type(self) -> str:
        return "never-called"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        raise AssertionError("graph construction must not call the model")


def test_repository_analyst_task_subagent_timeout_falls_back_to_next_provider(
    monkeypatch,
    tmp_path,
) -> None:
    """AI discovery is independently durable: a model failure yields AI_UNKNOWN.

    The rewritten analyzer has no `task` subagent to time out. When the single
    bounded Deep Agent call raises, analyze() against the hydrated repository
    fails closed to AI_UNKNOWN/AI_DISCOVERY_FAILED (upstream-pending) instead of
    failing the scan or invalidating per-rule evidence.
    """
    from tools.common.capabilities.evidence.repository_analysis.analyzer import (
        AI_DISCOVERY_FAILED,
    )

    (tmp_path / "app.py").write_text("app = object()\n", encoding="utf-8")
    backend = LocalShellBackend(root_dir=str(tmp_path), virtual_mode=True)

    def fail_invoke(*_args, **_kwargs):
        raise TimeoutError("provider timed out")

    monkeypatch.setattr(RepositoryDeepAnalyzer, "_invoke", fail_invoke)

    artifact = RepositoryDeepAnalyzer().analyze(
        snapshot_id="snapshot-timeout",
        commit_sha="abc1234",
        scan_job_id="scan-timeout",
        backend=backend,
    )

    assert artifact.result.ai_discovery.gate == "AI_UNKNOWN"
    assert artifact.result.coverage_state == "PARTIAL"
    assert AI_DISCOVERY_FAILED in artifact.result.ai_discovery.material_unresolved_frontiers
    assert AI_DISCOVERY_FAILED in artifact.result.coverage_notes
    assert artifact.evidence_payload["ai_discovery"]["gate"] == "AI_UNKNOWN"
    assert AI_DISCOVERY_FAILED in artifact.evidence_payload["ai_discovery"]["limitations"]
    # analyze() without any hydrated backend fails closed with a clear error.
    monkeypatch.setattr(
        "tools.common.capabilities.platform.repository_sandbox.current_repository_backend",
        lambda: None,
    )
    with pytest.raises(RuntimeError, match="current LCSP repository sandbox backend"):
        RepositoryDeepAnalyzer().analyze(
            snapshot_id="snapshot-timeout",
            commit_sha="abc1234",
            scan_job_id="scan-timeout",
            backend=None,
        )


def test_evidence_graph_carries_content_hash_that_investigation_accepts(tmp_path) -> None:
    # The Deep Agent analyzer emits graph_hash != "": per-rule investigation can
    # verify provenance instead of stopping on "provenance is incomplete".
    from tools.common.capabilities.evidence.graph.schema.models import (
        ProgramEvidenceGraph,
        program_graph_content_hash,
    )

    payload = _evidence_payload_for(tmp_path, _valid_repository_result())
    graph = payload["evidence_graph"]

    assert graph["graph_hash"].startswith("sha256:")
    assert graph["graph_hash"] == program_graph_content_hash(graph)
    parsed = ProgramEvidenceGraph.from_dict(graph)
    assert parsed.graph_id == "deep-agent:scan-1"
    assert parsed.graph_hash == graph["graph_hash"]
    assert parsed.schema_version == "deep-agent-1.0.0"

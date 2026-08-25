from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tools.common.capabilities.assessment.investigation.engineering_rule.code_context import CodeContextSession
from tools.common.capabilities.assessment.investigation.engineering_rule.code_context_investigator import (
    CODE_CONTEXT_TOOL_NAMES,
    CodeContextLawGuidedInvestigator,
)
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_ledger import EvidenceLedger
from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket


def _graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
        "commit_sha": "abc123",
        "nodes": [{
            "node_id": "charge",
            "node_type": "METHOD",
            "label": "chargePayment",
            "source": {
                "file_path": "src/payment.py",
                "start_line": 1,
                "end_line": 3,
                "symbol_ref": "PaymentService.chargePayment",
            },
            "attributes": {},
            "semantic_types": ["PAYMENT"],
            "evidence_refs": ["evidence:charge"],
        }],
        "edges": [],
        "source_anchors": [],
        "indexes": {},
        "unresolved_frontiers": [],
        "coverage_state": "SUFFICIENT",
        "coverage_notes": [],
        "provenance": {"scan_job_id": "scan-1"},
        "evidence_refs": ["evidence:charge"],
        "graph_hash": "sha256:graph",
        "schema_version": "2.0.0",
    }


def _workspace(tmp_path: Path) -> Path:
    source = tmp_path / "src"
    source.mkdir()
    (source / "payment.py").write_text(
        "def chargePayment(invoice):\n"
        "    audit_log(invoice)\n"
        "    return invoice.status\n",
        encoding="utf-8",
    )
    return tmp_path


def _packet() -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="PAYMENT_CONTROL",
        investigation_goals=("Verify payment control behavior",),
        initial_results=(),
        keywords=("chargePayment", "audit_log"),
        required_evidence=("PAYMENT_CONTROL",),
    )


def test_code_context_is_seeded_and_exposed_as_native_tools(tmp_path: Path) -> None:
    captured: dict = {}

    class Agent:
        def invoke(self, payload, config=None):
            workspace_get = next(
                tool for tool in captured["tools"] if tool.name == "workspace_get"
            )
            workspace_get.invoke({})
            return {
                "structured_response": {
                    "claims": [{
                        "criterion": "PAYMENT_CONTROL",
                        "claimType": "UNRESOLVED_ENGINEERING_FACT",
                        "observationRefs": ["obs:0002"],
                        "confidence": 0.5,
                        "limitations": ["ENGINEERING_EVIDENCE_INSUFFICIENT"],
                    }]
                }
            }

    def fake_create_agent(**kwargs):
        captured.update(kwargs)
        return Agent()

    session = CodeContextSession(_graph(), workspace_path=_workspace(tmp_path))
    with patch(
        "tools.common.capabilities.assessment.investigation.engineering_rule.investigator.create_agent",
        side_effect=fake_create_agent,
    ):
        claims = CodeContextLawGuidedInvestigator("test:model").investigate(
            packet=_packet(),
            graph=_graph(),
            workflow_run_id="workflow-1",
            code_context=session,
        )

    names = {tool.name for tool in captured["tools"]}
    assert set(CODE_CONTEXT_TOOL_NAMES).issubset(names)
    assert claims[0].claim_type == "UNRESOLVED_ENGINEERING_FACT"
    assert claims[0].evidence_refs == ("evidence:charge",)


def test_seed_source_candidate_prefers_production_code() -> None:
    candidate = CodeContextLawGuidedInvestigator._seed_source_candidate({
        "results": [
            {"symbolId": "sym:test", "path": "src/payment.service.spec.ts"},
            {"symbolId": "sym:runtime", "path": "src/payment.service.ts"},
        ]
    })
    assert candidate is not None
    assert candidate["symbolId"] == "sym:runtime"


def test_observation_ids_are_resolved_to_concrete_graph_refs() -> None:
    ledger = EvidenceLedger()
    ledger.add(
        source="seed",
        result={"nodes": [{"node_id": "node-1", "node_type": "FUNCTION"}]},
    )
    prepared, error = CodeContextLawGuidedInvestigator._resolve_graph_observation_ref(
        "trace_static_flow",
        {"start_ref": "obs:0001"},
        ledger,
    )
    assert error is None
    assert prepared["start_ref"] == "node-1"

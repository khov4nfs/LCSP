from __future__ import annotations

from pathlib import Path

from lcsp_workers.investigation.code_context import CodeContextSession
from lcsp_workers.investigation.code_context_investigator import (
    CodeContextLawGuidedInvestigator,
)


def _graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
        "commit_sha": "abc123",
        "node_count": 3,
        "edge_count": 2,
        "nodes": [
            {
                "node_id": "class-payment",
                "node_type": "CLASS",
                "label": "PaymentService",
                "source": {
                    "file_path": "src/payment.py",
                    "start_line": 1,
                    "end_line": 130,
                    "symbol_ref": "PaymentService",
                },
                "attributes": {},
                "semantic_types": ["PAYMENT"],
                "evidence_refs": ["evidence:class"],
            },
            {
                "node_id": "charge",
                "node_type": "METHOD",
                "label": "chargePayment",
                "source": {
                    "file_path": "src/payment.py",
                    "start_line": 2,
                    "end_line": 101,
                    "symbol_ref": "PaymentService.chargePayment",
                },
                "attributes": {},
                "semantic_types": ["PAYMENT", "EXTERNAL_API_CALL"],
                "evidence_refs": ["evidence:charge"],
            },
            {
                "node_id": "webhook",
                "node_type": "FUNCTION",
                "label": "handlePaymentWebhook",
                "source": {
                    "file_path": "src/webhook.py",
                    "start_line": 1,
                    "end_line": 4,
                    "symbol_ref": "handlePaymentWebhook",
                },
                "attributes": {},
                "semantic_types": ["WEBHOOK"],
                "evidence_refs": ["evidence:webhook"],
            },
        ],
        "edges": [
            {
                "edge_id": "contains-charge",
                "edge_type": "DECLARES",
                "source_node_id": "class-payment",
                "target_node_id": "charge",
                "evidence_refs": ["evidence:class"],
            },
            {
                "edge_id": "webhook-calls-charge",
                "edge_type": "CALLS",
                "source_node_id": "webhook",
                "target_node_id": "charge",
                "evidence_refs": ["evidence:webhook"],
            },
        ],
        "source_anchors": [],
        "indexes": {},
        "unresolved_frontiers": [],
        "coverage_state": "SUFFICIENT",
        "coverage_notes": [],
        "provenance": {"scan_job_id": "scan-1"},
        "evidence_refs": ["evidence:class", "evidence:charge", "evidence:webhook"],
        "graph_hash": "sha256:graph",
        "schema_version": "2.0.0",
    }


def _workspace(tmp_path: Path) -> Path:
    src = tmp_path / "src"
    src.mkdir()
    payment_lines = ["class PaymentService:"]
    payment_lines.extend(
        [
            "    def chargePayment(self, invoice):",
            "        status = invoice.status",
        ]
    )
    payment_lines.extend([f"        value_{index} = {index}" for index in range(3, 101)])
    payment_lines.extend(["        return status"] * 29)
    (src / "payment.py").write_text("\n".join(payment_lines) + "\n", encoding="utf-8")
    (src / "webhook.py").write_text(
        "def handlePaymentWebhook(event):\n"
        "    service = PaymentService()\n"
        "    service.chargePayment(event.invoice)\n"
        "    return True\n",
        encoding="utf-8",
    )
    return tmp_path


def _charge_symbol(session: CodeContextSession) -> dict:
    outline = session.get_file_outline("src/payment.py")
    return next(
        row
        for row in outline["symbols"]
        if row["symbol"].endswith("PaymentService.chargePayment")
    )


def test_code_context_uses_commit_versioned_semantic_symbol_ids(tmp_path: Path) -> None:
    session = CodeContextSession(_graph(), workspace_path=_workspace(tmp_path))

    search = session.search_code(query="chargePayment")
    assert search["results"]
    assert any("chargePayment" in row["symbol"] for row in search["results"])

    symbol = _charge_symbol(session)
    assert symbol["symbolId"].startswith("sym://abc123/src/payment.py#")
    assert symbol["chunkId"].startswith("chunk://abc123/src/payment.py#")
    assert symbol["lines"] == [2, 101]


def test_code_source_pages_stay_inside_one_ast_symbol_chunk(tmp_path: Path) -> None:
    session = CodeContextSession(_graph(), workspace_path=_workspace(tmp_path))
    symbol_id = _charge_symbol(session)["symbolId"]

    first = session.get_code(symbol_id=symbol_id)
    assert first["code"][0]["line"] == 2
    assert first["code"][-1]["line"] == 81
    assert first["truncated"] is True
    assert first["nextCursor"] == "code:80"

    second = session.get_code(symbol_id=symbol_id, cursor=first["nextCursor"])
    assert second["code"][0]["line"] == 82
    assert second["code"][-1]["line"] == 101
    assert second["truncated"] is False
    assert second["chunkId"] == first["chunkId"]


def test_search_cursor_is_server_side_and_deterministic(tmp_path: Path) -> None:
    graph = _graph()
    for index in range(10):
        graph["nodes"].append(
            {
                "node_id": f"payment-{index}",
                "node_type": "FUNCTION",
                "label": f"paymentHandler{index}",
                "source": {
                    "file_path": f"src/payment_{index}.py",
                    "start_line": 1,
                    "end_line": 2,
                    "symbol_ref": f"paymentHandler{index}",
                },
                "attributes": {},
                "semantic_types": ["PAYMENT"],
                "evidence_refs": [f"evidence:payment-{index}"],
            }
        )
    graph["node_count"] = len(graph["nodes"])
    session = CodeContextSession(graph)

    first = session.search_code(query="payment")
    assert len(first["results"]) == 5
    assert first["truncated"] is True
    assert first["nextCursor"].startswith("search:")

    second = session.search_code(cursor=first["nextCursor"])
    first_ids = {row["symbolId"] for row in first["results"]}
    second_ids = {row["symbolId"] for row in second["results"]}
    assert not first_ids.intersection(second_ids)


def test_references_and_workspace_preserve_context_without_resending_source(tmp_path: Path) -> None:
    session = CodeContextSession(_graph(), workspace_path=_workspace(tmp_path))
    charge = _charge_symbol(session)

    references = session.find_references(
        symbol_id=charge["symbolId"], direction="CALLERS"
    )
    assert any(
        row["symbol"].endswith("handlePaymentWebhook")
        for row in references["references"]
    )

    workspace = session.workspace_update(
        add_symbols=[charge["symbolId"]],
        notes=["Webhook path may trigger payment charge."],
    )
    assert workspace["importantSymbols"][0]["symbolId"] == charge["symbolId"]
    assert workspace["notes"] == ["Webhook path may trigger payment charge."]
    assert "code" not in workspace["importantSymbols"][0]


def test_code_aware_llm_tools_hide_internal_search_resource_guards() -> None:
    tools = CodeContextLawGuidedInvestigator._code_aware_tool_definitions()
    by_name = {tool.name: tool for tool in tools}

    assert {
        "repo_map",
        "search_code",
        "get_symbol",
        "get_file_outline",
        "get_code",
        "find_references",
        "workspace_update",
        "workspace_get",
    }.issubset(by_name)

    for name in (
        "search_nodes",
        "trace_static_flow",
        "inspect_data_path",
        "inspect_decision_path",
        "inspect_human_review_path",
        "symbol_context",
        "provider_invocations",
    ):
        properties = by_name[name].input_schema["properties"]
        assert "max_hops" not in properties
        assert "max_results" not in properties
        assert "max_neighbors" not in properties

"""Provider-free semantic reliability regression test suite.

Durable tests protecting against the 11 semantic failure patterns:
1. Repository description mistaken for operator legal identity.
2. Negative conditions inferred from absent repository files.
3. Customer fact authority versus source-code observation.
4. Conflicting facts and evidence provenance.
5. Stale decisions after later evidence changes.
6. AI media output inconsistency.
7. External disclosure inferred from local logging.
8. Organizational records inferred absent from code.
9. Model compaction preserving legal actor distinctions.
10. Researcher findings incorrectly promoted into accepted facts.
11. Human clarification after uncertain applicability.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.agent import ROOT_INSTRUCTIONS, create_assessment_root_agent
from assessment_root.runner import TaskLineage
from test_assessment_root_agent import (
    PINS,
    THREAD,
    FakeClient,
    RootScriptedModel,
    _call,
    _run,
    complete_root_messages,
)


class SemanticFakeClient(FakeClient):
    """Subclass of FakeClient that synchronizes open_requests on post_human_request and mocks rule_decisions."""

    def post_human_request(self, body: dict[str, Any]) -> dict[str, Any]:
        res = super().post_human_request(body)
        self.open_requests = [res["requestId"]]
        return res

    def rule_decisions(self, rule_id: str, revision: int | None = None) -> dict[str, Any]:
        self.calls.append(("rule_decisions", (rule_id, revision)))
        return {
            "records": [
                {
                    "assessmentRuleId": rule_id,
                    "decisionRevision": revision or 1,
                    "applicability": "APPLICABLE",
                    "compliance": "UNKNOWN",
                    "rationale": "Prior decision before new evidence.",
                    "applicabilityBasis": [],
                    "criteria": [],
                    "references": [],
                }
            ]
        }


def _setup_semantic_test(
    tmp_path: Path,
    rule_id: str = "ANM-2025-Art23-Rule-Docs",
    condition_text: str = "Cơ quan nhà nước, tổ chức chính trị vận hành hệ thống",
    client: FakeClient | None = None,
):
    if client is None:
        client = SemanticFakeClient()
    req_id = f"LR-{rule_id}"
    crit_id = f"C-{rule_id}"
    rule_set = {
        "ruleSetVersionId": PINS["ruleSetVersionId"],
        "legalRequirements": [
            {
                "legalRequirementId": req_id,
                "title": "Trách nhiệm người đứng đầu",
                "proposition": condition_text,
                "applicabilityConditions": [condition_text],
                "qualifiers": [],
                "exceptions": [],
                "criteria": [{"criterionId": crit_id, "statement": "Ban hành quy chế an toàn"}],
            }
        ],
        "assessmentRules": [
            {
                "assessmentRuleId": rule_id,
                "assessmentRuleVersion": "v1",
                "concept": "administrative_scope",
                "legalRequirementIds": [req_id],
                "criteria": [{"criterionId": crit_id, "statement": "Ban hành quy chế an toàn"}],
            }
        ],
        "contextRelations": [],
    }
    client.rule_set_override = rule_set
    client.legal_texts[("DOC-1", "art23")] = {
        "documentId": "DOC-1",
        "locator": "art23",
        "contentSha256": "hash-1",
        "content": f"Điều 23. {condition_text} có trách nhiệm ban hành quy chế an toàn thông tin mạng.",
    }
    run = _run(tmp_path, client)
    root = tmp_path / "repo"
    (root / "README.md").write_text("# Educational Tool\nAn open-source academic proctoring utility.", encoding="utf-8")
    (root / "src" / "violations.py").write_text(
        "def log_violation(msg):\n    with open('violations.log', 'a') as f:\n        f.write(msg + '\\n')\n",
        encoding="utf-8",
    )
    (root / "src" / "display.py").write_text(
        "import cv2\ndef render_frame(frame, bbox):\n    cv2.rectangle(frame, bbox, (0, 255, 0), 2)\n    cv2.imshow('Proctoring View', frame)\n",
        encoding="utf-8",
    )
    return client, run


def test_repository_description_cannot_prove_or_refute_operator_legal_identity(tmp_path):
    """Pattern 1: Source code README cannot establish that operator is or is not a state agency."""
    rule_id = "ANM-2025-Art23-Rule-Docs"
    req_id = f"LR-{rule_id}"
    client, run = _setup_semantic_test(tmp_path, rule_id)
    plan = [{"content": "Verify operator legal organizational status via customer inquiry", "status": "in_progress"}]

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("write_todos", {"todos": plan}, "plan"),
        _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "condition_ref": {"legal_requirement_id": req_id, "kind": "APPLICABILITY_CONDITION", "index": 0},
            "question": "What is the legal organizational form of the entity operating this deployment?",
            "unresolved_fact": "Operator legal organizational status",
            "decision_impact": ["Determines administrative scope applicability under Art 23"],
            "resolution_attempts": ["Inspected README.md which describes software but not operator legal entity"],
        }, "human"),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": THREAD}}
    result = graph.invoke({"messages": [{"role": "user", "content": f"Investigate rule {rule_id}"}]}, config)

    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    assert client.calls[-1][0] == "human"
    assert not any(call[0] == "decision" for call in client.calls)


def test_negative_conditions_cannot_be_inferred_from_absent_repository_files(tmp_path):
    """Pattern 2: Absence of state directive files in repo does not prove directive absence."""
    rule_id = "ANM-2025-Art24-Rule-KyThuat"
    req_id = f"LR-{rule_id}"
    client, run = _setup_semantic_test(tmp_path, rule_id, "Có yêu cầu bằng văn bản của cơ quan nhà nước có thẩm quyền")
    plan = [{"content": "Inquire whether competent authority directive was issued", "status": "in_progress"}]

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("write_todos", {"todos": plan}, "plan"),
        _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "condition_ref": {"legal_requirement_id": req_id, "kind": "APPLICABILITY_CONDITION", "index": 0},
            "question": "Has a competent state authority issued a directive requiring deployment of this system?",
            "unresolved_fact": "Existence of competent state authority directive",
            "decision_impact": ["Determines applicability under Art 24(2)(b)"],
            "resolution_attempts": ["Searched repository; absence of files does not prove absence of directive"],
        }, "human"),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": THREAD}}
    result = graph.invoke({"messages": [{"role": "user", "content": f"Investigate rule {rule_id}"}]}, config)

    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    assert not any(call[0] == "decision" for call in client.calls)


def test_customer_fact_authority_takes_precedence_over_source_code_observation(tmp_path):
    """Pattern 3: Customer HUMAN_PROVIDED fact is authoritative for operational status over repo."""
    rule_id = "ANM-2025-Art23-Rule-Docs"
    req_id = f"LR-{rule_id}"
    customer_fact_id = "77777777-7777-4777-8777-777777777777"

    class FactContextClient(SemanticFakeClient):
        def context(self):
            c = super().context()
            c["caseRevision"] = 2
            c["facts"] = [{
                "factId": customer_fact_id,
                "caseRevision": 2,
                "kind": "FACT",
                "state": "ACCEPTED",
                "authority": "HUMAN_PROVIDED",
                "statement": "The operating entity is an independent private educational technology company.",
                "evidenceIds": [],
            }]
            return c

    client, run = _setup_semantic_test(tmp_path, rule_id, client=FactContextClient())
    run.case_revision = 2

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("submit_rule_decision", {
            "assessment_rule_id": rule_id,
            "applicability": "NOT_APPLICABLE",
            "rationale": "Condition refuted based on confirmed customer fact establishing private corporate operator.",
            "legal_context_ids": [req_id],
            "references": [{"type": "CONFIRMED_FACT", "id": customer_fact_id}],
            "applicability_basis": [{
                "legal_requirement_id": req_id,
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Customer fact establishes private corporate entity, refuting state administrative agency condition.",
                "references": [{"type": "CONFIRMED_FACT", "id": customer_fact_id}],
            }],
        }, "dec"),
        *complete_root_messages(),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])
    graph.invoke({"messages": [{"role": "user", "content": "Decide rule based on customer fact"}]})

    decisions = [body for name, body in client.calls if name == "decision"]
    assert len(decisions) == 1
    submitted = decisions[0]["decision"]
    assert submitted["applicability"] == "NOT_APPLICABLE"
    assert submitted["applicabilityBasis"][0]["finding"] == "REFUTED"
    assert submitted["applicabilityBasis"][0]["references"][0]["factId"] == customer_fact_id


def test_conflicting_facts_and_evidence_provenance(tmp_path):
    """Pattern 4: Conflict between repository claim and customer fact preserves provenance and prioritizes operational fact."""
    rule_id = "ANM-2025-Art23-Rule-Docs"
    req_id = f"LR-{rule_id}"
    crit_id = f"C-{rule_id}"
    conflicting_fact_id = "77777777-7777-4777-8777-777777777777"

    class ConflictClient(SemanticFakeClient):
        def context(self):
            c = super().context()
            c["facts"] = [
                {
                    "factId": "66666666-6666-4666-8666-666666666666",
                    "caseRevision": 1,
                    "kind": "USE_CASE",
                    "state": "ACCEPTED",
                    "authority": "EVIDENCE_CITED",
                    "statement": "README states open-source academic exam proctoring program.",
                    "evidenceIds": ["ev-readme"],
                },
                {
                    "factId": conflicting_fact_id,
                    "caseRevision": 2,
                    "kind": "FACT",
                    "state": "ACCEPTED",
                    "authority": "HUMAN_PROVIDED",
                    "statement": "Customer confirms system is operated directly by the Provincial Department of Education.",
                    "evidenceIds": [],
                },
            ]
            return c

    client, run = _setup_semantic_test(tmp_path, rule_id, client=ConflictClient())

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("submit_rule_decision", {
            "assessment_rule_id": rule_id,
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Applicable because customer confirms operation by Provincial Department of Education (state agency).",
            "legal_context_ids": [req_id],
            "references": [{"type": "CONFIRMED_FACT", "id": conflicting_fact_id}],
            "applicability_basis": [{
                "legal_requirement_id": req_id,
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "ESTABLISHED",
                "rationale": "Customer fact establishes operation by Provincial Department of Education.",
                "references": [{"type": "CONFIRMED_FACT", "id": conflicting_fact_id}],
            }],
            "criteria": [{
                "criterion_id": crit_id,
                "outcome": "NOT_MET",
                "rationale": "No safety governance policy documented in repository.",
                "references": [{"type": "CONFIRMED_FACT", "id": conflicting_fact_id}],
            }],
        }, "dec"),
        *complete_root_messages(),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])
    graph.invoke({"messages": [{"role": "user", "content": "Evaluate conflicting evidence"}]})

    decisions = [body for name, body in client.calls if name == "decision"]
    assert len(decisions) == 1
    assert decisions[0]["decision"]["applicability"] == "APPLICABLE"
    assert decisions[0]["decision"]["applicabilityBasis"][0]["finding"] == "ESTABLISHED"


def test_stale_decisions_reconsidered_after_later_evidence_changes(tmp_path):
    """Pattern 5: Stale decisions with invalidated coverage are reloaded and revised."""
    rule_id = "ANM-2025-Art23-Rule-Docs"
    req_id = f"LR-{rule_id}"
    fact_id = "77777777-7777-4777-8777-777777777777"

    class InvalidationClient(SemanticFakeClient):
        def context(self):
            c = super().context()
            c["caseRevision"] = 3
            c["coverage"] = [{
                "assessmentRuleId": rule_id,
                "assessmentRuleVersion": "v1",
                "resolutionState": "INVESTIGATING",
                "currentDecisionId": None,
                "decisionRevision": 1,
            }]
            c["facts"] = [{
                "factId": fact_id,
                "caseRevision": 3,
                "kind": "FACT",
                "state": "ACCEPTED",
                "authority": "HUMAN_PROVIDED",
                "statement": "Updated fact: private operator.",
                "evidenceIds": [],
            }]
            return c

    client, run = _setup_semantic_test(tmp_path, rule_id, client=InvalidationClient())
    run.case_revision = 3
    run.decision_revisions[rule_id] = 1

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("get_rule_decision", {"assessment_rule_id": rule_id, "revision": 1}, "prior"),
        _call("submit_rule_decision", {
            "assessment_rule_id": rule_id,
            "applicability": "NOT_APPLICABLE",
            "rationale": "Re-evaluated at caseRevision 3 with updated facts.",
            "legal_context_ids": [req_id],
            "references": [{"type": "CONFIRMED_FACT", "id": fact_id}],
            "applicability_basis": [{
                "legal_requirement_id": req_id,
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Updated operational fact refutes state agency requirement.",
                "references": [{"type": "CONFIRMED_FACT", "id": fact_id}],
            }],
        }, "resubmit"),
        *complete_root_messages(),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])
    graph.invoke({"messages": [{"role": "user", "content": "Re-evaluate stale decision"}]})

    decisions = [body for name, body in client.calls if name == "decision"]
    assert len(decisions) == 1
    assert decisions[0]["expectedDecisionRevision"] == 1


def test_ai_media_output_inconsistency_resolved(tmp_path):
    """Pattern 6: Video frame annotation via OpenCV is recognized as media output."""
    rule_id = "luat134-art11-cl2-machine-readable-marking-impl"
    req_id = f"LR-{rule_id}"
    crit_id = f"C-{rule_id}"
    client, run = _setup_semantic_test(tmp_path, rule_id, "Hệ thống hiển thị hoặc phát xuất nội dung truyền thông")

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("cite_repository_source", {"path": "/src/display.py", "start_line": 2, "end_line": 4}, "cite"),
        _call("submit_rule_decision", {
            "assessment_rule_id": rule_id,
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "display.py renders live annotated frames via OpenCV; media presentation duties apply but machine-readable marking is missing.",
            "legal_context_ids": [req_id],
            "references": [{"type": "ASSESSMENT_EVIDENCE", "id": "66666666-6666-4666-8666-666666666666"}],
            "criteria": [{
                "criterion_id": crit_id,
                "outcome": "NOT_MET",
                "rationale": "No machine-readable provenance metadata embedded in output frames.",
                "references": [{"type": "ASSESSMENT_EVIDENCE", "id": "66666666-6666-4666-8666-666666666666"}],
            }],
        }, "dec"),
        *complete_root_messages(),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])
    graph.invoke({"messages": [{"role": "user", "content": "Investigate media marking"}]})

    decisions = [body for name, body in client.calls if name == "decision"]
    assert len(decisions) == 1
    assert decisions[0]["decision"]["applicability"] == "APPLICABLE"
    assert decisions[0]["decision"]["compliance"] == "NON_COMPLIANT"


def test_external_disclosure_cannot_be_inferred_from_local_logging(tmp_path):
    """Pattern 7: Local logging does not prove absence of external data disclosure."""
    rule_id = "ar-art24-dual-consent"
    req_id = f"LR-{rule_id}"
    client, run = _setup_semantic_test(tmp_path, rule_id, "Công bố hoặc tiết lộ thông tin bí mật cá nhân của trẻ em")

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "condition_ref": {"legal_requirement_id": req_id, "kind": "APPLICABILITY_CONDITION", "index": 0},
            "question": "Does the system publish, broadcast, or disclose student exam data to external parties?",
            "unresolved_fact": "External disclosure practices regarding examinee data",
            "decision_impact": ["Determines child data disclosure applicability under Art 24"],
            "resolution_attempts": ["Inspected local logging; local file write does not establish whether external disclosure occurs"],
        }, "human"),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": THREAD}}
    result = graph.invoke({"messages": [{"role": "user", "content": "Investigate child data disclosure"}]}, config)

    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    assert not any(call[0] == "decision" for call in client.calls)


def test_organizational_records_cannot_be_inferred_absent_without_bounded_coverage(tmp_path):
    """Pattern 8: Absence of risk classification records requires bounded search coverage."""
    rule_id = "ar-06-provider-classification"
    crit_id = f"C-{rule_id}"
    client, run = _setup_semantic_test(tmp_path, rule_id, "Nhà cung cấp lập hồ sơ phân loại rủi ro")

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("grep", {"pattern": "risk_classification", "path": "src"}, "grep-1"),
        _call("record_search_coverage", {
            "known_gaps": ["Bounded search across src directory confirms no risk classification dossier in repo."],
        }, "cov"),
        _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "criterion_ids": [crit_id],
            "question": "Has an external risk classification dossier been prepared for this system outside the repository?",
            "unresolved_fact": "External risk classification dossier existence",
            "decision_impact": ["Determines compliance with provider risk classification requirements"],
            "resolution_attempts": ["Verified absence in repo with bounded search coverage; external records require customer confirmation"],
        }, "human"),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": THREAD}, "callbacks": [run.trace]}
    result = graph.invoke({"messages": [{"role": "user", "content": "Investigate risk dossier"}]}, config)

    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    assert any(call[0] == "evidence" for call in client.calls)


def test_model_compaction_preserves_legal_actor_distinctions(tmp_path, monkeypatch):
    """Pattern 9: Context compaction keeps separation of product purpose and operator identity."""
    import deepagents.middleware.summarization as native_summary
    monkeypatch.setattr(native_summary, "compute_summarization_defaults", lambda _: {
        "trigger": ("messages", 8), "keep": ("messages", 1), "truncate_args_settings": None,
    })

    operations = []

    class ObserveCompaction(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            operations.append(request)
            return handler(request)

    client, run = _setup_semantic_test(tmp_path)
    model = RootScriptedModel(responses=[
        AIMessage(content="Preserved working state: repository contains academic tool; operator legal identity remains unconfirmed."),
        *complete_root_messages(),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=[ObserveCompaction()], graph_tools=[])
    history = [
        {"role": "user", "content": f"Prior turn fact observation {i}: Software has educational proctoring purpose."}
        for i in range(10)
    ]
    graph.invoke({"messages": history})

    assert operations
    summary_calls = [op for op in operations if "Context Extraction Assistant" in str(op.messages)]
    assert summary_calls
    assert summary_calls[0].system_message.content == ROOT_INSTRUCTIONS
    assert "Strict Separation of Product Identity from Operator Legal Identity" in summary_calls[0].system_message.content


def test_researcher_findings_cannot_be_promoted_into_accepted_facts_without_root_verification(tmp_path):
    """Pattern 10: Researcher output is candidate findings only; cannot mint evidence or facts."""
    client, run = _setup_semantic_test(tmp_path)

    model = RootScriptedModel(responses=[
        _call("task", {"description": "Check if any state agency credentials exist in config", "subagent_type": "repository-researcher"}, "task-1"),
        AIMessage(content="Candidate finding: config mentions educational proctoring only."),
        _call("cite_repository_source", {"path": "/README.md", "start_line": 1, "end_line": 2}, "cite-1"),
        *complete_root_messages(),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])
    handler = TaskLineage(client, "root-exec-1")
    config = {"callbacks": [handler]}
    graph.invoke({"messages": [{"role": "user", "content": "Delegate source search"}]}, config=config)

    calls = [call[0] for call in client.calls]
    assert "evidence" in calls
    assert "activity" in calls
    assert "fact" not in calls
    assert "decision" not in calls


def test_human_clarification_invoked_after_uncertain_applicability(tmp_path):
    """Pattern 11: Uncertain applicability condition triggers anchored open_human_request."""
    rule_id = "art20-cl1-assessment"
    req_id = f"LR-{rule_id}"
    client, run = _setup_semantic_test(tmp_path, rule_id, "Cơ quan, tổ chức nước ngoài hoạt động tại Việt Nam")

    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "condition_ref": {"legal_requirement_id": req_id, "kind": "APPLICABILITY_CONDITION", "index": 0},
            "question": "Is the operator a foreign entity or organization operating in Vietnam?",
            "unresolved_fact": "Foreign organization status of operator",
            "decision_impact": ["Determines extraterritorial applicability under Art 20(1)"],
            "resolution_attempts": ["Repository does not indicate country of incorporation of the operating entity"],
        }, "human"),
    ])

    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": THREAD}}
    result = graph.invoke({"messages": [{"role": "user", "content": "Investigate foreign operator scope"}]}, config)

    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    assert client.calls[-1][0] == "human"

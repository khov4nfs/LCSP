"""Offline contract tests for compact context and complete, revision-bound coverage pages.

The real governed tools run against an in-memory API and a temporary read-only source view.
No model client, provider request, live database, or customer assessment is involved.
"""

from __future__ import annotations

from assessment_root.tools import ROOT_TOOL_NAMES
from copy import deepcopy
from dataclasses import replace
import hashlib
import json

import pytest
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel, Field

from assessment_root.agent import AssessmentToolDescriptionsMiddleware, ROOT_INSTRUCTIONS, create_assessment_root_agent
from assessment_root.client import AssessmentApiError
from test_assessment_root_agent import (
    ASSESSMENT, COMMIT, PINS, THREAD, FakeClient, RootScriptedModel,
    _call, _run, _tools, complete_root_messages,
)


def _unknown_request(request_id="99999999-9999-4999-8999-999999999999", checkpoint_id="review-checkpoint"):
    return {"requestId": request_id, "requestRevision": 1, "status": "OPEN",
            "assessmentRuleId": "ER-1", "criterionIds": ["C-1"],
            "question": "Who owns the policy?", "unresolvedFact": "Policy owner", "resolvedFactId": None,
            "checkpointId": checkpoint_id,
            "decisionImpact": ["Determines responsibility"], "resolutionAttempts": ["Reviewed sources"],
            "dependencies": [{"assessmentRuleId": "ER-1", "criterionIds": ["C-1"]}],
            "answers": [{"doesNotKnow": True, "answer": None, "checkpointId": checkpoint_id, "requestRevision": 1}]}


_COVERAGE_FIELDS = (
    "assessmentRuleId", "assessmentRuleVersion", "resolutionState",
    "currentDecisionId", "decisionRevision",
)


class CoverageClient(FakeClient):
    """Mutable API snapshot for simulating concurrent authoritative coverage updates."""

    def __init__(self, count=243):
        super().__init__()
        self.current = super().context()
        self.current.update(assessmentId=ASSESSMENT, threadId=THREAD)
        self.current["coverage"] = []
        for index in range(count):
            state = ("PENDING" if index < 200 else "INVESTIGATING" if index < 220
                     else "RESOLVED" if index < 235 else "INVALIDATED")
            self.current["coverage"].append({
                "assessmentRuleId": f"ER-{index:03d}",
                "assessmentRuleVersion": f"version-{index:03d}",
                "resolutionState": state,
                "currentDecisionId": f"decision-{index:03d}" if state in {"RESOLVED", "INVALIDATED"} else None,
                "decisionRevision": 1 if state == "RESOLVED" else 2 if state == "INVALIDATED" else 0,
                "serverOnlyAuditNote": "Not part of the model-facing coverage contract.",
            })
        self.current["coverage"].reverse()
        self.calls.clear()

    def context(self):
        self.calls.append(("context", None))
        return deepcopy(self.current)


def _context(tools):
    return json.loads(tools["get_assessment_context"].invoke({}))


def _page(tools, token, **kwargs):
    return json.loads(tools["get_assessment_coverage"].invoke({
        "snapshot_token": token, **kwargs,
    }))


def _context_page(tools, token, collection, **kwargs):
    return json.loads(tools["get_assessment_context_page"].invoke({
        "snapshot_token": token, "collection": collection, **kwargs,
    }))


def _context_detail(tools, token, collection, index, **kwargs):
    return json.loads(tools["get_assessment_context_detail"].invoke({
        "snapshot_token": token, "collection": collection, "index": index, **kwargs,
    }))


def _expected_rows(client):
    return [
        {key: row[key] for key in _COVERAGE_FIELDS}
        for row in sorted(client.current["coverage"], key=lambda row: row["assessmentRuleId"])
    ]


def test_context_summarizes_all_rules_and_keeps_full_authoritative_identity_caches(tmp_path):
    client = CoverageClient()
    before = deepcopy(client.current)
    run = _run(tmp_path, client)
    tools = _tools(run)

    result = _context(tools)
    summary = result["coverageSummary"]

    assert result["ok"] is True
    assert "coverage" not in result
    assert summary["totalRuleCount"] == 243
    assert summary["resolutionCounts"] == {
        "PENDING": 200, "INVESTIGATING": 20, "RESOLVED": 15, "INVALIDATED": 8,
    }
    assert "currentDecisionCount" not in summary
    assert summary["pageTool"] == "get_assessment_coverage"
    assert summary["defaultPageSize"] == 10
    assert summary["maxPageSize"] == 25
    assert len(summary["snapshotToken"]) == 64
    assert result["caseRevision"] == 0
    assert result["pins"] == PINS
    assert result["decisionScopeId"] == "ASSESSMENT"
    assert run.rule_versions == {
        row["assessmentRuleId"]: row["assessmentRuleVersion"] for row in before["coverage"]
    }
    assert run.decision_revisions == {
        row["assessmentRuleId"]: row["decisionRevision"] for row in before["coverage"]
    }
    assert client.current == before
    assert len(client.context()["coverage"]) == 243
    assert {name for name, _ in client.calls} == {"context"}
    # Regress the 243-row context expansion without assigning a guessed token count.
    assert len(json.dumps(result).encode("utf-8")) < 4000
    assert len(json.dumps(result).encode("utf-8")) < len(json.dumps(before["coverage"]).encode("utf-8")) // 4


def test_large_context_collections_are_paged_and_large_evidence_payload_is_losslessly_bounded(tmp_path):
    client = CoverageClient(count=3)
    client.current["facts"] = [
        {
            "factId": "fact-large", "caseRevision": 0, "kind": "OPERATOR",
            "state": "ACCEPTED", "authority": "HUMAN",
            "statement": "fact-" + ("x" * 12000), "evidenceIds": ["ev-large"],
        }
    ]
    client.current["evidence"] = [
        {
            "evidenceId": "ev-large", "type": "REPOSITORY_SOURCE", "state": "ACCEPTED",
            "payload": {"path": "src/main.ts", "excerpt": "é" * 16000},
        }
    ]
    client.current["humanRequests"] = [
        {
            **_unknown_request(),
            "answers": [{"doesNotKnow": True, "answer": None, "note": "y" * 9000}],
        }
    ]
    client.current["openHumanRequestIds"] = ["99999999-9999-4999-8999-999999999999"]

    tools = _tools(_run(tmp_path, client))
    context = _context(tools)
    collections = context["contextCollections"]

    assert "facts" not in context and "evidence" not in context and "humanRequests" not in context
    assert collections["counts"] == {
        "facts": 1, "evidence": 1, "humanRequests": 1, "openHumanRequestIds": 1,
    }
    assert len(json.dumps(context, ensure_ascii=False).encode("utf-8")) < 4096

    token = collections["snapshotToken"]
    evidence_page = _context_page(tools, token, "evidence")
    assert len(json.dumps(evidence_page, ensure_ascii=False).encode("utf-8")) <= 4096
    assert evidence_page["items"][0]["evidenceId"] == "ev-large"
    assert evidence_page["items"][0]["detailRequired"] is True
    assert "payload" not in evidence_page["items"][0]

    first = _context_detail(
        tools, token, "evidence", evidence_page["items"][0]["detailIndex"],
        pointer="/payload/excerpt", max_chars=4000,
    )
    assert first["ok"] is True
    assert first["detail"]["kind"] == "TEXT_FRAGMENT"
    assert len(json.dumps(first, ensure_ascii=False).encode("utf-8")) <= 4096
    pieces = [first["detail"]["text"]]
    offset = first["detail"]["nextOffset"]
    while offset is not None:
        page = _context_detail(
            tools, token, "evidence", 0,
            pointer="/payload/excerpt", offset=offset, max_chars=4000,
        )
        assert len(json.dumps(page, ensure_ascii=False).encode("utf-8")) <= 4096
        pieces.append(page["detail"]["text"])
        offset = page["detail"]["nextOffset"]
    assert "".join(pieces) == "é" * 16000


@pytest.mark.parametrize("limit", [10, 25])
def test_following_pages_recovers_every_rule_and_current_decision_exactly_once(tmp_path, limit):
    client = CoverageClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _context(tools)["coverageSummary"]["snapshotToken"]
    before = deepcopy(client.current)
    before_reads = len(client.calls)
    expected = _expected_rows(client)
    rows, offsets = [], []
    offset = 0

    while offset is not None:
        page = _page(tools, token, offset=offset, limit=limit)
        assert page["ok"] is True
        assert page["snapshotToken"] == token
        assert page["caseRevision"] == 0
        assert page["totalRuleCount"] == 243
        assert page["offset"] == offset
        assert page["limit"] == limit
        assert len(page["coverage"]) <= limit
        assert page["coverage"] == expected[offset:offset + limit]
        assert all(set(row) == set(_COVERAGE_FIELDS) for row in page["coverage"])
        offsets.append(offset)
        rows.extend(page["coverage"])
        offset = page["nextOffset"]
        assert len(offsets) <= 25, "A continuation must advance or finish."
        if offset is not None:
            assert offset == offsets[-1] + limit

    assert rows == expected
    assert len({row["assessmentRuleId"] for row in rows}) == 243
    # Invalidation preserves the packet pointer for audit; the state prevents treating it as resolved.
    invalidated = [row for row in rows if row["resolutionState"] == "INVALIDATED"]
    assert len(invalidated) == 8
    assert {row["currentDecisionId"] for row in invalidated} == {
        f"decision-{index:03d}" for index in range(235, 243)
    }
    assert all(row["decisionRevision"] == 2 for row in invalidated)
    assert len(client.calls) - before_reads == len(offsets)
    assert client.current == before
    assert {name for name, _ in client.calls} == {"context"}


def test_default_page_is_bounded_and_exact_end_is_an_empty_final_page(tmp_path):
    client = CoverageClient()
    tools = _tools(_run(tmp_path, client))
    token = _context(tools)["coverageSummary"]["snapshotToken"]

    first = _page(tools, token)
    assert first["limit"] == len(first["coverage"]) == 10
    assert first["offset"] == 0 and first["nextOffset"] == 10

    last = _page(tools, token, offset=240)
    assert last["coverage"] == _expected_rows(client)[240:]
    assert last["nextOffset"] is None

    end = _page(tools, token, offset=243)
    assert end["coverage"] == [] and end["nextOffset"] is None

    beyond = _page(tools, token, offset=244)
    assert beyond["ok"] is False and beyond["code"] == "INVALID_COVERAGE_OFFSET"
    assert "coverage" not in beyond


def test_empty_scope_reports_zero_and_never_invents_a_coverage_row(tmp_path):
    client = CoverageClient(count=0)
    tools = _tools(_run(tmp_path, client))
    summary = _context(tools)["coverageSummary"]

    assert summary["totalRuleCount"] == 0
    assert "currentDecisionCount" not in summary
    assert summary["resolutionCounts"] == {}
    page = _page(tools, summary["snapshotToken"])
    assert page["ok"] is True
    assert page["totalRuleCount"] == 0
    assert page["coverage"] == []
    assert page["nextOffset"] is None


@pytest.mark.parametrize("field,value", [
    ("resolutionState", "INVESTIGATING"),
    ("currentDecisionId", "new-current-decision"),
    ("decisionRevision", 3),
    ("assessmentRuleVersion", "replacement-version"),
    ("assessmentRuleId", "ER-replacement"),
])
def test_coverage_changes_without_case_revision_invalidate_existing_pages(tmp_path, field, value):
    client = CoverageClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _context(tools)["coverageSummary"]["snapshotToken"]
    versions, revisions = dict(run.rule_versions), dict(run.decision_revisions)
    target = next(row for row in client.current["coverage"] if row["assessmentRuleId"] == "ER-000")
    target[field] = value

    result = _page(tools, token, offset=10)

    assert client.current["caseRevision"] == 0
    assert result["ok"] is False and result["code"] == "COVERAGE_SNAPSHOT_STALE"
    assert "coverage" not in result
    assert "get_assessment_context" in result["hint"]
    assert run.rule_versions == versions and run.decision_revisions == revisions
    assert {name for name, _ in client.calls} == {"context"}


@pytest.mark.parametrize("change", ["added", "removed"])
def test_rule_membership_changes_invalidate_page_continuation(tmp_path, change):
    client = CoverageClient()
    tools = _tools(_run(tmp_path, client))
    token = _context(tools)["coverageSummary"]["snapshotToken"]
    if change == "added":
        client.current["coverage"].append({
            **client.current["coverage"][0], "assessmentRuleId": "ER-new",
        })
    else:
        client.current["coverage"].pop()

    result = _page(tools, token, offset=10)

    assert result["ok"] is False and result["code"] == "COVERAGE_SNAPSHOT_STALE"
    assert "coverage" not in result


@pytest.mark.parametrize("field,value", [
    ("caseRevision", 1),
    ("ruleSetVersionId", "new-rule-set"),
    ("repositorySnapshotId", "new-snapshot"),
    ("repositoryCommit", "b" * 40),
    ("sourcePathPrefix", "src"),
    ("repositoryScanJobId", "new-scan"),
    ("decisionScopeId", "new-decision-scope"),
])
def test_changed_case_revision_or_source_pins_reject_old_snapshot_before_cache_adoption(tmp_path, field, value):
    client = CoverageClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _context(tools)["coverageSummary"]["snapshotToken"]
    original_pins = deepcopy(run.pins)
    client.current[field] = value

    result = _page(tools, token)

    assert result["ok"] is False and result["code"] == "COVERAGE_SNAPSHOT_STALE"
    assert "coverage" not in result
    assert run.case_revision == 0
    assert run.pins == original_pins
    assert run.source_path_prefix is None


@pytest.mark.parametrize("identity,server_identity", [
    ("assessment_id", "assessmentId"),
    ("thread_id", "threadId"),
])
def test_same_rules_and_revision_cannot_reuse_a_foreign_case_or_thread_token(tmp_path, identity, server_identity):
    client = CoverageClient()
    run = _run(tmp_path, client)
    token = _context(_tools(run))["coverageSummary"]["snapshotToken"]
    client.current[server_identity] = "different-server-owned-identity"
    other_run = replace(run, **{identity: "different-server-owned-identity"})

    result = _page(_tools(other_run), token)

    assert result["ok"] is False and result["code"] == "COVERAGE_SNAPSHOT_STALE"
    assert "coverage" not in result
    assert {name for name, _ in client.calls} == {"context"}


def test_api_row_reordering_keeps_stable_snapshot_and_page_order(tmp_path):
    client = CoverageClient()
    tools = _tools(_run(tmp_path, client))
    token = _context(tools)["coverageSummary"]["snapshotToken"]
    expected = _expected_rows(client)
    client.current["coverage"].reverse()

    assert _context(tools)["coverageSummary"]["snapshotToken"] == token
    page = _page(tools, token, offset=10, limit=25)
    assert page["ok"] is True and page["coverage"] == expected[10:35]


@pytest.mark.parametrize("arguments", [
    {},
    {"snapshot_token": ""},
    {"snapshot_token": "not-a-snapshot"},
    {"snapshot_token": "g" * 64},
    {"snapshot_token": "a" * 63},
    {"snapshot_token": "a" * 65},
    {"snapshot_token": "a" * 64, "limit": 0},
    {"snapshot_token": "a" * 64, "limit": 26},
    {"snapshot_token": "a" * 64, "limit": 1.5},
    {"snapshot_token": "a" * 64, "offset": -1},
    {"snapshot_token": "a" * 64, "offset": 0.5},
    {"snapshot_token": "a" * 64, "assessment_id": "caller-selected"},
])
def test_invalid_page_arguments_fail_before_any_authoritative_read(tmp_path, arguments):
    client = CoverageClient()
    tools = _tools(_run(tmp_path, client))
    before = list(client.calls)

    result = json.loads(tools["get_assessment_coverage"].invoke(arguments))

    assert result["ok"] is False and result["code"] == "INVALID_TOOL_ARGUMENTS"
    assert "coverage" not in result
    assert client.calls == before


def test_well_formed_but_unissued_snapshot_cannot_return_rows(tmp_path):
    client = CoverageClient()
    tools = _tools(_run(tmp_path, client))
    result = _page(tools, "f" * 64)

    assert result["ok"] is False and result["code"] == "COVERAGE_SNAPSHOT_STALE"
    assert "coverage" not in result


def test_expired_lease_error_does_not_return_locally_cached_coverage(tmp_path, monkeypatch):
    client = CoverageClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _context(tools)["coverageSummary"]["snapshotToken"]

    def reject_context():
        raise AssessmentApiError(403, "ASSESSMENT_EXECUTION_LEASE_INVALID")

    monkeypatch.setattr(client, "context", reject_context)
    result = _page(tools, token)

    assert result["ok"] is False and result["code"] == "ASSESSMENT_EXECUTION_LEASE_INVALID"
    assert "coverage" not in result
    assert len(run.rule_versions) == 243


def test_reloading_after_decision_update_returns_new_snapshot_and_exact_current_packet_identity(tmp_path):
    client = CoverageClient()
    tools = _tools(_run(tmp_path, client))
    old = _context(tools)["coverageSummary"]["snapshotToken"]
    changed = next(row for row in client.current["coverage"] if row["assessmentRuleId"] == "ER-000")
    changed.update(resolutionState="RESOLVED", currentDecisionId="accepted-new-packet", decisionRevision=1)

    new_context = _context(tools)
    fresh = new_context["coverageSummary"]["snapshotToken"]
    assert fresh != old
    assert new_context["coverageSummary"]["resolutionCounts"]["RESOLVED"] == 16
    assert "currentDecisionCount" not in new_context["coverageSummary"]
    assert _page(tools, old)["code"] == "COVERAGE_SNAPSHOT_STALE"
    page = _page(tools, fresh)
    assert page["ok"] is True
    assert page["coverage"][0] == {key: changed[key] for key in _COVERAGE_FIELDS}


def test_compact_header_retains_fact_authority_evidence_human_audit_and_scoped_view_limits(tmp_path):
    client = CoverageClient()
    client.current.update(sourcePathPrefix="src", caseRevision=2, lifecycleState="WAITING_FOR_HUMAN")
    client.current["facts"] = [
        {"factId": "source-fact", "caseRevision": 1, "kind": "USE_CASE", "state": "ACCEPTED",
         "authority": "EVIDENCE_CITED", "statement": "Source code implements local retention.",
         "evidenceIds": ["source-evidence"]},
        {"factId": "operator-fact", "caseRevision": 2, "kind": "FACT", "state": "ACCEPTED",
         "authority": "HUMAN_PROVIDED", "statement": "The respondent manages the service.",
         "evidenceIds": []},
    ]
    client.current["evidence"] = [{
        "evidenceId": "source-evidence", "type": "REPOSITORY_SOURCE", "state": "ACCEPTED",
        "payload": {"path": "src/retention.py", "startLine": 3, "endLine": 3, "excerptSha256": "c" * 64},
    }]
    request = _unknown_request()
    client.current["humanRequests"] = [request]
    client.current["openHumanRequestIds"] = [request["requestId"]]
    before = deepcopy(client.current)
    run = _run(tmp_path, client)
    marker_dir = tmp_path / "repo/.lcsp"
    marker_dir.mkdir()
    view = {
        "sourcePathPrefix": "src", "coverageLimited": True, "includedFiles": 1,
        "skippedEntries": [{"path": "src/large.bin", "reason": "FILE_SIZE_LIMIT", "sha256": "d" * 64}],
        "sourceScopeExcludedEntryCount": 1,
        "sourceScopeExcludedEntries": [{"path": "other/private.txt", "reason": "SOURCE_SCOPE_EXCLUDED"}],
        "sourceScopeExclusionsTruncated": False,
    }
    marker_dir.joinpath("repository.json").write_text(json.dumps({
        "assessmentId": ASSESSMENT, "snapshotId": PINS["repositorySnapshotId"],
        "commitSha": COMMIT, "sourcePathPrefix": "src", "sourceCoverage": view,
    }), encoding="utf-8")

    result = _context(_tools(run))

    assert result["pins"] == PINS
    assert result["caseRevision"] == 2
    assert result["sourcePathPrefix"] == "src"
    collections = result["contextCollections"]
    assert collections["counts"] == {
        "facts": 2, "evidence": 1, "humanRequests": 1, "openHumanRequestIds": 1,
    }
    token = collections["snapshotToken"]
    facts = _context_page(_tools(run), token, "facts")["items"]
    evidence = _context_page(_tools(run), token, "evidence")["items"]
    human = _context_page(_tools(run), token, "humanRequests")["items"]
    open_ids = _context_page(_tools(run), token, "openHumanRequestIds")["items"]
    assert facts == before["facts"]
    assert evidence == before["evidence"]
    assert human == before["humanRequests"]
    assert open_ids == before["openHumanRequestIds"]
    assert human[0]["answers"][-1]["doesNotKnow"] is True
    assert human[0]["resolvedFactId"] is None
    assert result["repositoryView"] == {
        key: value for key, value in view.items()
        if key not in {"sourceScopeExcludedEntries", "sourceScopeExclusionsTruncated"}
    }
    assert "other/private.txt" not in json.dumps(result)
    assert client.current == before
    assert {name for name, _ in client.calls} == {"context"}

# Compact model descriptions must leave executable native contracts and governance unchanged.
_REVIEWED_TOOL_NAMES = (
    "ls", "read_file", "write_file", "edit_file", "delete",
    "glob", "grep", "task", "write_todos", "retrieve_shared_heuristics",
)


class DescriptionProbeArgs(BaseModel):
    pattern: str = Field(min_length=1)


def _description_probe_tool(name, calls, *, return_direct):
    """Build an offline probe for both native loop-control modes in the preservation test."""
    def sync_probe(pattern):
        """Return the probe name, unchanged pattern and exact literal-match result.

        Record this synchronous offline invocation in memory only; perform no external actions.
        """
        calls.append(("sync", name, pattern))
        return {"tool": name, "pattern": pattern, "matched": pattern == "literal"}

    async def async_probe(pattern):
        """Return the probe name, unchanged pattern and exact literal-match result.

        Record this asynchronous offline invocation in memory only; perform no external actions.
        """
        calls.append(("async", name, pattern))
        return {"tool": name, "pattern": pattern, "matched": pattern == "literal"}

    def invalid_pattern(error):
        return "INVALID_PATTERN"

    return StructuredTool.from_function(
        func=sync_probe, coroutine=async_probe, name=name,
        description='Offline contract probe for middleware tests. Given a non-empty pattern, record whether the synchronous or asynchronous callable ran and return a deterministic mapping containing the probe name, unchanged pattern, and whether it equals literal. The probe reads no repository files, writes no customer state, uses no credentials, and calls no external service. Tests compare original and description-projected tools across both native loop-control modes. The argument schema, callable identities, metadata, tags, validation handling, response format and returned values must remain identical after projecting the shorter model-facing description.',
        args_schema=DescriptionProbeArgs, return_direct=return_direct,
        metadata={"authority": "source", "tool": name}, tags=["source-read"],
        handle_validation_error=invalid_pattern, handle_tool_error=True,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sync", "async"])
@pytest.mark.parametrize("return_direct", [False, True], ids=["continue-loop", "return-direct"])
async def test_description_projection_preserves_every_tool_contract_and_invokes_governance_once(mode, return_direct):
    calls = []
    known = [_description_probe_tool(name, calls, return_direct=return_direct) for name in _REVIEWED_TOOL_NAMES]
    unknown = _description_probe_tool("unreviewed_tool", calls, return_direct=return_direct)
    provider_tool = {"type": "provider-native-search", "provider_options": {"bounded": True}}
    original = [*known, unknown, provider_tool]
    descriptions = [tool.description for tool in known]
    request = ModelRequest(
        model=RootScriptedModel(), messages=[HumanMessage("Inspect the source.")],
        system_message=SystemMessage("Retain all authority checks."),
        tools=original, model_settings={"temperature": 0.0}, tool_choice="auto",
    )
    projected = []
    response = ModelResponse(result=[AIMessage(content="Governed response.")])

    def governed_handler(bound):
        projected.append(bound)
        return response

    async def governed_async_handler(bound):
        projected.append(bound)
        return response

    middleware = AssessmentToolDescriptionsMiddleware()
    result = (middleware.wrap_model_call(request, governed_handler) if mode == "sync"
              else await middleware.awrap_model_call(request, governed_async_handler))

    assert result is response and len(projected) == 1
    bound = projected[0]
    assert bound is not request
    assert bound.model is request.model
    assert bound.messages is request.messages
    assert bound.system_message is request.system_message
    assert bound.model_settings == request.model_settings
    assert bound.tool_choice == request.tool_choice
    assert len(bound.tools) == len(original)
    assert [tool.name for tool in bound.tools[:-1]] == [tool.name for tool in original[:-1]]
    assert bound.tools[-2] is unknown and bound.tools[-1] is provider_tool
    assert request.tools == original
    assert [tool.description for tool in known] == descriptions

    for before, after in zip(known, bound.tools):
        assert after is not before
        assert after.description != before.description
        assert len(after.description) < len(before.description)
        for field in ("args_schema", "func", "coroutine", "metadata", "tags",
                      "handle_validation_error", "handle_tool_error"):
            assert getattr(after, field) is getattr(before, field)
        assert after.return_direct is before.return_direct is return_direct
        assert after.response_format == before.response_format
        assert after.args_schema.model_json_schema() == before.args_schema.model_json_schema()
        if mode == "sync":
            assert after.invoke({"pattern": "literal"}) == before.invoke({"pattern": "literal"})
        else:
            assert await after.ainvoke({"pattern": "literal"}) == await before.ainvoke({"pattern": "literal"})
    assert len(calls) == len(known) * 2
    assert {entry[0] for entry in calls} == {mode}
    grep = next(tool for tool in bound.tools if getattr(tool, "name", None) == "grep")
    assert "literal" in grep.description and "never regex" in grep.description
    validation = (grep.invoke({"pattern": ""}) if mode == "sync"
                  else await grep.ainvoke({"pattern": ""}))
    assert validation == "INVALID_PATTERN"
    assert len(calls) == len(known) * 2
    todos = next(tool for tool in bound.tools if getattr(tool, "name", None) == "write_todos")
    assert all(status in todos.description for status in ("pending", "in_progress", "completed"))


def test_native_root_keeps_registered_todos_grep_and_full_catalog_with_compact_model_descriptions(tmp_path):
    class CaptureGovernedRequest(AgentMiddleware):
        def __init__(self):
            self.requests = []

        def wrap_model_call(self, request, handler):
            self.requests.append(request)
            return handler(request)

    client = FakeClient()
    run = _run(tmp_path, client)
    task = "Inspect the source retention setting"
    model = RootScriptedModel(responses=[
        _call("write_todos", {"todos": [{"content": task, "status": "in_progress"}]}, "todo-start"),
        _call("grep", {"pattern": "keep_.*", "path": "/src", "output_mode": "content"}, "literal-search"),
        _call("grep", {"pattern": "keep_days", "path": "/src", "output_mode": "content"}, "source-search"),
        _call("write_todos", {"todos": [{"content": task, "status": "completed"}]}, "todo-finish"),
        *complete_root_messages(),
    ])
    governed = CaptureGovernedRequest()
    agent = create_assessment_root_agent(
        run=run, model=model, governance=[governed], checkpointer=InMemorySaver(),
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "Inspect the local source and complete the test."}]},
        config={"configurable": {"thread_id": THREAD}},
    )

    registered_by_name = agent.get_graph().nodes["tools"].data.tools_by_name
    registered = [registered_by_name[name] for name in model.bound_tool_names[0]]
    assert governed.requests
    for request in governed.requests:
        assert len(request.tools) == len(registered) == 38
        assert {tool.name for tool in registered} == set(ROOT_TOOL_NAMES) | {"ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "task", "write_todos", "search_code_graph", "search_code_text", "get_repository_architecture", "trace_call_path"}
        assert [tool.name for tool in request.tools] == [tool.name for tool in registered]
        for shown in request.tools:
            native = registered_by_name[shown.name]
            assert shown.args_schema is native.args_schema
            assert getattr(shown, "func", None) is getattr(native, "func", None)
            assert getattr(shown, "coroutine", None) is getattr(native, "coroutine", None)
            assert shown.return_direct == native.return_direct
            if shown.name == "grep":
                assert "LITERAL" in shown.description
                assert "execute tool" not in shown.description
            else:
                assert shown.description == native.description
        prompt_content = request.system_message.content
        prompt = (prompt_content if isinstance(prompt_content, str) else "\n".join(
            block if isinstance(block, str) else block.get("text", "") for block in prompt_content
        ))
    from runtime_instruction_bundle import production_runtime_bundle
    from middleware.approved_instructions import approved_tool_specs
    bundle = production_runtime_bundle()
    assert model.bound_tools[0] == approved_tool_specs(registered, bundle)
    for messages in model.prompts:
        system = next(message.content for message in messages if isinstance(message, SystemMessage))
        assert bundle.instruction("assessment-root.system") in system
        assert json.loads(bundle.instruction("framework.injected-policy"))["todo_system"] in system
    model_tools = {item["function"]["name"]: item["function"] for item in model.bound_tools[0]}
    assert model_tools["grep"]["description"] == json.loads(bundle.instruction("framework.injected-policy"))["tool.grep"]
    assert all(status in model_tools["write_todos"]["description"] for status in ("pending", "in_progress", "completed"))
    assert result["todos"] == [{"content": task, "status": "completed"}]
    tool_results = {
        message.tool_call_id: str(message.content)
        for message in result["messages"] if isinstance(message, ToolMessage)
    }
    assert "retention.py" not in tool_results["literal-search"]
    assert "retention.py" in tool_results["source-search"]
    assert "keep_days = 7" in tool_results["source-search"]
    assert "in_progress" in tool_results["todo-start"]
    assert "completed" in tool_results["todo-finish"]
    assert client.lifecycle_state == "COMPLETE"

# A caller-selected row limit must not bypass the serialized catalog reply budget.
class CatalogClient(CoverageClient):
    def __init__(self, count=243, *, long_concepts=True):
        super().__init__(count=count)
        self.rule_set_override = {
            "ruleSetVersionId": PINS["ruleSetVersionId"],
            "assessmentRules": [
                {
                    "assessmentRuleId": f"ER-{index:03d}",
                    "assessmentRuleVersion": f"version-{index:03d}",
                    "concept": (f"Rule {index}: " + ("Yêu cầu bảo vệ dữ liệu và lưu trữ nguồn. " * 4)
                                if long_concepts else f"Rule {index}"),
                    "legalRequirementIds": [f"LR-{index * 2:03d}", f"LR-{index * 2 + 1:03d}"],
                    "criteria": [
                        {"criterionId": f"C-{index:03d}-{part}", "statement": f"Source-defined criterion {part}."}
                        for part in range(2)
                    ],
                }
                for index in range(count)
            ],
            "legalRequirements": [
                {"legalRequirementId": f"LR-{index:03d}", "title": f"Requirement {index}",
                 "proposition": f"Apply source-defined requirement {index}."}
                for index in range(633)
            ],
            "contextRelations": [],
        }


def _catalog_page(tools, **arguments):
    raw = tools["get_pinned_rule_set"].invoke(arguments)
    assert len(raw.encode("utf-8")) <= 4096
    return json.loads(raw)


def _catalog_rows(client):
    return [
        {"assessmentRuleId": rule["assessmentRuleId"], "assessmentRuleVersion": rule["assessmentRuleVersion"],
         "concept": rule["concept"], "legalRequirementIds": rule["legalRequirementIds"],
         "criterionIds": [criterion["criterionId"] for criterion in rule["criteria"]]}
        for rule in client.rule_set_override["assessmentRules"]
    ]


def test_catalog_requested_fifty_rows_never_exceeds_bytes_or_skips_any_of_243_rules(tmp_path):
    client = CatalogClient()
    before = deepcopy(client.rule_set_override)
    run = _run(tmp_path, client)
    run.rule_versions.clear()
    run.rule_criteria.clear()
    tools = _tools(run)
    expected = _catalog_rows(client)
    collected, page_sizes = [], []
    offset = 0

    while offset is not None:
        page = _catalog_page(tools, offset=offset, limit=50)
        assert page["ok"] is True
        assert page["ruleSetVersionId"] == PINS["ruleSetVersionId"]
        assert page["assessmentRuleCount"] == 243
        assert page["legalRequirementCount"] == 633
        rows = page["assessmentRules"]
        assert 0 < len(rows) <= 50
        assert rows == expected[offset:offset + len(rows)]
        assert all(set(row) == {
            "assessmentRuleId", "assessmentRuleVersion", "concept", "legalRequirementIds", "criterionIds",
        } for row in rows)
        end = offset + len(rows)
        assert page["nextOffset"] == (end if end < 243 else None)
        collected.extend(rows)
        page_sizes.append(len(rows))
        assert len(page_sizes) <= 243
        # The first bounded page must not bound the authoritative version/criterion caches.
        assert run.rule_versions == {
            rule["assessmentRuleId"]: rule["assessmentRuleVersion"] for rule in before["assessmentRules"]
        }
        assert run.rule_criteria == {
            rule["assessmentRuleId"]: [criterion["criterionId"] for criterion in rule["criteria"]]
            for rule in before["assessmentRules"]
        }
        offset = page["nextOffset"]

    assert collected == expected
    assert len({row["assessmentRuleId"] for row in collected}) == 243
    assert max(page_sizes) < 50
    assert client.rule_set_override == before
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


def test_oversized_unicode_catalog_summary_links_to_the_exact_complete_rule_detail(tmp_path):
    client = CatalogClient(count=3, long_concepts=False)
    concept = ('Bảo vệ "dữ liệu" \\ biểu mẫu 😀\n' * 240)
    client.rule_set_override["assessmentRules"][1]["concept"] = concept
    before = deepcopy(client.rule_set_override)
    tools = _tools(_run(tmp_path, client))

    first = _catalog_page(tools, limit=50)
    assert first["assessmentRules"] == _catalog_rows(client)[:1]
    assert first["nextOffset"] == 1
    second = _catalog_page(tools, offset=first["nextOffset"], limit=50)
    assert second["assessmentRules"] == [
        {"assessmentRuleId": "ER-001", "assessmentRuleVersion": "version-001",
         "detailRequired": True, "detailTool": "get_assessment_rule"},
        _catalog_rows(client)[2],
    ]
    assert second["nextOffset"] is None
    assert second["assessmentRuleCount"] == 3 and second["legalRequirementCount"] == 633

    raw = tools["get_assessment_rule"].invoke({"assessment_rule_id": "ER-001"})
    assert len(raw.encode("utf-8")) <= 4096
    overview = json.loads(raw)
    assert overview["detailRequired"] is True
    assert overview["detailTool"] == "get_assessment_rule_detail"
    token, offset, fragments = overview["detailToken"], 0, []
    while offset is not None:
        raw = tools["get_assessment_rule_detail"].invoke({
            "assessment_rule_id": "ER-001", "detail_token": token,
            "pointer": "/assessmentRule/concept", "offset": offset, "max_chars": 4000,
        })
        assert len(raw.encode("utf-8")) <= 4096
        result = json.loads(raw)
        assert result["ok"] is True
        view = result["detail"]
        assert view["kind"] == "TEXT_FRAGMENT"
        assert view["offset"] == offset and view["offsetUnit"] == "UNICODE_CODE_POINTS"
        assert view["totalCharacters"] == len(concept)
        assert view["sha256"] == hashlib.sha256(concept.encode("utf-8")).hexdigest()
        assert view["text"] == concept[offset:offset + len(view["text"])]
        fragments.append(view["text"])
        end = offset + len(view["text"])
        assert view["nextOffset"] == (end if end < len(concept) else None)
        offset = view["nextOffset"]

    assert "".join(fragments) == concept
    assert client.rule_set_override == before
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


@pytest.mark.parametrize("field", ["assessmentRuleId", "assessmentRuleVersion", "ruleSetVersionId"])
def test_oversized_catalog_identity_fails_closed_without_a_continuation(tmp_path, field):
    client = CatalogClient(count=1)
    if field == "ruleSetVersionId":
        client.rule_set_override[field] = "界" * 2000
    else:
        client.rule_set_override["assessmentRules"][0][field] = "界" * 2000
    before = deepcopy(client.rule_set_override)
    tools = _tools(_run(tmp_path, client))

    result = _catalog_page(tools, limit=50)

    assert result["ok"] is False and result["code"] == "RULE_CATALOG_METADATA_TOO_LARGE"
    assert "assessmentRules" not in result and "nextOffset" not in result
    assert client.rule_set_override == before
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


@pytest.mark.parametrize("limit", [None, 1, 10])
def test_catalog_default_and_narrow_requested_limits_remain_upper_bounds(tmp_path, limit):
    client = CatalogClient(long_concepts=False)
    tools = _tools(_run(tmp_path, client))
    page = _catalog_page(tools, **({} if limit is None else {"limit": limit}))
    effective = 10 if limit is None else limit

    assert page["assessmentRules"] == _catalog_rows(client)[:effective]
    assert page["nextOffset"] == effective
    assert page["assessmentRuleCount"] == 243 and page["legalRequirementCount"] == 633


@pytest.mark.parametrize("count,offset", [(0, 0), (243, 243), (243, 244)])
def test_catalog_empty_and_past_end_pages_preserve_totals_without_inventing_rows(tmp_path, count, offset):
    client = CatalogClient(count=count)
    tools = _tools(_run(tmp_path, client))

    result = _catalog_page(tools, offset=offset, limit=50)

    assert result["ok"] is True
    assert result["assessmentRules"] == []
    assert result["nextOffset"] is None
    assert result["assessmentRuleCount"] == count
    assert result["legalRequirementCount"] == 633


@pytest.mark.parametrize("arguments", [{"limit": 0}, {"limit": 51}, {"offset": -1}])
def test_catalog_invalid_limits_still_fail_before_the_pinned_api_read(tmp_path, arguments):
    client = CatalogClient()
    tools = _tools(_run(tmp_path, client))
    before = list(client.calls)

    result = _catalog_page(tools, **arguments)

    assert result["ok"] is False and result["code"] == "INVALID_TOOL_ARGUMENTS"
    assert client.calls == before


# Selected-audit authority is retained independently of payload size and paging.
def _selected_request(rule_ids, *, request_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"):
    return {"requestId": request_id, "scopeMode": "SELECTED_RULES", "status": "RUNNING",
            "selectedRuleIds": list(rule_ids)}


def test_compact_context_keeps_authorized_request_and_only_its_coverage(tmp_path):
    client = CoverageClient()
    selected = ["ER-002", "ER-007"]
    request = _selected_request(selected)
    client.current["auditRequest"] = request
    client.current["coverage"] = [row for row in client.current["coverage"]
                                  if row["assessmentRuleId"] in selected]
    before = deepcopy(client.current)
    run = _run(tmp_path, client)
    tools = _tools(run)

    result = _context(tools)
    page = _page(tools, result["coverageSummary"]["snapshotToken"])

    assert result["auditRequest"] == request
    assert run.audit_request == request
    assert result["coverageSummary"]["totalRuleCount"] == 2
    assert result["coverageSummary"]["resolutionCounts"] == {"PENDING": 2}
    assert [row["assessmentRuleId"] for row in page["coverage"]] == selected
    assert page["nextOffset"] is None
    assert set(run.rule_versions) == set(selected)
    assert client.current == before


@pytest.mark.parametrize("patch", [
    {"requestId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
    {"scopeMode": "FULL_RULE_SET"},
    {"status": "COMPLETED"},
])
def test_same_coverage_cannot_reuse_token_after_audit_authority_changes(tmp_path, patch):
    client = CoverageClient(count=2)
    client.current["auditRequest"] = _selected_request(["ER-000", "ER-001"])
    run = _run(tmp_path, client)
    tools = _tools(run)
    original = _context(tools)
    old_request = deepcopy(run.audit_request)
    unchanged_rows = deepcopy(client.current["coverage"])
    client.current["auditRequest"].update(patch)

    stale = _page(tools, original["coverageSummary"]["snapshotToken"])

    assert stale["ok"] is False and stale["code"] == "COVERAGE_SNAPSHOT_STALE"
    assert "coverage" not in stale
    assert run.audit_request == old_request
    assert client.current["coverage"] == unchanged_rows
    current = _context(tools)
    assert current["auditRequest"] == client.current["auditRequest"]
    assert current["coverageSummary"]["snapshotToken"] != original["coverageSummary"]["snapshotToken"]
    assert _page(tools, current["coverageSummary"]["snapshotToken"])["coverage"] == _expected_rows(client)


def test_bounded_catalog_traverses_only_selected_rules_and_keeps_full_pinned_total(tmp_path):
    client = CatalogClient()
    selected = [f"ER-{index:03d}" for index in range(0, 243, 3)]
    client.current["auditRequest"] = _selected_request(selected)
    client.current["coverage"] = [row for row in client.current["coverage"]
                                  if row["assessmentRuleId"] in selected]
    run = _run(tmp_path, client)
    run.rule_versions.clear()
    run.rule_criteria.clear()
    tools = _tools(run)
    expected = [row for row in _catalog_rows(client) if row["assessmentRuleId"] in selected]
    collected = []
    offset = 0
    pages = 0

    while offset is not None:
        page = _catalog_page(tools, offset=offset, limit=50)
        assert page["ok"] is True
        assert page["assessmentRuleCount"] == len(selected)
        assert page["totalPinnedRuleCount"] == 243
        assert page["legalRequirementCount"] == 633
        rows = page["assessmentRules"]
        assert rows == expected[offset:offset + len(rows)]
        assert rows
        collected.extend(rows)
        end = offset + len(rows)
        assert page["nextOffset"] == (end if end < len(selected) else None)
        offset = page["nextOffset"]
        pages += 1
        assert pages <= len(selected)

    assert pages > 1
    assert collected == expected
    assert {row["assessmentRuleId"] for row in collected} == set(selected)
    assert set(run.rule_versions) == set(selected)
    assert set(run.rule_criteria) == set(selected)
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


@pytest.mark.parametrize("cache_state", ["uninitialized", "previous_request"])
def test_catalog_refreshes_current_selection_before_returning_any_rule(tmp_path, cache_state):
    client = CatalogClient(count=3, long_concepts=False)
    client.current["auditRequest"] = _selected_request(["ER-000"])
    client.current["coverage"] = [row for row in client.current["coverage"]
                                  if row["assessmentRuleId"] == "ER-000"]
    run = _run(tmp_path, client)
    if cache_state == "uninitialized":
        run.pins.clear()
        run.audit_request = None
    current_request = _selected_request(["ER-002"], request_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    client.current["auditRequest"] = current_request
    client.current["coverage"] = [{"assessmentRuleId": "ER-002", "assessmentRuleVersion": "version-002",
                                  "resolutionState": "PENDING", "currentDecisionId": None, "decisionRevision": 0}]
    client.calls.clear()

    page = _catalog_page(_tools(run), limit=50)

    assert page["assessmentRuleCount"] == 1
    assert page["totalPinnedRuleCount"] == 3
    assert [row["assessmentRuleId"] for row in page["assessmentRules"]] == ["ER-002"]
    assert page["nextOffset"] is None
    assert run.audit_request == current_request
    assert [name for name, _ in client.calls] == ["context", "rule_set"]


@pytest.mark.parametrize("invalid_audit_request", [
    {},
    {"requestId": "audit", "scopeMode": "SELECTED_RULES", "status": "RUNNING", "selectedRuleIds": []},
    {"requestId": "audit", "scopeMode": "SELECTED_RULES", "status": "RUNNING", "selectedRuleIds": "ER-000"},
    {"requestId": "audit", "scopeMode": "SELECTED_RULES", "status": "RUNNING", "selectedRuleIds": [""]},
    {"requestId": "audit", "scopeMode": "SELECTED_RULES", "status": "RUNNING", "selectedRuleIds": [None]},
    {"requestId": None, "scopeMode": "SELECTED_RULES", "status": "RUNNING", "selectedRuleIds": ["ER-000"]},
    {"requestId": "audit", "scopeMode": "UNKNOWN_MODE", "status": "RUNNING", "selectedRuleIds": ["ER-000"]},
    {"requestId": "audit", "scopeMode": "SELECTED_RULES", "status": None, "selectedRuleIds": ["ER-000"]},
])
def test_malformed_present_audit_request_cannot_fall_back_to_full_catalog(tmp_path, invalid_audit_request):
    client = CatalogClient(count=3)
    run = _run(tmp_path, client)
    client.current["auditRequest"] = invalid_audit_request
    client.calls.clear()

    with pytest.raises(RuntimeError, match="authorized rule scope"):
        _catalog_page(_tools(run), limit=50)

    assert [name for name, _ in client.calls] == ["context"]
    assert run.audit_request is None


def test_selected_request_completion_keeps_native_partial_audit_boundary(tmp_path):
    class SelectedCompletionClient(FakeClient):
        def __init__(self):
            super().__init__()
            self.request = _selected_request(["ER-1"])

        def context(self):
            return {**super().context(), "auditRequest": deepcopy(self.request)}

        def request_finalization(self):
            self.calls.append(("finalization", None))
            self.request["status"] = "COMPLETED"
            return {"blockers": [], "auditRequest": deepcopy(self.request)}

    client = SelectedCompletionClient()
    run = _run(tmp_path, client)
    model = RootScriptedModel(responses=[_call("request_finalization", {}, "complete-selected-request")])
    agent = create_assessment_root_agent(run=run, model=model, governance=(), checkpointer=InMemorySaver())

    result = agent.invoke({"messages": [{"role": "user", "content": "Complete the selected audit."}]},
                          config={"configurable": {"thread_id": THREAD}})

    assert client.request["status"] == "COMPLETED"
    assert client.lifecycle_state == "ACTIVE"
    assert [kind for kind, _ in client.calls].count("finalization") == 1
    assert not any(kind == "final_report" for kind, _ in client.calls)
    assert "__interrupt__" not in result


@pytest.mark.parametrize("prefix", [
    "", "/src", "src/../other", "src//child", "src%2fchild", "src\\child",
    "\u00a0src", "src\u00a0", "x" * 1025, "😀" * 513,
], ids=["empty", "absolute", "traversal", "repeated-separator", "percent", "backslash",
        "leading-nbsp", "trailing-nbsp", "ascii-over-limit", "utf16-over-limit"])
def test_optional_source_prefix_rejects_ambiguous_or_oversized_metadata(tmp_path, prefix):
    client = CoverageClient(count=1)
    run = _run(tmp_path, client)
    client.current["sourcePathPrefix"] = prefix

    with pytest.raises(ValueError, match="canonical repository-relative path"):
        _context(_tools(run))

    assert run.source_path_prefix is None


def test_valid_source_prefix_is_immutable_within_the_existing_execution(tmp_path):
    client = CoverageClient(count=1)
    run = _run(tmp_path, client)
    client.current["sourcePathPrefix"] = "src"

    with pytest.raises(RuntimeError, match="source scope changed"):
        _context(_tools(run))

    assert run.source_path_prefix is None


def test_scoped_context_requires_matching_runtime_metadata_before_exposing_a_view(tmp_path):
    client = CoverageClient(count=1)
    client.current["sourcePathPrefix"] = "src"
    run = _run(tmp_path, client)

    with pytest.raises(RuntimeError, match="scoped repository view metadata is unavailable"):
        _context(_tools(run))


@pytest.mark.parametrize("authority_change", ["null", "absent"])
def test_bound_selected_request_cannot_disappear_into_legacy_catalog_scope(tmp_path, authority_change):
    client = CatalogClient(count=3, long_concepts=False)
    original = _selected_request(["ER-000"])
    client.current["auditRequest"] = original
    run = _run(tmp_path, client)
    if authority_change == "null":
        client.current["auditRequest"] = None
    else:
        del client.current["auditRequest"]
    client.calls.clear()

    with pytest.raises(RuntimeError, match="audit request scope disappeared"):
        _catalog_page(_tools(run), limit=50)

    assert run.audit_request == original
    assert [name for name, _ in client.calls] == ["context"]

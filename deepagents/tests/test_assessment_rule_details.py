"""Lossless, byte-bounded navigation of oversized pinned rule detail, entirely offline."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
import hashlib
import json

import pytest

from assessment_root.client import AssessmentApiError
from test_assessment_root_agent import ASSESSMENT, PINS, THREAD, FakeClient, _run, _tools


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _pointer(parent, key):
    return parent + "/" + str(key).replace("~", "~0").replace("/", "~1")


def _kind(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "BOOLEAN"
    if isinstance(value, (int, float)):
        return "NUMBER"
    if isinstance(value, str):
        return "STRING"
    return "OBJECT" if isinstance(value, dict) else "ARRAY"


class RuleDetailClient(FakeClient):
    """Pinned in-memory legal payload with independently editable context and source content."""

    def __init__(self, *, large=True, pathological=False):
        super().__init__()
        self.current_context = super().context()
        self.current_context.update(assessmentId=ASSESSMENT, threadId=THREAD)
        source_a = {"documentId": "DOC-1", "locator": "Section 1"}
        source_b = {"documentId": "DOC-2", "locator": "Definition 2"}
        rule = {
            "assessmentRuleId": "ER-1", "assessmentRuleVersion": "v1", "concept": "retention",
            "legalRequirementIds": ["LR-1"], "sources": [source_a],
            "criteria": [{"criterionId": "C-1", "statement": "Keep the required record."}],
        }
        required = {
            "legalRequirementId": "LR-1", "title": "Record retention",
            "proposition": "Keep the record for the source-defined period.", "sources": [source_a],
            "applicabilityConditions": ["A service processes the submitted requests."],
            "qualifiers": ["For the source-defined period."],
            "exceptions": ["An explicit statutory exception applies."],
        }
        related = {
            "legalRequirementId": "LR-2", "title": "Source definition",
            "proposition": "A record has the meaning stated in this source.", "sources": [source_b],
        }
        relation = {
            "fromLegalRequirementId": "LR-1", "toLegalRequirementId": "LR-2",
            "relationKind": "DEFINITION", "toSourceRef": source_b,
        }
        if large:
            fragment = 'Nghĩa vụ 📚: "trích dẫn" \\ dữ liệu\n\t'
            required["proposition"] = fragment * 180
            related["proposition"] = ("Inherited scope applies to the stated actor. " * 120)
            rule["inspectionData"] = {
                "odd/~key": {"text": fragment * 100},
                "": "An empty object key is valid.",
                "literal~1": "A literal escape-looking key.",
                "tiếng/Việt~": "Giữ nguyên nghĩa.",
                "longArray": [
                    {"ordinal": index, "text": f"Source item {index}: " + fragment * 4}
                    for index in range(35)
                ],
                "typeExamples": {"object": {}, "array": [], "text": "", "number": 1.5,
                                 "boolean": False, "null": None},
                "manyKeys": {f"key-{index:02d}": index for index in range(24)},
            }
        if pathological:
            rule["pathologicalKeys"] = {
                "very-long/" + ("đ" * 2500): {"retained": True, "text": "Complete source value."},
                "another~" + ("x" * 500): [1, None, False, "An intact sibling value."],
            }
        self.rule_set_override = {
            "ruleSetVersionId": PINS["ruleSetVersionId"],
            "assessmentRules": [rule],
            "legalRequirements": [required, related],
            "contextRelations": [relation],
        }
        self.calls.clear()

    def context(self):
        self.calls.append(("context", None))
        return deepcopy(self.current_context)

    def expected_payload(self):
        rule_set = self.rule_set_override
        required = rule_set["legalRequirements"][0]
        return deepcopy({
            "ok": True,
            "assessmentRule": rule_set["assessmentRules"][0],
            "legalRequirements": rule_set["legalRequirements"],
            "contextRelations": rule_set["contextRelations"],
            "applicabilityElements": [
                {"legalRequirementId": "LR-1", "kind": "APPLICABILITY_CONDITION",
                 "index": 0, "text": required["applicabilityConditions"][0]},
                {"legalRequirementId": "LR-1", "kind": "QUALIFIER",
                 "index": 0, "text": required["qualifiers"][0]},
                {"legalRequirementId": "LR-1", "kind": "EXCEPTION",
                 "index": 0, "text": required["exceptions"][0]},
            ],
            "legalSources": [
                {"documentId": "DOC-1", "locator": "Section 1", "origin": "RULE"},
                {"documentId": "DOC-2", "locator": "Definition 2", "origin": "REQUIREMENT"},
            ],
        })


def _invoke(tool, arguments):
    raw = tool.invoke(arguments)
    assert len(raw.encode("utf-8")) <= 4096, "The actual serialized tool reply must fit the byte bound."
    return json.loads(raw)


def _overview(tools, rule_id="ER-1"):
    return _invoke(tools["get_assessment_rule"], {"assessment_rule_id": rule_id})


def _detail(tools, token, *, rule_id="ER-1", pointer="", offset=0, **kwargs):
    return _invoke(tools["get_assessment_rule_detail"], {
        "assessment_rule_id": rule_id, "detail_token": token,
        "pointer": pointer, "offset": offset, **kwargs,
    })


def _reconstruct(tools, token, expected, *, pointer="", max_items=10, max_chars=2000, kinds=None):
    kinds = kinds if kinds is not None else set()
    offset, collected, seen_offsets = 0, [], set()
    index_kind = None
    while True:
        reply = _detail(tools, token, pointer=pointer, offset=offset,
                        max_items=max_items, max_chars=max_chars)
        assert reply["ok"] is True
        assert reply["assessmentRuleId"] == "ER-1"
        assert reply["assessmentRuleVersion"] == "v1"
        assert reply["ruleSetVersionId"] == PINS["ruleSetVersionId"]
        assert reply["detailToken"] == token
        assert reply["detailTool"] == "get_assessment_rule_detail"
        assert reply["detailRequired"] is True
        view = reply["detail"]
        assert len(json.dumps(view, ensure_ascii=False).encode("utf-8")) <= 4096
        assert view["pointer"] == pointer
        kinds.add(view["kind"])
        if view["kind"] == "VALUE":
            assert offset == 0
            assert view["value"] == expected
            return view["value"]
        assert offset not in seen_offsets, "A continuation must progress."
        seen_offsets.add(offset)
        assert view["offset"] == offset
        if view["kind"] in {"TEXT_FRAGMENT", "JSON_FRAGMENT"}:
            text = expected if view["kind"] == "TEXT_FRAGMENT" else _canonical(expected)
            assert view["offsetUnit"] == "UNICODE_CODE_POINTS"
            assert view["totalCharacters"] == len(text)
            assert view["sha256"] == hashlib.sha256(text.encode("utf-8")).hexdigest()
            assert len(view["text"]) <= max_chars
            assert view["text"] == text[offset:offset + len(view["text"])]
            collected.append(view["text"])
            next_offset = view["nextOffset"]
            if next_offset is None:
                joined = "".join(collected)
                assert joined == text
                return joined if view["kind"] == "TEXT_FRAGMENT" else json.loads(joined)
            assert view["text"]
            assert next_offset == offset + len(view["text"])
        else:
            assert view["kind"] in {"OBJECT_INDEX", "ARRAY_INDEX"}
            index_kind = index_kind or view["kind"]
            assert view["kind"] == index_kind
            assert view["offsetUnit"] == "ENTRIES"
            assert view["totalEntries"] == len(expected)
            assert len(view["entries"]) <= max_items
            for entry in view["entries"]:
                key = entry["key"] if view["kind"] == "OBJECT_INDEX" else entry["index"]
                assert entry["pointer"] == _pointer(pointer, key)
                assert len(entry["pointer"]) <= 512
                child = expected[key]
                assert entry["kind"] == _kind(child)
                assert isinstance(entry["serializedBytes"], int) and entry["serializedBytes"] > 0
                value = _reconstruct(tools, token, child, pointer=entry["pointer"],
                                     max_items=max_items, max_chars=max_chars, kinds=kinds)
                collected.append((key, value))
            next_offset = view["nextOffset"]
            if next_offset is None:
                assert len(collected) == len(expected)
                if view["kind"] == "OBJECT_INDEX":
                    assert len({key for key, _ in collected}) == len(expected)
                    return dict(collected)
                assert [key for key, _ in collected] == list(range(len(expected)))
                return [value for _, value in collected]
            assert view["entries"]
            assert next_offset == offset + len(view["entries"])
        offset = next_offset


def test_small_rule_retains_the_complete_existing_payload_without_a_detail_indirection(tmp_path):
    client = RuleDetailClient(large=False)
    before = deepcopy(client.rule_set_override)
    result = _overview(_tools(_run(tmp_path, client)))

    assert result == client.expected_payload()
    assert "detailRequired" not in result
    assert client.rule_set_override == before
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


def test_oversized_rule_round_trips_every_field_through_byte_bounded_views(tmp_path):
    client = RuleDetailClient()
    before = deepcopy(client.rule_set_override)
    tools = _tools(_run(tmp_path, client))
    overview = _overview(tools)
    kinds = set()

    assert overview["ok"] is True and overview["detailRequired"] is True
    assert overview["assessmentRuleId"] == "ER-1"
    assert overview["assessmentRuleVersion"] == "v1"
    assert overview["ruleSetVersionId"] == PINS["ruleSetVersionId"]
    assert overview["detailTool"] == "get_assessment_rule_detail"
    assert len(overview["detailToken"]) == 64
    assert overview["detail"]["pointer"] == ""
    assert "assessmentRule" not in overview
    restored = _reconstruct(tools, overview["detailToken"], client.expected_payload(), kinds=kinds)

    assert restored == client.expected_payload()
    assert {"VALUE", "OBJECT_INDEX", "ARRAY_INDEX", "TEXT_FRAGMENT"} <= kinds
    assert client.rule_set_override == before
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


def test_pathological_keys_fall_back_to_lossless_json_fragments_before_exposing_oversized_pointers(tmp_path):
    client = RuleDetailClient(pathological=True)
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]
    expected = client.rule_set_override["assessmentRules"][0]["pathologicalKeys"]
    kinds = set()

    restored = _reconstruct(tools, token, expected, pointer="/assessmentRule/pathologicalKeys",
                            max_chars=37, kinds=kinds)

    assert restored == expected
    assert "JSON_FRAGMENT" in kinds
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


def test_unicode_index_near_reply_limit_keeps_one_offset_unit_across_digit_boundaries(tmp_path):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    overview = _overview(tools)
    envelope = {key: value for key, value in overview.items() if key != "detail"}
    pointer = "/assessmentRule/inspectionData/digitBoundary"
    target_key = target_value = None

    # Match the real public envelope: the larger entry fits at offset 0 but not 10.
    # The view must select a mode once for the whole container, before any continuation.
    for emoji_count in range(380, 461):
        for padding in range(8):
            candidate_key = ("😀" * emoji_count) + ("k" * padding)
            child_pointer = _pointer(pointer, candidate_key)
            if len(child_pointer) > 512:
                continue
            for candidate_value in ("large", "large source"):
                entry = {
                    "key": candidate_key, "pointer": child_pointer, "kind": "STRING",
                    "serializedBytes": len(json.dumps(candidate_value).encode("utf-8")),
                }
                view = {
                    "kind": "OBJECT_INDEX", "pointer": pointer, "offsetUnit": "ENTRIES",
                    "offset": 0, "totalEntries": 12, "entries": [entry], "nextOffset": 12,
                }
                probe = {**envelope, "detail": view}
                if len(json.dumps(probe, ensure_ascii=False).encode("utf-8")) == 4096:
                    view["offset"] = 10
                    assert len(json.dumps(probe, ensure_ascii=False).encode("utf-8")) == 4097
                    target_key, target_value = candidate_key, candidate_value
                    break
            if target_key is not None:
                break
        if target_key is not None:
            break
    assert target_key is not None, "The regression fixture must exercise the one-byte digit boundary."
    expected = {str(index): "x" * 5000 for index in range(11)}
    expected[target_key] = target_value
    client.rule_set_override["assessmentRules"][0]["inspectionData"]["digitBoundary"] = expected
    token = _overview(tools)["detailToken"]

    for offset in (0, 9, 10, 11, 12, 99, 100):
        view = _detail(tools, token, pointer=pointer, offset=offset, max_items=1)["detail"]
        assert view["kind"] == "JSON_FRAGMENT"
        assert view["offsetUnit"] == "UNICODE_CODE_POINTS"
        assert view["offset"] == offset
    kinds = set()
    restored = _reconstruct(tools, token, expected, pointer=pointer, max_items=1, kinds=kinds)

    assert restored == expected
    assert kinds == {"JSON_FRAGMENT"}
    assert {name for name, _ in client.calls} <= {"context", "rule_set"}


@pytest.mark.parametrize("key", ["odd/~key", "", "literal~1", "tiếng/Việt~"])
def test_json_pointer_escaping_addresses_the_exact_source_key(tmp_path, key):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]
    expected = client.rule_set_override["assessmentRules"][0]["inspectionData"][key]

    assert _reconstruct(tools, token, expected,
                        pointer=_pointer("/assessmentRule/inspectionData", key)) == expected


def test_small_containers_and_text_still_respect_explicit_item_and_character_limits(tmp_path):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]
    expected = client.rule_set_override["assessmentRules"][0]["inspectionData"]["typeExamples"]

    page = _detail(tools, token, pointer="/assessmentRule/inspectionData/typeExamples", max_items=1)
    assert page["detail"]["kind"] == "OBJECT_INDEX"
    assert len(page["detail"]["entries"]) == 1
    assert _reconstruct(tools, token, expected, pointer="/assessmentRule/inspectionData/typeExamples",
                        max_items=1) == expected

    text_page = _detail(tools, token, pointer="/assessmentRule/concept", max_chars=2)
    assert text_page["detail"]["kind"] == "TEXT_FRAGMENT"
    assert text_page["detail"]["text"] == "re"
    assert _reconstruct(tools, token, "retention", pointer="/assessmentRule/concept", max_chars=2) == "retention"


def test_unicode_fragments_keep_exact_character_offsets_and_the_final_character(tmp_path):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]
    pointer = "/legalRequirements/0/proposition"
    text = client.rule_set_override["legalRequirements"][0]["proposition"]
    kinds = set()

    assert _reconstruct(tools, token, text, pointer=pointer, max_chars=19, kinds=kinds) == text
    assert kinds == {"TEXT_FRAGMENT"}
    last = _detail(tools, token, pointer=pointer, offset=len(text) - 1, max_chars=19)
    assert last["detail"]["text"] == text[-1:]
    assert last["detail"]["nextOffset"] is None


def test_maximum_character_request_still_respects_utf8_and_json_escape_byte_cost(tmp_path):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]
    pointer = "/legalRequirements/0/proposition"
    text = client.rule_set_override["legalRequirements"][0]["proposition"]

    first = _detail(tools, token, pointer=pointer, max_chars=4000)
    assert first["detail"]["kind"] == "TEXT_FRAGMENT"
    assert 0 < len(first["detail"]["text"]) < 4000
    assert _reconstruct(tools, token, text, pointer=pointer, max_chars=4000) == text


@pytest.mark.parametrize("pointer,node_kind", [
    ("/assessmentRule/inspectionData/manyKeys", "OBJECT_INDEX"),
    ("/assessmentRule/inspectionData/longArray", "ARRAY_INDEX"),
    ("/legalRequirements/0/proposition", "TEXT_FRAGMENT"),
])
def test_exact_end_offset_returns_an_empty_terminal_view(tmp_path, pointer, node_kind):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]
    target = client.expected_payload()
    for part in pointer.split("/")[1:]:
        target = target[int(part)] if isinstance(target, list) else target[part]

    end = _detail(tools, token, pointer=pointer, offset=len(target))["detail"]

    assert end["kind"] == node_kind
    assert end["nextOffset"] is None
    assert end["text"] == "" if node_kind == "TEXT_FRAGMENT" else end["entries"] == []


@pytest.mark.parametrize("pointer", [
    "assessmentRule",
    "/missing",
    "/assessmentRule/missing",
    "/assessmentRule/inspectionData/odd~2key",
    "/assessmentRule/inspectionData/dangling~",
    "/assessmentRule/inspectionData/longArray/01",
    "/assessmentRule/inspectionData/longArray/-",
    "/assessmentRule/inspectionData/longArray/999",
    "/assessmentRule/concept/child",
])
def test_invalid_json_pointer_returns_feedback_without_source_detail(tmp_path, pointer):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]

    result = _detail(tools, token, pointer=pointer)

    assert result["ok"] is False and result["code"] == "INVALID_RULE_DETAIL_POINTER"
    assert "detail" not in result


@pytest.mark.parametrize("pointer,offset", [
    ("/assessmentRule/assessmentRuleId", 1),
    ("/assessmentRule/inspectionData/manyKeys", 25),
    ("/assessmentRule/inspectionData/longArray", 36),
    ("/legalRequirements/0/proposition", 100000),
])
def test_out_of_range_offsets_cannot_silently_omit_source_content(tmp_path, pointer, offset):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    token = _overview(tools)["detailToken"]

    result = _detail(tools, token, pointer=pointer, offset=offset)

    assert result["ok"] is False and result["code"] == "INVALID_RULE_DETAIL_OFFSET"
    assert "detail" not in result


@pytest.mark.parametrize("patch", [
    {"detail_token": ""},
    {"detail_token": "g" * 64},
    {"detail_token": "a" * 63},
    {"detail_token": "a" * 65},
    {"pointer": "/" + "x" * 512},
    {"offset": -1},
    {"offset": 0.5},
    {"max_items": 0},
    {"max_items": 21},
    {"max_chars": 0},
    {"max_chars": 4001},
    {"assessment_id": "caller-selected"},
])
def test_invalid_detail_arguments_fail_before_an_authoritative_read(tmp_path, patch):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    before = list(client.calls)

    result = _invoke(tools["get_assessment_rule_detail"], {
        "assessment_rule_id": "ER-1", "detail_token": "a" * 64, **patch,
    })

    assert result["ok"] is False and result["code"] == "INVALID_TOOL_ARGUMENTS"
    assert "detail" not in result
    assert client.calls == before


def test_same_rule_version_with_replaced_legal_content_invalidates_the_detail_token(tmp_path):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))
    old_token = _overview(tools)["detailToken"]
    client.rule_set_override["legalRequirements"][0]["proposition"] += "A changed source statement."

    rejected = _detail(tools, old_token)
    assert rejected["ok"] is False and rejected["code"] == "RULE_DETAIL_SNAPSHOT_STALE"
    assert "detail" not in rejected
    fresh = _overview(tools)
    assert fresh["assessmentRuleVersion"] == "v1"
    assert fresh["detailToken"] != old_token
    assert _reconstruct(tools, fresh["detailToken"], client.expected_payload()) == client.expected_payload()


@pytest.mark.parametrize("identity,server_identity", [
    ("assessment_id", "assessmentId"),
    ("thread_id", "threadId"),
])
def test_detail_token_cannot_be_reused_in_another_case_or_thread(tmp_path, identity, server_identity):
    client = RuleDetailClient()
    run = _run(tmp_path, client)
    token = _overview(_tools(run))["detailToken"]
    client.current_context[server_identity] = "foreign-identity"
    foreign = replace(run, **{identity: "foreign-identity"})

    result = _detail(_tools(foreign), token)

    assert result["ok"] is False and result["code"] == "RULE_DETAIL_SNAPSHOT_STALE"
    assert "detail" not in result


@pytest.mark.parametrize("pin,value", [
    ("ruleSetVersionId", "replacement-rule-set"),
    ("repositorySnapshotId", "replacement-snapshot"),
    ("repositoryCommit", "b" * 40),
    ("sourcePathPrefix", "src"),
])
def test_detail_token_binds_all_source_pins_and_selected_scope(tmp_path, pin, value):
    client = RuleDetailClient()
    run = _run(tmp_path, client)
    token = _overview(_tools(run))["detailToken"]
    client.current_context[pin] = value
    if pin == "sourcePathPrefix":
        run.source_path_prefix = value
    else:
        run.pins[pin] = value
    if pin == "ruleSetVersionId":
        client.rule_set_override[pin] = value

    result = _detail(_tools(run), token)

    assert result["ok"] is False and result["code"] == "RULE_DETAIL_SNAPSHOT_STALE"
    assert "detail" not in result


def test_an_unissued_token_never_returns_even_one_source_field(tmp_path):
    client = RuleDetailClient()
    tools = _tools(_run(tmp_path, client))

    result = _detail(tools, "f" * 64, pointer="/assessmentRule/concept")

    assert result["ok"] is False and result["code"] == "RULE_DETAIL_SNAPSHOT_STALE"
    assert "detail" not in result


def test_lease_rejection_does_not_reveal_cached_rule_detail(tmp_path, monkeypatch):
    client = RuleDetailClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _overview(tools)["detailToken"]

    def reject_rule_set():
        raise AssessmentApiError(403, "ASSESSMENT_EXECUTION_LEASE_INVALID")

    monkeypatch.setattr(client, "rule_set", reject_rule_set)
    result = _detail(tools, token)

    assert result["ok"] is False and result["code"] == "ASSESSMENT_EXECUTION_LEASE_INVALID"
    assert "detail" not in result


# Every bounded read is authorized by the current server-owned audit request.
def _detail_request(rule_ids, *, request_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"):
    return {"requestId": request_id, "scopeMode": "SELECTED_RULES", "status": "RUNNING",
            "selectedRuleIds": list(rule_ids)}


@pytest.mark.parametrize("patch", [
    {"requestId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
    {"scopeMode": "FULL_RULE_SET"},
    {"status": "COMPLETED"},
])
def test_identical_rule_content_cannot_reuse_detail_token_across_audit_authority(tmp_path, patch):
    client = RuleDetailClient()
    client.current_context["auditRequest"] = _detail_request(["ER-1"])
    run = _run(tmp_path, client)
    tools = _tools(run)
    old_token = _overview(tools)["detailToken"]
    unchanged_payload = client.expected_payload()
    client.current_context["auditRequest"].update(patch)

    rejected = _detail(tools, old_token, pointer="/legalRequirements/0/proposition", max_chars=10)

    assert rejected["ok"] is False and rejected["code"] == "RULE_DETAIL_SNAPSHOT_STALE"
    assert "detail" not in rejected
    assert client.expected_payload() == unchanged_payload
    assert run.audit_request == client.current_context["auditRequest"]
    current = _overview(tools)
    assert current["detailToken"] != old_token
    valid = _detail(tools, current["detailToken"], pointer="/legalRequirements/0/proposition", max_chars=10)
    assert valid["ok"] is True
    assert valid["detail"]["text"] == unchanged_payload["legalRequirements"][0]["proposition"][:10]


@pytest.mark.parametrize("operation", ["overview", "fragment"])
def test_current_audit_selection_rejects_out_of_scope_rule_before_legal_read(tmp_path, operation):
    client = RuleDetailClient()
    client.current_context["auditRequest"] = _detail_request(["ER-1"])
    run = _run(tmp_path, client)
    tools = _tools(run)
    old_token = _overview(tools)["detailToken"]
    other_rule = deepcopy(client.rule_set_override["assessmentRules"][0])
    other_rule["assessmentRuleId"] = "ER-2"
    client.rule_set_override["assessmentRules"].append(other_rule)
    client.current_context["auditRequest"] = _detail_request(
        ["ER-2"], request_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    client.current_context["coverage"] = [{"assessmentRuleId": "ER-2", "assessmentRuleVersion": "v1",
                                          "resolutionState": "PENDING", "currentDecisionId": None,
                                          "decisionRevision": 0}]
    client.calls.clear()

    rejected = (_overview(tools) if operation == "overview" else
                _detail(tools, old_token, pointer="/legalRequirements/0/proposition", offset=10, max_chars=10))

    assert rejected == {"ok": False, "code": "RULE_NOT_IN_AUDIT_REQUEST"}
    assert [name for name, _ in client.calls] == ["context"]
    assert run.audit_request == client.current_context["auditRequest"]


def test_first_rule_read_adopts_authorized_selection_before_returning_content(tmp_path):
    client = RuleDetailClient()
    run = _run(tmp_path, client)
    run.pins.clear()
    run.audit_request = None
    client.current_context["auditRequest"] = _detail_request(["ER-2"])
    client.calls.clear()

    rejected = _overview(_tools(run), rule_id="ER-1")

    assert rejected == {"ok": False, "code": "RULE_NOT_IN_AUDIT_REQUEST"}
    assert [name for name, _ in client.calls] == ["context"]


@pytest.mark.parametrize("selection", [[], "ER-1", [None]])
def test_malformed_selected_request_never_reveals_even_a_rule_fragment(tmp_path, selection):
    client = RuleDetailClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _overview(tools)["detailToken"]
    client.current_context["auditRequest"] = _detail_request(["ER-1"])
    client.current_context["auditRequest"]["selectedRuleIds"] = selection
    client.calls.clear()

    with pytest.raises(RuntimeError, match="authorized rule scope"):
        _detail(tools, token, pointer="/legalRequirements/0/proposition", max_chars=1)

    assert [name for name, _ in client.calls] == ["context"]


@pytest.mark.parametrize("authority_change", ["null", "absent"])
def test_bound_selected_request_cannot_disappear_during_a_fragment_read(tmp_path, authority_change):
    client = RuleDetailClient()
    original = _detail_request(["ER-1"])
    client.current_context["auditRequest"] = original
    run = _run(tmp_path, client)
    tools = _tools(run)
    token = _overview(tools)["detailToken"]
    if authority_change == "null":
        client.current_context["auditRequest"] = None
    else:
        del client.current_context["auditRequest"]
    client.calls.clear()

    with pytest.raises(RuntimeError, match="audit request scope disappeared"):
        _detail(tools, token, pointer="/legalRequirements/0/proposition", max_chars=1)

    assert run.audit_request == original
    assert [name for name, _ in client.calls] == ["context"]

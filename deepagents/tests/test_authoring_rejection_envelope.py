"""Envelope sanitization and bounds (pure), and the guarantee that the published tool-contract document matches the running tools."""
import importlib.util
import json
from pathlib import Path

from jsonschema import Draft7Validator

from rule_set_preparation.authoring_rejections import (
    AUTHORING_PRECONDITION, MAX_ARGS_CHARS, MAX_LIST_ITEMS, REPAIR, TOOL_SCHEMA, args_fingerprint, build_envelope, draft_fingerprint, field_paths_of, redact, sanitize_args,
)

CLAIM = "a" * 64
REPO = Path(__file__).resolve().parents[2]


def test_ids_survive_free_text_is_reduced_and_lists_are_capped():
    args = {"requirement_key": "R-1", "title": "A fairly long title written by the model about a provision " * 3, "operative_claim_ids": [CLAIM] * 30,
            "non_repository_duty": True, "nested": {"x": 1}}
    out = sanitize_args(args)
    assert out["requirement_key"] == "R-1" and out["non_repository_duty"] is True
    assert out["title"]["len"] == len(args["title"]) and len(out["title"]["sha256"]) == 12 and len(out["title"]["head"]) <= 48 and "head" in out["title"]
    assert out["operative_claim_ids"] == {"count": 30, "items": [CLAIM] * MAX_LIST_ITEMS}
    assert out["nested"] == {"type": "dict"}


def test_credential_shaped_text_never_reaches_a_durable_event():
    secrets = ["sk-live-ABCDEFGHIJKLMNOP", "AIza" + "B" * 30, "Bearer eyJhbGciOiJIUzI1NiJ9.payload", "password: hunter2hunter2", "C" * 50]
    for secret in secrets:
        out = json.dumps(sanitize_args({"title": f"see {secret} for details", "reason": secret, "requirement_key": secret, "operative_claim_ids": [secret], secret: secret}))
        assert secret not in out, secret
        assert secret not in redact(f"bad value {secret}")
        envelope = build_envelope(tool="author_legal_requirement", layer=AUTHORING_PRECONDITION, source="TOOL_BODY", code="CLAIM_REQUIREMENT_MISMATCH",
                                  args={"operative_claim_ids": [secret]}, ref=secret, detail=f"Unknown claim {secret}", field_paths=[secret], required_action="get_claim_inventory",
                                  repair_key="UNKNOWN_CLAIM", inventory={}, draft_before="a", draft_after="a", draft_revision=0, sequence=1, model_turn=1,
                                  phase="RULE_AUTHORING", extra={"suppliedClaimId": secret})
        assert secret not in json.dumps(envelope)
    assert redact(f"claim {CLAIM} is wrong") == f"claim {CLAIM} is wrong", "claim IDs are the actionable part of a rejection and must survive redaction"


def test_sanitized_arguments_are_bounded_however_large_the_call():
    huge = {f"arg_{i}": "x" * 5000 for i in range(40)}
    huge["operative_claim_ids"] = [CLAIM] * 128
    assert len(json.dumps(sanitize_args(huge))) <= MAX_ARGS_CHARS
    assert len(json.dumps(sanitize_args({"long-key-" + str(i) + "-" * 80: [CLAIM] * 128 for i in range(24)}))) <= MAX_ARGS_CHARS
    assert sanitize_args("not an object") == {"type": "str"} and sanitize_args(None) == {"type": "NoneType"}


def test_the_argument_fingerprint_identifies_the_call_not_the_key_order():
    assert args_fingerprint({"a": 1, "b": [1, 2]}) == args_fingerprint({"b": [1, 2], "a": 1}) and args_fingerprint({"a": 1}) != args_fingerprint({"a": 2})


def test_field_paths_name_the_missing_the_unexpected_and_the_mistyped_argument():
    schema = {"type": "object", "properties": {"title": {"type": "string"}, "ids": {"type": "array", "items": {"type": "string"}}}, "required": ["title"], "additionalProperties": False}
    errors = list(Draft7Validator(schema).iter_errors({"ids": [1], "bogus": 1}))
    assert field_paths_of(errors) == ["bogus", "ids.0", "title"]


def test_the_envelope_is_complete_and_states_whether_the_draft_moved():
    draft = {"legalRequirements": {"R": {"x": 1}}, "assessmentRules": {}}
    before = draft_fingerprint(draft)
    envelope = build_envelope(tool="author_legal_requirement", layer=TOOL_SCHEMA, source="TOOL_PREFLIGHT", code="CLAIM_SCHEMA_INVALID", args={"title": "t"}, ref="author_legal_requirement.title",
                              detail="'title' is a required property", field_paths=["title"], required_action="get_claim_inventory", repair_key="MISSING_ARGUMENT",
                              inventory={"revision": 1, "fingerprint": CLAIM}, draft_before=before, draft_after=draft_fingerprint(draft), draft_revision=3, sequence=9, model_turn=4,
                              phase="RULE_AUTHORING", tool_call_id="call-1")
    assert {"sequence", "modelTurn", "phase", "toolName", "toolCallId", "rejectionLayer", "rejectionSource", "rejectionCode", "fieldPaths", "requiredAction", "repair", "argsFingerprint",
            "sanitizedArgs", "inventoryRevision", "inventoryFingerprint", "draftRevisionBefore", "draftRevisionAfter", "draftFingerprintBefore", "draftFingerprintAfter",
            "draftUnchanged", "resolved"} <= set(envelope)
    assert envelope["draftUnchanged"] is True and envelope["resolved"] is False and envelope["repair"] == REPAIR["MISSING_ARGUMENT"] and envelope["rejectionLayer"] == TOOL_SCHEMA
    moved = build_envelope(tool="t", layer=AUTHORING_PRECONDITION, source="TOOL_BODY", code="C", args={}, ref=None, detail=None, field_paths=[], required_action=None, repair_key="",
                           inventory={}, draft_before="a", draft_after="b", draft_revision=0, sequence=1, model_turn=None, phase="RULE_AUTHORING")
    assert moved["draftUnchanged"] is False and moved["repair"] is None


def test_the_draft_fingerprint_moves_only_when_a_candidate_changes():
    draft = {"legalRequirements": {"R": {"title": "t"}}, "assessmentRules": {}}
    first = draft_fingerprint(draft)
    assert draft_fingerprint({"assessmentRules": {}, "legalRequirements": {"R": {"title": "t"}}}) == first
    assert draft_fingerprint({"legalRequirements": {"R": {"title": "t2"}}, "assessmentRules": {}}) != first


# --- the published contract is the running contract -------------------------------------------------------------------------------------
def test_authoring_tool_contract_document_matches_runtime():
    path = REPO / "reports/lcsp360-tool-contract-20261018"
    spec = importlib.util.spec_from_file_location("build_tool_contract", path / "build-tool-contract.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    live = module.build()
    published = json.loads((path / "AUTHORING_TOOL_CONTRACT.json").read_text())
    assert json.loads(json.dumps(live, sort_keys=True)) == published, "regenerate with build-tool-contract.py: the tools changed but the contract document did not"
    names = {tool["name"] for tool in published["tools"]}
    assert {"author_legal_requirement", "author_assessment_rule", "remove_rule_candidate", "get_rule_authoring_status"} <= names
    for tool in published["tools"]:
        if tool.get("kind") == "MUTATION":
            assert tool["additionalProperties"] is False and tool["idempotencyKey"] and tool["mutation"], tool["name"]

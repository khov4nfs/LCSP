"""Exercise actual tools: descriptions are metadata; validation alone grants repair scope."""
from copy import deepcopy
import json

import pytest
from langchain_core.utils.function_calling import convert_to_openai_tool

from rule_set_preparation.claim_tools import build_claim_tools
from test_rule_set_preparation_agent import FakeApi, _draft_tools, _packet, DOC


class FailedValidation(FakeApi):
    def validate_compliance_rule_set(self, run_id, packet):
        return {"outcome": "FAILED", "failures": [{
            "code": "STALE_SOURCE_HASH", "ref": f"relation:REL-1|locator:{DOC}::art-2::cl-1", "detail": "fixture failure",
        }]}


def test_actual_claim_tools_have_explicit_model_facing_descriptions_and_schemas():
    from retained_rule_authoring_harness import restore
    _, context, runtime_tools, _ = restore()
    assert "remove_from_packet_draft" not in runtime_tools
    tools = build_claim_tools(context)
    assert len({tool.name for tool in tools}) == len(tools)
    for tool in tools:
        metadata = convert_to_openai_tool(tool)["function"]
        assert metadata["name"] == tool.name
        assert metadata["description"] == tool.description
        assert len(metadata["description"].strip()) > 30
        assert "properties" in metadata["parameters"]
        assert metadata["parameters"].get("additionalProperties") is False
    author = next(tool for tool in tools if tool.name == "author_assessment_rule")
    assert "cannot create a legal obligation" in author.description
    assert set(author.args_schema["required"]) == {"assessment_rule_id", "concept", "legal_requirement_ids"}


@pytest.mark.parametrize("edit", ["add", "external_validation", "restored_draft"])
def test_stale_or_foreign_validation_cannot_authorize_removal(edit):
    context, tools = _draft_tools(FailedValidation())
    packet = _packet()
    tools["add_to_packet_draft"].invoke(packet)
    tools["validate_compliance_rule_set"].invoke({})
    if edit == "add":
        tools["add_to_packet_draft"].invoke({"legalRequirements": [{**packet["legalRequirements"][0], "title": "corrected"}]})
    elif edit == "external_validation":
        other = deepcopy(packet)
        other["legalRequirements"][0]["title"] = "independent candidate"
        tools["validate_compliance_rule_set"].invoke({"packet": other})
    else:
        context.draft["contextRelations"]["REL-1"]["sourceQuote"] = "restored different bytes"
    before = deepcopy(context.draft)
    result = json.loads(tools["remove_from_packet_draft"].invoke({"relationIds": ["REL-1"]}))
    assert result["refused"] == ["REL-1"]
    assert context.draft == before


def test_removal_records_exact_repair_scope_and_requires_revalidation():
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    result = json.loads(tools["remove_from_packet_draft"].invoke({"relationIds": ["REL-1", "missing"], "legalRequirementIds": ["LR-RET"]}))
    assert result["removed"]["contextRelations"] == 1
    trace = context.trace[-1]
    assert trace["removedLabels"] == [{"section": "contextRelations", "label": "REL-1"}]
    assert trace["refusedLabels"] == ["LR-RET"] and trace["unknownLabels"] == ["missing"]
    assert trace["validationFailures"][0]["code"] == "STALE_SOURCE_HASH"
    assert context.removal_validation_packet is None and not context.removable
    assert context.last_validation is None and context.validated_packet is None


@pytest.mark.parametrize("terminal", ["submission", "source_blocked", "concluded"])
def test_terminal_preparation_rejects_repair_mutation(terminal):
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    setattr(context, terminal, {"fixture": True})
    before = deepcopy(context.draft)
    assert "error" in json.loads(tools["remove_from_packet_draft"].invoke({"relationIds": ["REL-1"]}))
    assert context.draft == before

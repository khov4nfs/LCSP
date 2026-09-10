from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from langchain.messages import SystemMessage

from middleware.runtime_context import inject_lcsp_runtime_context
from orchestration.context import LCSPRunContext
from subagents.investigator.definition import SYSTEM_PROMPT


@pytest.mark.parametrize("as_mapping", [False, True])
@pytest.mark.parametrize("key", ["investigator:execution-1", "resume:execution-1:3"])
def test_investigator_idempotency_does_not_inject_legal_maintenance_routing(
    key, as_mapping,
):
    context = LCSPRunContext(
        assessment_id="assessment-1",
        workflow_run_id="investigator:execution-1",
        engineering_rule_ids=("ENG-1",),
        artifact_versions={"technicalEvidenceReportId": "ter-1"},
        idempotency_key=key,
    )
    request = MagicMock()
    request.runtime = SimpleNamespace(context=asdict(context) if as_mapping else context)
    request.system_message = SystemMessage(content=SYSTEM_PROMPT)
    handler = MagicMock()

    inject_lcsp_runtime_context.wrap_model_call(request, handler)

    message = request.override.call_args.kwargs["system_message"]
    text = "\n".join(block["text"] for block in message.content_blocks)
    assert SYSTEM_PROMPT in text
    assert f"idempotency_key={key}" in text
    assert "engineering_rule_ids=ENG-1" in text
    assert "technicalEvidenceReportId:ter-1" in text
    assert "ENGINEERING_RULE_NOT_READY" not in text
    assert "LEGAL_MAINTENANCE" not in text
    assert "delegate to the `triage`" not in text
    handler.assert_called_once_with(request.override.return_value)


def test_explicit_triage_instruction_is_preserved_without_inferred_routing():
    request = MagicMock()
    request.runtime = SimpleNamespace(context=LCSPRunContext(
        legal_rule_ids=("LEGAL-1",), idempotency_key="readiness:1",
    ))
    instruction = "Automatic ENGINEERING_RULE_NOT_READY: process the claimed LegalRule scope."
    request.system_message = SystemMessage(content=instruction)
    inject_lcsp_runtime_context.wrap_model_call(request, MagicMock())
    text = "\n".join(
        block["text"]
        for block in request.override.call_args.kwargs["system_message"].content_blocks
    )
    assert instruction in text
    assert "legal_rule_ids=LEGAL-1" in text
    assert "Route it to LEGAL_MAINTENANCE" not in text

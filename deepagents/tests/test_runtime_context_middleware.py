from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.messages import SystemMessage

from middleware.runtime_context import inject_lcsp_runtime_context
from orchestration.context import LCSPRunContext
SYSTEM_PROMPT = "Assessment host prompt."


@pytest.mark.parametrize("as_mapping", [False, True])
@pytest.mark.parametrize("key", ["assessment-root:assessment-1:1", "resume:execution-1:3"])
@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.asyncio
async def test_runtime_identity_is_injected_without_inferred_routing(
    key, as_mapping, async_mode,
):
    context = LCSPRunContext(
        assessment_id="assessment-1",
        workflow_run_id="assessment-1:root:1",
        idempotency_key=key,
    )
    request = MagicMock()
    request.runtime = SimpleNamespace(context=asdict(context) if as_mapping else context)
    request.system_message = SystemMessage(content=SYSTEM_PROMPT)
    handler = AsyncMock() if async_mode else MagicMock()

    if async_mode:
        await inject_lcsp_runtime_context.awrap_model_call(request, handler)
    else:
        inject_lcsp_runtime_context.wrap_model_call(request, handler)

    message = request.override.call_args.kwargs["system_message"]
    text = "\n".join(block["text"] for block in message.content_blocks)
    assert SYSTEM_PROMPT in text
    assert f"idempotency_key={key}" in text
    assert "workflow_run_id=assessment-1:root:1" in text
    handler.assert_called_once_with(request.override.return_value)
    if async_mode:
        handler.assert_awaited_once_with(request.override.return_value)


def test_explicit_instruction_is_preserved_without_inferred_routing():
    request = MagicMock()
    request.runtime = SimpleNamespace(context=LCSPRunContext(
        assessment_id="assessment-1", idempotency_key="assessment-root:1",
    ))
    instruction = "Dispatch the trusted system boundary."
    request.system_message = SystemMessage(content=instruction)
    inject_lcsp_runtime_context.wrap_model_call(request, MagicMock())
    text = "\n".join(
        block["text"]
        for block in request.override.call_args.kwargs["system_message"].content_blocks
    )
    assert instruction in text
    assert "assessment_id=assessment-1" in text

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.structured_output import ProviderStrategy, ToolStrategy
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from contracts.handoffs import InvestigatorResult
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.provider_schema import (
    ProviderSchemaCompatibilityMiddleware,
    relax_array_upper_bounds,
)


def _request(model, response_format):
    request = MagicMock()
    request.model = model
    request.response_format = response_format
    request.model_settings = {}

    def _override(**kwargs):
        forwarded = _request(model, kwargs.get("response_format", response_format))
        forwarded.model_settings = kwargs.get("model_settings", request.model_settings)
        return forwarded

    request.override = MagicMock(side_effect=_override)
    return request


def _gemini() -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", google_api_key="test-key")


def test_model_governance_installs_provider_schema_compatibility() -> None:
    assert any(
        isinstance(item, ProviderSchemaCompatibilityMiddleware)
        for item in MODEL_GOVERNANCE_MIDDLEWARE
    )


def test_relaxing_removes_every_array_upper_bound_and_keeps_other_constraints() -> None:
    schema = InvestigatorResult.model_json_schema()
    relaxed = relax_array_upper_bounds(schema)

    def positive_upper_bounds(node) -> int:
        if isinstance(node, dict):
            hit = 1 if node.get("maxItems", 0) not in (0,) else 0
            return hit + sum(positive_upper_bounds(value) for value in node.values())
        if isinstance(node, list):
            return sum(positive_upper_bounds(value) for value in node)
        return 0

    assert positive_upper_bounds(schema) > 0
    # Every expansion-costly (>0) maxItems is gone...
    assert positive_upper_bounds(relaxed) == 0
    # ...but the 3 maxItems:0 on InvestigatorScopeNotApplicableClaim are a shape contract
    # (that claim_type must not carry these refs at all), not an expansion-cost bound, and
    # must survive relaxation untouched.
    scope_properties = relaxed["$defs"]["InvestigatorScopeNotApplicableClaim"]["properties"]
    for field in ("evidence_refs", "graph_path_refs", "source_anchor_refs"):
        assert scope_properties[field]["maxItems"] == 0, field
    # Lower bounds and value ranges cost the provider nothing, so they must survive.
    assert relaxed["properties"]["claims"]["items"] == schema["properties"]["claims"]["items"]
    assert (
        relaxed["$defs"]["InvestigatorRequirementMetClaim"]["properties"]["confidence"][
            "maximum"
        ]
        == 1
    )
    assert relaxed["$defs"]["BusinessContextNeed"]["properties"]["resolution_criteria"]["minItems"] == 1


def test_the_relaxed_schema_does_not_widen_the_validated_contract() -> None:
    # The provider stops rejecting oversize arrays, so Pydantic must still refuse them.
    payload = {
        "status": "READY",
        "artifact_versions": {"technicalEvidenceReportId": "report-1"},
        "claims": [
            {
                "claim_id": f"claim-{index}",
                "engineering_rule_id": "rule-1",
                "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                "value": None,
                "confidence": 0.5,
            }
            for index in range(201)
        ],
        "next_step": "GATE",
    }
    with pytest.raises(Exception):
        InvestigatorResult.model_validate(payload)


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_gemini_receives_a_relaxed_schema_in_the_same_strategy(asynchronous) -> None:
    middleware = ProviderSchemaCompatibilityMiddleware()
    request = _request(_gemini(), ProviderStrategy(InvestigatorResult))
    handler = AsyncMock() if asynchronous else MagicMock()

    if asynchronous:
        await middleware.awrap_model_call(request, handler)
    else:
        middleware.wrap_model_call(request, handler)

    forwarded = handler.call_args.args[0].response_format
    assert isinstance(forwarded, ProviderStrategy)
    assert forwarded.schema == relax_array_upper_bounds(InvestigatorResult.model_json_schema())
    assert handler.call_args.args[0].model_settings["automatic_function_calling"] == {
        "disable": True
    }


def test_a_tool_strategy_keeps_its_own_strategy_type() -> None:
    middleware = ProviderSchemaCompatibilityMiddleware()
    request = _request(_gemini(), ToolStrategy(InvestigatorResult))
    handler = MagicMock()

    middleware.wrap_model_call(request, handler)

    assert isinstance(handler.call_args.args[0].response_format, ToolStrategy)


def test_openai_requests_are_forwarded_untouched() -> None:
    middleware = ProviderSchemaCompatibilityMiddleware()
    response_format = ProviderStrategy(InvestigatorResult)
    request = _request(ChatOpenAI(model="gpt-5-mini", api_key="test-key"), response_format)
    handler = MagicMock()

    middleware.wrap_model_call(request, handler)

    assert handler.call_args.args[0] is request
    assert request.override.call_count == 0


def test_a_schema_without_array_upper_bounds_still_disables_gemini_afc() -> None:
    middleware = ProviderSchemaCompatibilityMiddleware()
    request = _request(_gemini(), {"type": "object", "properties": {"status": {"type": "string"}}})
    handler = MagicMock()

    middleware.wrap_model_call(request, handler)

    assert handler.call_args.args[0].response_format is request.response_format
    assert handler.call_args.args[0].model_settings["automatic_function_calling"] == {
        "disable": True
    }

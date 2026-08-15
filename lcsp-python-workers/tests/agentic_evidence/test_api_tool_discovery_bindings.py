from __future__ import annotations

import inspect
from unittest.mock import MagicMock
from uuid import uuid4

from lcsp_workers.agentic_evidence import tool_entrypoints
from lcsp_workers.agentic_evidence.dispatcher import (
    NEST_CQRS_DISCOVERY_BINDINGS,
    ToolRuntimeTarget,
    runtime_binding,
)
from lcsp_workers.agentic_evidence.registry import AgenticToolRequest
from lcsp_workers.agentic_evidence.tool_entrypoints import AgenticToolExecutionContext


EXPECTED_NEST_DISCOVERY_TOOLS = {
    "get_assessment_context": "GetAssessmentContextQuery",
    "get_verified_profile": "GetVerifiedProfileQuery",
    "compare_wizard_claim": "CompareWizardClaimQuery",
    "get_classification_baseline": "GetClassificationBaselineQuery",
    "get_gap_requirements": "GetGapRequirementsQuery",
    "validate_classification_proposal": "ValidateClassificationProposalQuery",
    "evaluate_gap_matrix": "EvaluateGapMatrixQuery",
    "get_admin_source_catalog": "GetAdminSourceCatalogQuery",
    "get_legal_corpus_readiness": "GetLegalCorpusReadinessQuery",
    "retrieve_legal_basis": "RetrieveLegalBasisQuery",
    "get_legal_rule_match": "GetLegalRuleMatchQuery",
    "validate_citation_set": "ValidateCitationSetQuery",
}


def _request(tool_name: str) -> AgenticToolRequest:
    return AgenticToolRequest.model_validate(
        {
            "toolName": tool_name,
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": str(uuid4()),
            "artifactVersions": {"baselineId": "artifact-1"},
            "correlationId": str(uuid4()),
            "scope": {},
            "budget": {
                "maxItems": 10,
                "maxDepth": 1,
                "maxBytes": 16_384,
                "maxDurationMs": 1_000,
            },
            "input": {},
        }
    )


def test_existing_nest_cqrs_tools_have_exact_named_entrypoints() -> None:
    names = {binding.tool_name for binding in NEST_CQRS_DISCOVERY_BINDINGS}
    assert names == set(EXPECTED_NEST_DISCOVERY_TOOLS)

    source = inspect.getsource(tool_entrypoints)
    for binding in NEST_CQRS_DISCOVERY_BINDINGS:
        assert binding.runtime_target == ToolRuntimeTarget.NEST_CQRS
        assert binding.entrypoint.__name__ == binding.tool_name
        assert getattr(tool_entrypoints, binding.tool_name) is binding.entrypoint
        assert f"def {binding.tool_name}(" in source
        assert binding.downstream_target == EXPECTED_NEST_DISCOVERY_TOOLS[binding.tool_name]


def test_runtime_binding_resolves_existing_nest_query_without_guessing() -> None:
    binding = runtime_binding("retrieve_legal_basis")

    assert binding.runtime_target == ToolRuntimeTarget.NEST_CQRS
    assert binding.entrypoint.__name__ == "retrieve_legal_basis"
    assert binding.downstream_target == "RetrieveLegalBasisQuery"

    compare = runtime_binding("compare_wizard_claim")
    assert compare.entrypoint.__name__ == "compare_wizard_claim"
    assert compare.downstream_target == "CompareWizardClaimQuery"

    gap_requirements = runtime_binding("get_gap_requirements")
    assert gap_requirements.downstream_target == "GetGapRequirementsQuery"

    source_catalog = runtime_binding("get_admin_source_catalog")
    assert source_catalog.downstream_target == "GetAdminSourceCatalogQuery"


def test_exact_named_entrypoint_dispatches_through_internal_api() -> None:
    api_client = MagicMock()
    api_client.dispatch_agentic_tool.return_value = {"status": "READY"}
    context = AgenticToolExecutionContext(
        api_client=api_client,
        user_id="user-1",
        organization_id="org-1",
    )
    request = _request("get_assessment_context")

    response = tool_entrypoints.get_assessment_context(request, context)

    assert response == {"status": "READY"}
    payload = api_client.dispatch_agentic_tool.call_args.args[0]
    assert payload["tool_name"] == "get_assessment_context"
    assert payload["assessment_id"] == str(request.assessment_id)
    assert payload["organization_id"] == "org-1"

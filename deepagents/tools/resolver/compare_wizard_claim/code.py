"""Agent-facing authored tool for `compare_wizard_claim`."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import Field
from tools.common.runtime_envelope import (
    CorrelatedToolInput,
    dispatch_agentic_tool,
    trusted_request_from_model_input,
)


class CompareWizardClaimRequest(CorrelatedToolInput):
    fact_key: str = Field(alias="factKey", min_length=1, max_length=240)
    wizard_field: str | None = Field(default=None, alias="wizardField")
    repository_ref: str | None = Field(default=None, alias="repositoryRef")
    expected_value: Any | None = Field(default=None, alias="expectedValue")
    include: list[str] = Field(default_factory=list, max_length=20)
    max_evidence_refs: int = Field(default=10, alias="maxEvidenceRefs", ge=1, le=50)


@tool(args_schema=CompareWizardClaimRequest)
def compare_wizard_claim(runtime: ToolRuntime | None = None, **request: Any) -> dict[str, Any]:
    """Compare one Wizard claim with pinned technical evidence and surface conflicts.

    Args:
        request: Domain-specific Wizard fact comparison fields.
    """
    return dispatch_agentic_tool(
        "compare_wizard_claim",
        trusted_request_from_model_input(
            CompareWizardClaimRequest.model_validate(request),
            runtime,
        ),
    )

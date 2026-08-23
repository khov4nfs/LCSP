"""Read-only LCSP context tools for Managed Deep Agents."""

from __future__ import annotations

from typing import Any

from langchain.tools import tool

from tools.lcsp_dispatch import LcspToolEnvelope, dispatch_lcsp_tool


@tool(args_schema=LcspToolEnvelope)
def get_assessment_context(**request: Any) -> dict[str, Any]:
    """Fetch bounded assessment, wizard, and artifact context for reasoning."""
    return dispatch_lcsp_tool(
        "get_assessment_context",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def get_verified_profile(**request: Any) -> dict[str, Any]:
    """Fetch the verified profile context for one LCSP assessment."""
    return dispatch_lcsp_tool(
        "get_verified_profile",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def compare_wizard_claim(**request: Any) -> dict[str, Any]:
    """Compare a wizard claim with pinned technical evidence and known conflicts."""
    return dispatch_lcsp_tool(
        "compare_wizard_claim",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def get_classification_baseline(**request: Any) -> dict[str, Any]:
    """Fetch the current classification baseline for an assessment."""
    return dispatch_lcsp_tool(
        "get_classification_baseline",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def get_gap_requirements(**request: Any) -> dict[str, Any]:
    """Fetch bounded compliance gap requirements for follow-up reasoning."""
    return dispatch_lcsp_tool(
        "get_gap_requirements",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def get_legal_corpus_readiness(**request: Any) -> dict[str, Any]:
    """Fetch legal corpus readiness and activation context."""
    return dispatch_lcsp_tool(
        "get_legal_corpus_readiness",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def retrieve_legal_basis(**request: Any) -> dict[str, Any]:
    """Retrieve approved legal basis and citation candidates for a query."""
    return dispatch_lcsp_tool(
        "retrieve_legal_basis",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def get_legal_rule_match(**request: Any) -> dict[str, Any]:
    """Fetch matched legal rules for a bounded assessment scope."""
    return dispatch_lcsp_tool(
        "get_legal_rule_match",
        LcspToolEnvelope.model_validate(request),
    )


@tool(args_schema=LcspToolEnvelope)
def validate_citation_set(**request: Any) -> dict[str, Any]:
    """Validate that proposed citations map to approved corpus evidence."""
    return dispatch_lcsp_tool(
        "validate_citation_set",
        LcspToolEnvelope.model_validate(request),
    )

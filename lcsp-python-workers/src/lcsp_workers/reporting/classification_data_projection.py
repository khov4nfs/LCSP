"""Safe document-facing projection of direct EngineeringRule assessment data."""
from __future__ import annotations

from typing import Any


DOCUMENT_CLASSIFICATION_CONTEXT_FIELDS = {
    "mode",
    "status",
    "summary",
    "legal_rule_catalog_version_id",
    "legal_corpus_version_id",
    "engineering_rules_executed",
    "limitations",
}

DOCUMENT_EVALUATION_FIELDS = {
    "engineering_rule_id",
    "legal_rule_id",
    "concept",
    "status",
    "reason",
    "evidence_refs",
    "source_chunk_ids",
    "source_locators",
    "limitations",
    "technical_evidence",
}


def document_classification_context(data: dict[str, Any]) -> dict[str, Any]:
    """Return only conclusion-safe classification fields for document prompts.

    Planner diagnostics such as ``planner`` and ``planner_decisions`` are
    investigation-scope audit metadata. They explain why rules were selected or
    skipped, but must not influence report or gap-analysis conclusions.
    """

    return {
        key: data.get(key)
        for key in DOCUMENT_CLASSIFICATION_CONTEXT_FIELDS
        if key in data
    }


def document_evaluations(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Return sanitized EngineeringRule evaluations for report generation."""

    raw_evaluations = data.get("evaluations")
    if not isinstance(raw_evaluations, list):
        return []
    return [
        {
            key: item.get(key)
            for key in DOCUMENT_EVALUATION_FIELDS
            if key in item
        }
        for item in raw_evaluations
        if isinstance(item, dict)
    ]

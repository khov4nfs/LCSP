"""Build citation-aware callback payloads for legal rule matching."""

from __future__ import annotations

from typing import Any


class LegalMatchBuilder:
    """Aggregate rule matches and derive overall citation coverage metadata."""

    def build_payload(
        self,
        *,
        verified_profile_id: str,
        assessment_id: str,
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        matches: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Build a callback-ready legal-rule-match payload.

        Args:
            verified_profile_id: Verified profile used as the legal matching input.
            assessment_id: Assessment that owns the match result.
            legal_rule_catalog_version_id: Pinned legal rule catalog version.
            legal_corpus_version_id: Pinned source corpus version used for retrieval.
            matches: Per-rule applicability/retrieval results.

        Returns:
            Payload containing flattened citation allowlist and COMPLETE/PARTIAL/NO
            citation coverage status.
        """
        citation_allowlist: list[str] = []
        for match in matches:
            chunk_ids = match.get("citation_chunk_ids") or []
            if isinstance(chunk_ids, list):
                citation_allowlist.extend(
                    str(chunk_id) for chunk_id in chunk_ids if str(chunk_id)
                )

        has_any_citations = bool(citation_allowlist)
        has_all_matches_with_citations = bool(matches) and all(
            (match.get("citation_chunk_ids") or []) for match in matches
        )
        if has_any_citations and has_all_matches_with_citations:
            overall_coverage_status = "COMPLETE_CITATION"
        elif has_any_citations:
            overall_coverage_status = "PARTIAL_CITATION"
        else:
            overall_coverage_status = "NO_CITATION"

        return {
            "verified_profile_id": verified_profile_id,
            "assessment_id": assessment_id,
            "legal_rule_catalog_version_id": legal_rule_catalog_version_id,
            "corpus_version_id": legal_corpus_version_id,
            "schema_version": "1.0.0",
            "matches": matches,
            "citation_allowlist": citation_allowlist,
            "overall_coverage_status": overall_coverage_status,
        }

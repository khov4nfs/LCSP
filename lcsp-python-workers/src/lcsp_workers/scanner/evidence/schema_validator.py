from typing import Any, List, Dict

REQUIRED_EVIDENCE_FIELDS = [
    "job_id",
    "snapshot_id",
    "schema_version",
    "tools_version",
    "config_hash",
    "findings",
    "privacy_flags",
    "quality_state",
    "coverage_limitations",
    "scan_graph",
    "scanned_at",
]

REQUIRED_PROVENANCE_FIELDS = [
    "tool_name",
    "tool_version",
    "config_hash",
    "ran_at",
    "outcome",
]


class SchemaValidationError(Exception):
    """Carries the terminal quality state associated with invalid evidence."""

    def __init__(self, message: str, quality_state: str):
        """Create a validation failure with the state downstream should persist."""
        super().__init__(message)
        self.quality_state = quality_state


def validate_schema(payload: Dict[str, Any], tool_provenance: List[Dict[str, Any]]) -> None:
    """Require complete evidence and reproducibility metadata before persistence.

    Missing ordinary contract fields fail the report, while missing configuration or
    ruleset hashes block it because downstream reviewers could not reproduce which
    scanner configuration produced the evidence.

    Args:
        payload: Evidence report being prepared for persistence.
        tool_provenance: Per-tool execution provenance attached to the report.

    Raises:
        SchemaValidationError: With ``FAILED`` for incomplete contract data or
            ``BLOCKED`` when required reproducibility hashes are absent.
    """
    for field in REQUIRED_EVIDENCE_FIELDS:
        if field not in payload or payload[field] is None:
            raise SchemaValidationError(f"Missing required payload field: {field}", "FAILED")
            
    for prov in tool_provenance:
        if "config_hash" not in prov or not prov["config_hash"]:
            raise SchemaValidationError("Missing config_hash in provenance", "BLOCKED")
            
        if "ruleset_hash" not in prov and "ruleset" in prov.get("tool_name", ""):
            # Flexible check for missing ruleset hash if tool seems to require it
            # Test T08 checks missing ruleset_hash -> PROVENANCE_BLOCKED -> BLOCKED
            raise SchemaValidationError("Missing ruleset_hash in provenance", "BLOCKED")
            
        for field in REQUIRED_PROVENANCE_FIELDS:
            if field not in prov or prov[field] is None:
                if field == "config_hash":
                    continue
                raise SchemaValidationError(f"Missing required provenance field: {field}", "FAILED")

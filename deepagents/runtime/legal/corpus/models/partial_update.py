from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class PartialUpdateContext:
    """Context for a partial update of a legal document."""
    
    document_id: str
    source_url: str
    base_snapshot_ref: str
    new_snapshot_ref: str
    changed_locators: tuple[str, ...]
    observations: tuple[dict[str, Any], ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PartialUpdateContext":
        return cls(
            document_id=str(payload.get("documentId") or payload.get("document_id") or ""),
            source_url=str(payload.get("sourceUrl") or payload.get("source_url") or ""),
            base_snapshot_ref=str(payload.get("baseSnapshotRef") or payload.get("base_snapshot_ref") or ""),
            new_snapshot_ref=str(payload.get("newSnapshotRef") or payload.get("new_snapshot_ref") or ""),
            changed_locators=tuple(
                str(loc) for loc in (payload.get("changedLocators") or payload.get("changed_locators") or [])
            ),
            observations=tuple(
                dict(obs) for obs in (payload.get("observations") or []) if isinstance(obs, dict)
            ),
        )

    def to_json(self) -> str:
        payload = self.to_dict()
        # Convert keys to camelCase for standard JSON output
        return json.dumps(
            {
                "documentId": payload["document_id"],
                "sourceUrl": payload["source_url"],
                "baseSnapshotRef": payload["base_snapshot_ref"],
                "newSnapshotRef": payload["new_snapshot_ref"],
                "changedLocators": list(payload["changed_locators"]),
                "observations": list(payload["observations"]),
            },
            ensure_ascii=False,
            indent=2,
        )

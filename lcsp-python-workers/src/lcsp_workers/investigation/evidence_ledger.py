"""Lossless per-investigation evidence state owned by the LCSP orchestrator.

The LLM context window is a working view, never the source of truth. Full graph-tool
results stay in this ledger for the lifetime of an EngineeringRule investigation;
models reference observations by ID and LCSP derives claim provenance from those
observations deterministically.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


DEFAULT_INDEX_LIMIT = 20
MAX_INDEX_LIMIT = 40
DEFAULT_INSPECT_LIMIT = 12
MAX_INSPECT_LIMIT = 40


@dataclass(frozen=True)
class ObservationProvenance:
    """Graph/source identities deterministically extracted from observations."""

    evidence_refs: tuple[str, ...] = ()
    graph_refs: tuple[str, ...] = ()
    source_anchor_refs: tuple[str, ...] = ()


@dataclass(frozen=True)
class EvidenceLedgerObservation:
    """One immutable tool/seed observation stored without prompt truncation."""

    observation_id: str
    source: str
    result: Any
    tool: str | None = None
    call_id: str | None = None
    arguments: dict[str, Any] | None = None


class EvidenceLedger:
    """Keep full investigation state while exposing bounded, pageable working views."""

    def __init__(self) -> None:
        self._rows: list[EvidenceLedgerObservation] = []
        self._by_id: dict[str, EvidenceLedgerObservation] = {}

    def add(
        self,
        *,
        source: str,
        result: Any,
        tool: str | None = None,
        call_id: str | None = None,
        arguments: dict[str, Any] | None = None,
    ) -> EvidenceLedgerObservation:
        observation_id = f"obs:{len(self._rows) + 1:04d}"
        row = EvidenceLedgerObservation(
            observation_id=observation_id,
            source=source,
            result=result,
            tool=tool,
            call_id=call_id,
            arguments=dict(arguments or {}) if arguments is not None else None,
        )
        self._rows.append(row)
        self._by_id[observation_id] = row
        return row

    @property
    def total(self) -> int:
        return len(self._rows)

    def get(self, observation_id: str) -> EvidenceLedgerObservation:
        row = self._by_id.get(str(observation_id))
        if row is None:
            raise KeyError(f"unknown observation ref: {observation_id}")
        return row

    def index(self, *, offset: int = 0, limit: int = DEFAULT_INDEX_LIMIT) -> dict[str, Any]:
        offset = max(0, int(offset))
        limit = min(MAX_INDEX_LIMIT, max(1, int(limit)))
        page = self._rows[offset : offset + limit]
        return {
            "total": len(self._rows),
            "offset": offset,
            "limit": limit,
            "hasMore": offset + len(page) < len(self._rows),
            "observations": [self.summary(row) for row in page],
        }

    def inspect(
        self,
        observation_id: str,
        *,
        section: str | None = None,
        offset: int = 0,
        limit: int = DEFAULT_INSPECT_LIMIT,
    ) -> dict[str, Any]:
        """Return a bounded page from one full observation without mutating it."""
        row = self.get(observation_id)
        offset = max(0, int(offset))
        limit = min(MAX_INSPECT_LIMIT, max(1, int(limit)))
        value = row.result

        if isinstance(value, Mapping):
            available_sections = [
                str(key)
                for key, item in value.items()
                if isinstance(item, Sequence) and not isinstance(item, (str, bytes, bytearray))
            ]
            if section:
                selected = value.get(section)
                if not isinstance(selected, Sequence) or isinstance(
                    selected, (str, bytes, bytearray)
                ):
                    return {
                        "observationId": row.observation_id,
                        "error": "OBSERVATION_SECTION_NOT_PAGEABLE",
                        "section": section,
                        "availableSections": available_sections,
                    }
                items = list(selected)
                page = items[offset : offset + limit]
                return {
                    "observationId": row.observation_id,
                    "section": section,
                    "offset": offset,
                    "limit": limit,
                    "total": len(items),
                    "hasMore": offset + len(page) < len(items),
                    "items": page,
                }

            scalars = {
                str(key): item
                for key, item in value.items()
                if not isinstance(item, (Mapping, list, tuple, set))
            }
            return {
                "observationId": row.observation_id,
                "summary": self.summary(row),
                "availableSections": available_sections,
                "scalars": scalars,
            }

        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            items = list(value)
            page = items[offset : offset + limit]
            return {
                "observationId": row.observation_id,
                "offset": offset,
                "limit": limit,
                "total": len(items),
                "hasMore": offset + len(page) < len(items),
                "items": page,
            }

        return {
            "observationId": row.observation_id,
            "value": value,
        }

    def preview(self, observation_id: str, *, limit: int = 6) -> dict[str, Any]:
        """Return one small deterministic working view for the next LLM turn."""
        row = self.get(observation_id)
        value = row.result
        if isinstance(value, Mapping):
            for section in (
                "nodes",
                "reviewNodes",
                "finalActions",
                "neighbors",
                "edges",
                "paths",
                "evidenceRefs",
            ):
                item = value.get(section)
                if isinstance(item, Sequence) and not isinstance(
                    item, (str, bytes, bytearray)
                ) and item:
                    return self.inspect(
                        observation_id,
                        section=section,
                        offset=0,
                        limit=limit,
                    )
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            return self.inspect(observation_id, offset=0, limit=limit)
        return self.inspect(observation_id)

    def summary(self, row_or_id: EvidenceLedgerObservation | str) -> dict[str, Any]:
        row = self.get(row_or_id) if isinstance(row_or_id, str) else row_or_id
        result = row.result
        provenance = self._extract_provenance(result)
        summary: dict[str, Any] = {
            "observationId": row.observation_id,
            "source": row.source,
            "tool": row.tool,
            "callId": row.call_id,
            "evidenceRefCount": len(provenance.evidence_refs),
            "graphRefCount": len(provenance.graph_refs),
            "sourceAnchorRefCount": len(provenance.source_anchor_refs),
        }

        if isinstance(result, Mapping):
            for key in (
                "query",
                "startNodeId",
                "state",
                "truncated",
            ):
                if key in result:
                    summary[key] = result.get(key)
            for key in (
                "nodes",
                "reviewNodes",
                "finalActions",
                "neighbors",
                "edges",
                "paths",
                "evidenceRefs",
                "unresolvedFrontiers",
            ):
                item = result.get(key)
                if isinstance(item, Sequence) and not isinstance(
                    item, (str, bytes, bytearray)
                ):
                    summary[f"{key}Count"] = len(item)
        elif isinstance(result, Sequence) and not isinstance(result, (str, bytes, bytearray)):
            summary["itemCount"] = len(result)

        return {key: value for key, value in summary.items() if value is not None}

    def provenance_for(self, observation_refs: Sequence[str]) -> ObservationProvenance:
        """Resolve claim provenance only from known immutable observation IDs."""
        evidence_refs: set[str] = set()
        graph_refs: set[str] = set()
        source_anchor_refs: set[str] = set()
        for observation_ref in observation_refs:
            row = self.get(str(observation_ref))
            provenance = self._extract_provenance(row.result)
            evidence_refs.update(provenance.evidence_refs)
            graph_refs.update(provenance.graph_refs)
            source_anchor_refs.update(provenance.source_anchor_refs)
        return ObservationProvenance(
            evidence_refs=tuple(sorted(evidence_refs)),
            graph_refs=tuple(sorted(graph_refs)),
            source_anchor_refs=tuple(sorted(source_anchor_refs)),
        )

    @classmethod
    def _extract_provenance(cls, value: Any) -> ObservationProvenance:
        evidence_refs: set[str] = set()
        graph_refs: set[str] = set()
        source_anchor_refs: set[str] = set()

        def walk(item: Any, key: str | None = None) -> None:
            if isinstance(item, Mapping):
                for child_key, child in item.items():
                    normalized = str(child_key)
                    if normalized in {"node_id", "edge_id"} and child:
                        graph_refs.add(str(child))
                    elif normalized in {"anchor_id", "source_anchor_id"} and child:
                        source_anchor_refs.add(str(child))
                    elif normalized in {"evidenceRefs", "evidence_refs"} and isinstance(
                        child, Sequence
                    ) and not isinstance(child, (str, bytes, bytearray)):
                        evidence_refs.update(str(ref) for ref in child if str(ref))
                    elif normalized == "paths" and isinstance(child, Sequence) and not isinstance(
                        child, (str, bytes, bytearray)
                    ):
                        for path in child:
                            if isinstance(path, Sequence) and not isinstance(
                                path, (str, bytes, bytearray)
                            ):
                                graph_refs.update(str(ref) for ref in path if str(ref))
                    walk(child, normalized)
                return
            if isinstance(item, Sequence) and not isinstance(item, (str, bytes, bytearray)):
                for child in item:
                    walk(child, key)

        walk(value)
        return ObservationProvenance(
            evidence_refs=tuple(sorted(evidence_refs)),
            graph_refs=tuple(sorted(graph_refs)),
            source_anchor_refs=tuple(sorted(source_anchor_refs)),
        )

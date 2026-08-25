"""Lossless per-investigation evidence state owned by the LCSP orchestrator.

The LLM context window is a working view, never the source of truth. Full graph-tool
results stay in this ledger for the lifetime of an EngineeringRule investigation;
models reference observations by ID and LCSP derives claim provenance from those
observations deterministically.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping, Sequence


DEFAULT_INDEX_LIMIT = 20
MAX_INDEX_LIMIT = 40
DEFAULT_INSPECT_LIMIT = 12
MAX_INSPECT_LIMIT = 40
MAX_INSPECT_PAGE_CHARS = 18_000
SECTION_ALIASES = {
    "evidence": "evidenceRefs",
    "evidence_refs": "evidenceRefs",
}
PREVIEW_SECTION_PRIORITY = (
    "results",
    "files",
    "references",
    "symbols",
    "importantSymbols",
    "nodes",
    "reviewNodes",
    "finalActions",
    "neighbors",
    "edges",
    "paths",
    "evidenceRefs",
    "continuationFrontiers",
    "unresolvedFrontiers",
)


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
        next_offset = offset + len(page)
        has_more = next_offset < len(self._rows)
        return {
            "total": len(self._rows),
            "offset": offset,
            "limit": limit,
            "hasMore": has_more,
            "nextOffset": next_offset if has_more else None,
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
        """Return a bounded page from one full observation without mutating it.

        Common deterministic aliases are normalized to canonical graph fields. Every
        observation summary advertises its exact pageable sections so the model does
        not have to guess across graph, wizard and code-context observation shapes.
        Requested pages are also char-bounded automatically; LCSP shrinks an oversized
        page instead of spending another LLM turn on ``WORKING_VIEW_TOO_LARGE``.
        """
        row = self.get(observation_id)
        offset = max(0, int(offset))
        requested_limit = min(MAX_INSPECT_LIMIT, max(1, int(limit)))
        value = row.result

        if isinstance(value, Mapping):
            available_sections = self._available_sections(value)
            if section:
                requested_section = str(section)
                selected_section = SECTION_ALIASES.get(
                    requested_section,
                    SECTION_ALIASES.get(requested_section.lower(), requested_section),
                )
                selected = value.get(selected_section)
                if not isinstance(selected, Sequence) or isinstance(
                    selected, (str, bytes, bytearray)
                ):
                    return {
                        "observationId": row.observation_id,
                        "error": "OBSERVATION_SECTION_NOT_PAGEABLE",
                        "section": requested_section,
                        "availableSections": available_sections,
                        "instruction": (
                            "Use one of availableSections exactly; section names are observation-specific."
                        ),
                    }
                items = list(selected)
                page = self._bounded_page(items, offset=offset, limit=requested_limit)
                next_offset = offset + len(page)
                has_more = next_offset < len(items)
                result = {
                    "observationId": row.observation_id,
                    "section": selected_section,
                    "offset": offset,
                    "limit": len(page),
                    "total": len(items),
                    "hasMore": has_more,
                    "nextOffset": next_offset if has_more else None,
                    "items": page,
                }
                if len(page) < min(requested_limit, max(0, len(items) - offset)):
                    result["requestedLimit"] = requested_limit
                    result["pageCharBoundApplied"] = True
                if selected_section != requested_section:
                    result["requestedSection"] = requested_section
                return result

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
            page = self._bounded_page(items, offset=offset, limit=requested_limit)
            next_offset = offset + len(page)
            has_more = next_offset < len(items)
            result = {
                "observationId": row.observation_id,
                "offset": offset,
                "limit": len(page),
                "total": len(items),
                "hasMore": has_more,
                "nextOffset": next_offset if has_more else None,
                "items": page,
            }
            if len(page) < min(requested_limit, max(0, len(items) - offset)):
                result["requestedLimit"] = requested_limit
                result["pageCharBoundApplied"] = True
            return result

        return {
            "observationId": row.observation_id,
            "value": value,
        }

    def preview(self, observation_id: str, *, limit: int = 6) -> dict[str, Any]:
        """Return one small deterministic working view for the next LLM turn."""
        row = self.get(observation_id)
        value = row.result
        if isinstance(value, Mapping):
            for section in PREVIEW_SECTION_PRIORITY:
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
            available_sections = self._available_sections(result)
            if available_sections:
                summary["availableSections"] = available_sections
            for key in (
                "query",
                "startNodeId",
                "state",
                "truncated",
                "nextCursor",
            ):
                if key in result:
                    summary[key] = result.get(key)
            for key in available_sections:
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

    def provenance_for_all(self) -> ObservationProvenance:
        """Resolve bounded fallback provenance from every retained observation."""
        return self.provenance_for(tuple(row.observation_id for row in self._rows))

    @staticmethod
    def _available_sections(value: Mapping[str, Any]) -> list[str]:
        return [
            str(key)
            for key, item in value.items()
            if isinstance(item, Sequence) and not isinstance(item, (str, bytes, bytearray))
        ]

    @staticmethod
    def _bounded_page(items: list[Any], *, offset: int, limit: int) -> list[Any]:
        page = items[offset : offset + limit]
        while len(page) > 1:
            rendered = json.dumps(page, ensure_ascii=False, sort_keys=True, default=str)
            if len(rendered) <= MAX_INSPECT_PAGE_CHARS:
                break
            page = page[: max(1, len(page) // 2)]
        return page

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

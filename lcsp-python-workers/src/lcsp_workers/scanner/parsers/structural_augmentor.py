from __future__ import annotations

from pathlib import Path
from typing import Iterable

from .structural_types import StructuralFact
from .tree_sitter_parser import StructuralParser


class StructuralAugmentor:
    def __init__(self, *, workspace_path: str | None = None) -> None:
        self._workspace_path = Path(workspace_path) if workspace_path else None
        self._parser = StructuralParser()
        self.last_coverage_notes: list[str] = []

    def set_workspace_path(self, workspace_path: str | Path) -> None:
        self._workspace_path = Path(workspace_path)

    def augment(
        self,
        *,
        files: Iterable[str | Path],
        finding_ids: Iterable[str],
    ) -> list[StructuralFact]:
        finding_id_list = list(finding_ids)
        facts: list[StructuralFact] = []
        self.last_coverage_notes = []

        for file_path in files:
            try:
                parsed = self._parser.parse_file(self._resolve_path(file_path))
            except Exception:
                self.last_coverage_notes.append(
                    "SCAN_COVERAGE_LIMITATION: "
                    f"file={file_path} reason=structural_parser_failed"
                )
                continue

            for fact in parsed:
                facts.append(
                    StructuralFact(
                        file_path=str(Path(fact.file_path).relative_to(self._workspace_path))
                        if self._workspace_path and Path(fact.file_path).is_absolute()
                        else fact.file_path,
                        pattern_type=fact.pattern_type,
                        name=fact.name,
                        line_number=fact.line_number,
                        decorators=list(fact.decorators),
                        is_async=fact.is_async,
                        ai_finding_ids=finding_id_list,
                        graph_node_type=fact.graph_node_type,
                        parse_source=fact.parse_source,
                    )
                )
        return facts

    def _resolve_path(self, file_path: str | Path) -> Path:
        path = Path(file_path)
        if self._workspace_path and not path.is_absolute():
            return self._workspace_path / path
        return path

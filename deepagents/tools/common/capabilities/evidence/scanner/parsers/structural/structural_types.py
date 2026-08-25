from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class StructuralFact:
    file_path: str
    pattern_type: str
    name: str
    line_number: int
    decorators: list[str] = field(default_factory=list)
    is_async: bool = False
    ai_finding_ids: list[str] = field(default_factory=list)
    graph_node_type: str = "FUNCTION"
    parse_source: str = "custom_regex_fallback"

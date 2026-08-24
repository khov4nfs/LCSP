"""Database schema and persistence lineage for the unified evidence graph."""
from __future__ import annotations

import re
from pathlib import Path

from .semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from .sensitive_data import semantic_types_for_identifier
from .source_roles import is_test_source_path

_EXCLUDED = frozenset(
    {
        ".git",
        "node_modules",
        "dist",
        "build",
        ".next",
        "coverage",
        "vendor",
        ".venv",
        "venv",
        "__pycache__",
        "target",
        "bin",
        "obj",
    }
)
_PRISMA_MODEL_RE = re.compile(r"\bmodel\s+([A-Za-z_][\w]*)\s*\{(.*?)\}", re.S)
# Use horizontal whitespace only. In multiline mode ``\s`` also consumes newlines and can
# swallow a following Prisma field row, which made later fields disappear from lineage.
_PRISMA_FIELD_RE = re.compile(
    r"(?m)^[ \t]*([A-Za-z_][\w]*)[ \t]+([A-Za-z_][\w]*(?:\[\])?\??)(?:[ \t]+.*)?$"
)
_SQL_TABLE_RE = re.compile(
    r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\"`\[]?([A-Za-z_][\w]*)[\"`\]]?\.)?[\"`\[]?([A-Za-z_][\w]*)[\"`\]]?\s*\((.*?)\)\s*;",
    re.I | re.S,
)
_SQL_COLUMN_RE = re.compile(
    r"(?m)^\s*[\"`\[]?([A-Za-z_][\w]*)[\"`\]]?\s+([A-Za-z][A-Za-z0-9_]*(?:\s*\([^)]*\))?)"
)
_SQL_CONSTRAINT_PREFIXES = frozenset(
    {"primary", "foreign", "constraint", "unique", "check", "key"}
)


class DatabaseSchemaLineageExtractor:
    """Materialize DB contracts and resolve model-scoped persistence operations."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        entities: dict[str, tuple[str, str]] = {}
        for path in self._files():
            rel = path.relative_to(self.workspace).as_posix()
            if path.suffix.lower() == ".prisma":
                entities.update(self._prisma(program, path, rel))
            elif path.suffix.lower() == ".sql":
                entities.update(self._sql(program, path, rel))
        self._link_persistence(program, entities)
        return program

    def _prisma(
        self,
        program: SemanticProgram,
        path: Path,
        rel: str,
    ) -> dict[str, tuple[str, str]]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        contract_key = f"data-contract:database:{rel}"
        program.add_node(
            SemanticNodeFact(
                contract_key,
                "DATA_CONTRACT",
                rel,
                rel,
                1,
                1,
                attributes={"protocol": "PRISMA_SCHEMA"},
                origin="CONTRACT_ANALYSIS",
            )
        )
        result: dict[str, tuple[str, str]] = {}
        for match in _PRISMA_MODEL_RE.finditer(text):
            model_name, body = match.groups()
            line = _line(text, match.start())
            entity_key = f"entity:prisma:{model_name}"
            table_key = f"table:prisma:{model_name}"
            result[_canonical(model_name)] = (entity_key, table_key)
            program.add_node(
                SemanticNodeFact(
                    entity_key,
                    "ENTITY",
                    model_name,
                    rel,
                    line,
                    line,
                    model_name,
                    attributes={"schemaKind": "PRISMA"},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            program.add_node(
                SemanticNodeFact(
                    table_key,
                    "TABLE",
                    model_name,
                    rel,
                    line,
                    line,
                    attributes={"schemaKind": "PRISMA"},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            program.add_edge(
                SemanticEdgeFact("DECLARES", contract_key, entity_key, origin="CONTRACT_ANALYSIS")
            )
            program.add_edge(
                SemanticEdgeFact("MAPS_TO", entity_key, table_key, origin="CONTRACT_ANALYSIS")
            )
            for field_match in _PRISMA_FIELD_RE.finditer(body):
                field_name, field_type = field_match.groups()
                if field_name.startswith("@@") or field_name.startswith("//"):
                    continue
                field_line = line + body.count("\n", 0, field_match.start())
                self._field(
                    program,
                    owner_key=entity_key,
                    rel=rel,
                    line=field_line,
                    label=f"{model_name}.{field_name}",
                    field_name=field_name,
                    field_type=field_type,
                    schema_kind="PRISMA",
                )
        return result

    def _sql(
        self,
        program: SemanticProgram,
        path: Path,
        rel: str,
    ) -> dict[str, tuple[str, str]]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {}
        contract_key = f"data-contract:database:{rel}"
        program.add_node(
            SemanticNodeFact(
                contract_key,
                "DATA_CONTRACT",
                rel,
                rel,
                1,
                1,
                attributes={"protocol": "SQL_DDL"},
                origin="CONTRACT_ANALYSIS",
            )
        )
        result: dict[str, tuple[str, str]] = {}
        for match in _SQL_TABLE_RE.finditer(text):
            schema_name, table_name, body = match.groups()
            line = _line(text, match.start())
            qualified = f"{schema_name}.{table_name}" if schema_name else table_name
            entity_key = f"entity:sql:{qualified}"
            table_key = f"table:sql:{qualified}"
            result[_canonical(table_name)] = (entity_key, table_key)
            program.add_node(
                SemanticNodeFact(
                    entity_key,
                    "ENTITY",
                    table_name,
                    rel,
                    line,
                    line,
                    attributes={"schemaKind": "SQL_DDL"},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            program.add_node(
                SemanticNodeFact(
                    table_key,
                    "TABLE",
                    qualified,
                    rel,
                    line,
                    line,
                    attributes={"schemaKind": "SQL_DDL"},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            program.add_edge(
                SemanticEdgeFact("DECLARES", contract_key, entity_key, origin="CONTRACT_ANALYSIS")
            )
            program.add_edge(
                SemanticEdgeFact("MAPS_TO", entity_key, table_key, origin="CONTRACT_ANALYSIS")
            )
            for field_match in _SQL_COLUMN_RE.finditer(body):
                field_name, field_type = field_match.groups()
                if field_name.lower() in _SQL_CONSTRAINT_PREFIXES:
                    continue
                field_line = line + body.count("\n", 0, field_match.start())
                self._field(
                    program,
                    owner_key=entity_key,
                    rel=rel,
                    line=field_line,
                    label=f"{table_name}.{field_name}",
                    field_name=field_name,
                    field_type=field_type,
                    schema_kind="SQL_DDL",
                )
        return result

    @staticmethod
    def _field(
        program: SemanticProgram,
        *,
        owner_key: str,
        rel: str,
        line: int,
        label: str,
        field_name: str,
        field_type: str,
        schema_kind: str,
    ) -> None:
        key = f"data-object:database:{_safe(rel)}:{_safe(label)}"
        semantics = semantic_types_for_identifier(field_name)
        program.add_node(
            SemanticNodeFact(
                key,
                "DATA_OBJECT",
                label,
                rel,
                line,
                line,
                label,
                attributes={"schemaKind": schema_kind, "fieldType": field_type},
                semantic_types=semantics,
                origin="CONTRACT_ANALYSIS",
                resolution_state="INFERRED" if semantics else "OBSERVED",
            )
        )
        program.add_edge(
            SemanticEdgeFact("CARRIES_DATA", owner_key, key, origin="CONTRACT_ANALYSIS")
        )

    @staticmethod
    def _link_persistence(
        program: SemanticProgram,
        entities: dict[str, tuple[str, str]],
    ) -> None:
        if not entities:
            return
        existing = {
            (edge.edge_type, edge.source_key, edge.target_key)
            for edge in program.edges
        }
        for node in tuple(program.nodes):
            if node.node_type != "REPOSITORY_ACCESS":
                continue
            label = _canonical(node.label)
            matches = [
                (name, pair)
                for name, pair in entities.items()
                if name and name in label
            ]
            if len(matches) != 1:
                continue
            _, (_, table_key) = matches[0]
            edge_type = (
                "PERSISTS_TO"
                if str((node.attributes or {}).get("operation") or "").upper() == "WRITE"
                else "LOADS_FROM"
            )
            key = (edge_type, node.key, table_key)
            if key in existing:
                continue
            existing.add(key)
            program.add_edge(
                SemanticEdgeFact(
                    edge_type,
                    node.key,
                    table_key,
                    origin="DATA_LINEAGE",
                    resolution_state="CORROBORATED",
                )
            )

    def _files(self) -> tuple[Path, ...]:
        result = []
        for path in self.workspace.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".prisma", ".sql"}:
                continue
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED for part in relative.parts):
                continue
            rel = relative.as_posix()
            if is_test_source_path(rel):
                continue
            result.append(path)
        return tuple(sorted(result))


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)[:200] or "unknown"


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1

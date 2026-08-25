"""Progressive code-context retrieval over an immutable repository snapshot.

This module deliberately keeps repository source outside persisted evidence artifacts.
The Program Evidence Graph supplies AST/CST-derived symbol boundaries and relations;
source text is materialized only from the pinned snapshot workspace for the lifetime
of one EngineeringRule assessment. LLM tools receive stable commit-versioned symbol
IDs, cursor-paged results, and bounded source pages instead of repository dumps.
"""
from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import quote

from middleware.redaction import redact_string
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph


CODE_SYMBOL_NODE_TYPES = frozenset(
    {
        "MODULE",
        "CLASS",
        "INTERFACE",
        "FUNCTION",
        "METHOD",
        "HTTP_ROUTE",
        "COMMAND",
        "QUERY",
        "EVENT",
        "WEBHOOK",
        "CRON",
        "AI_MODEL_INVOCATION",
        "VALIDATOR",
        "PARSER",
        "TRANSFORMATION",
    }
)
REFERENCE_EDGE_TYPES = frozenset(
    {
        "CALLS",
        "CALLS_DYNAMICALLY",
        "RESOLVES_TO",
        "IMPLEMENTS",
        "EXTENDS",
        "IMPORTS",
        "DEPENDS_ON",
        "HANDLED_BY",
        "TRIGGERS",
        "PUBLISHES_EVENT",
        "CONSUMES_EVENT",
        "PUBLISHES_COMMAND",
        "HANDLES_COMMAND",
        "PUBLISHES_QUERY",
        "HANDLES_QUERY",
    }
)
SEARCH_CANDIDATE_LIMIT = 50
SEARCH_PAGE_SIZE = 5
OUTLINE_PAGE_SIZE = 40
SOURCE_PAGE_LINES = 80
HASH_VECTOR_DIMENSIONS = 128
_TOKEN = re.compile(r"[A-Za-zÀ-ỹ0-9]+", re.UNICODE)
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


@dataclass(frozen=True)
class CodeSymbol:
    symbol_id: str
    chunk_id: str
    node_id: str
    node_type: str
    label: str
    file_path: str
    symbol_ref: str
    parent_symbol_id: str | None
    start_line: int | None
    end_line: int | None
    semantic_types: tuple[str, ...]
    evidence_refs: tuple[str, ...]

    def compact(self) -> dict[str, Any]:
        return {
            "symbolId": self.symbol_id,
            "chunkId": self.chunk_id,
            "kind": self.node_type,
            "symbol": self.symbol_ref or self.label,
            "path": self.file_path,
            "lines": [self.start_line, self.end_line]
            if self.start_line is not None
            else None,
            "parentSymbolId": self.parent_symbol_id,
            "semanticTypes": list(self.semantic_types),
            "evidenceRefs": list(self.evidence_refs),
        }


class CodeContextSession:
    """Server-side working set for progressive Agentic RAG code investigation."""

    def __init__(
        self,
        graph: ProgramEvidenceGraph | Mapping[str, Any],
        *,
        workspace_path: str | Path | None = None,
    ) -> None:
        self.graph = (
            graph
            if isinstance(graph, ProgramEvidenceGraph)
            else ProgramEvidenceGraph.from_dict(dict(graph))
        )
        self.commit_sha = str(self.graph.commit_sha or "unknown")
        self.workspace_path = Path(workspace_path) if workspace_path else None
        self._node_by_id = {str(row.get("node_id")): row for row in self.graph.nodes}
        self._symbols: dict[str, CodeSymbol] = {}
        self._by_node: dict[str, str] = {}
        self._by_chunk: dict[str, str] = {}
        self._search_sessions: dict[str, tuple[str, ...]] = {}
        self._important_symbols: list[str] = []
        self._workspace_notes: list[str] = []
        self._file_lines: dict[str, list[str] | None] = {}
        self._outgoing: dict[str, list[tuple[str, str]]] = defaultdict(list)
        self._incoming: dict[str, list[tuple[str, str]]] = defaultdict(list)
        self._build_relation_index()
        self._build_symbol_index()
        self._document_frequency = self._build_document_frequency()

    @property
    def available(self) -> bool:
        return bool(self._symbols)

    def repo_map(self, cursor: str | None = None) -> dict[str, Any]:
        """Return hierarchical file/symbol summaries without implementation source."""
        files: dict[str, list[CodeSymbol]] = defaultdict(list)
        for symbol in self._symbols.values():
            files[symbol.file_path].append(symbol)
        ordered = sorted(files)
        offset = self._cursor_offset(cursor, prefix="repo", default=0)
        page_paths = ordered[offset : offset + OUTLINE_PAGE_SIZE]
        rows = []
        for path in page_paths:
            symbols = sorted(
                files[path],
                key=lambda item: (
                    item.start_line if item.start_line is not None else 10**9,
                    item.symbol_ref,
                ),
            )
            kinds = Counter(item.node_type for item in symbols)
            semantic = sorted({value for item in symbols for value in item.semantic_types})
            rows.append(
                {
                    "path": path,
                    "module": path.rsplit("/", 1)[0] if "/" in path else ".",
                    "summary": self._hierarchical_summary(symbols, kinds, semantic),
                    "symbolCount": len(symbols),
                    "symbols": [
                        {
                            "symbolId": item.symbol_id,
                            "kind": item.node_type,
                            "symbol": item.symbol_ref or item.label,
                            "lines": [item.start_line, item.end_line]
                            if item.start_line is not None
                            else None,
                        }
                        for item in symbols[:8]
                    ],
                    "symbolsTruncated": len(symbols) > 8,
                }
            )
        next_offset = offset + len(page_paths)
        truncated = next_offset < len(ordered)
        return {
            "commit": self.commit_sha,
            "fileCount": len(ordered),
            "files": rows,
            "truncated": truncated,
            "nextCursor": f"repo:{next_offset}" if truncated else None,
        }

    def search_code(
        self,
        *,
        query: str | None = None,
        scope: Iterable[str] = (),
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Hybrid lexical/vector/graph search with deterministic cursor paging.

        Candidate generation combines BM25-like lexical relevance over complete
        semantic symbol chunks, a hashed vector cosine score over code+metadata,
        exact symbol/token matches, path relevance, semantic graph labels, and graph
        proximity to symbols already pinned in the server-side workspace. The top 50
        candidates are deterministically reranked before exposing pages of five.
        """
        if cursor:
            session_id, offset = self._parse_search_cursor(cursor)
            ranked = self._search_sessions.get(session_id)
            if ranked is None:
                return {"error": "SEARCH_CURSOR_EXPIRED", "truncated": False}
        else:
            normalized_query = str(query or "").strip()
            if not normalized_query:
                return {"error": "SEARCH_QUERY_REQUIRED", "truncated": False}
            scopes = tuple(sorted(str(value).strip("/") for value in scope if str(value)))
            ranked_symbols = self._rank(normalized_query, scopes)
            session_id = self._search_session_id(normalized_query, scopes)
            ranked = tuple(item.symbol_id for item in ranked_symbols[:SEARCH_CANDIDATE_LIMIT])
            self._search_sessions[session_id] = ranked
            offset = 0

        page_ids = ranked[offset : offset + SEARCH_PAGE_SIZE]
        page = [self._symbols[value] for value in page_ids if value in self._symbols]
        next_offset = offset + len(page_ids)
        truncated = next_offset < len(ranked)
        return {
            "commit": self.commit_sha,
            "results": [self._search_result(item) for item in page],
            "truncated": truncated,
            "nextCursor": f"search:{session_id}:{next_offset}" if truncated else None,
            "omittedResults": max(0, len(ranked) - next_offset),
        }

    def get_symbol(self, symbol_id: str) -> dict[str, Any]:
        symbol = self._resolve_symbol(symbol_id)
        if symbol is None:
            return {"error": "SYMBOL_NOT_FOUND", "symbolId": symbol_id}
        callers, callees = self._reference_ids(symbol)
        result = symbol.compact()
        result.update(
            {
                "callers": callers[:20],
                "callees": callees[:20],
                "callersTruncated": len(callers) > 20,
                "calleesTruncated": len(callees) > 20,
                "sourceAvailable": self._source_path(symbol.file_path) is not None,
            }
        )
        return result

    def get_file_outline(self, file_path: str) -> dict[str, Any]:
        normalized = str(file_path).replace("\\", "/").lstrip("/")
        rows = [item for item in self._symbols.values() if item.file_path == normalized]
        rows.sort(
            key=lambda item: (
                item.start_line if item.start_line is not None else 10**9,
                item.symbol_ref,
            )
        )
        kinds = Counter(item.node_type for item in rows)
        semantic = sorted({value for item in rows for value in item.semantic_types})
        return {
            "commit": self.commit_sha,
            "path": normalized,
            "summary": self._hierarchical_summary(rows, kinds, semantic),
            "symbols": [item.compact() for item in rows],
            "truncated": False,
        }

    def get_code(
        self,
        *,
        symbol_id: str | None = None,
        chunk_id: str | None = None,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """Read a line page inside one semantic AST/CST symbol boundary.

        The symbol boundary never changes when the page advances; pagination is
        line-based inside the same semantic chunk rather than arbitrary character
        splitting. Source is secret-redacted before it can leave the worker boundary.
        The source payload intentionally uses the key ``code`` so structured logging
        redaction removes it from safe logs while the governed LLM working view can
        still consume it.
        """
        lookup = symbol_id or self._by_chunk.get(str(chunk_id or ""))
        symbol = self._resolve_symbol(str(lookup or ""))
        if symbol is None:
            return {"error": "CODE_CHUNK_NOT_FOUND", "truncated": False}
        lines = self._read_file_lines(symbol.file_path)
        if lines is None:
            return {
                **symbol.compact(),
                "error": "SNAPSHOT_SOURCE_UNAVAILABLE",
                "truncated": False,
            }

        start = max(1, int(symbol.start_line or 1))
        end = min(len(lines), int(symbol.end_line or start))
        if end < start:
            end = start
        offset = self._cursor_offset(cursor, prefix="code", default=0)
        page_start = min(end + 1, start + offset)
        page_end = min(end, page_start + SOURCE_PAGE_LINES - 1)
        code = []
        if page_start <= page_end:
            code = [
                {"line": line_no, "text": redact_string(lines[line_no - 1])}
                for line_no in range(page_start, page_end + 1)
            ]
        consumed = max(0, page_end - start + 1)
        truncated = page_end < end
        return {
            **symbol.compact(),
            "code": code,
            "truncated": truncated,
            "nextCursor": f"code:{consumed}" if truncated else None,
        }

    def find_references(
        self,
        *,
        symbol_id: str,
        direction: str = "ALL",
    ) -> dict[str, Any]:
        symbol = self._resolve_symbol(symbol_id)
        if symbol is None:
            return {"error": "SYMBOL_NOT_FOUND", "symbolId": symbol_id}
        callers, callees = self._reference_ids(symbol)
        direction = str(direction or "ALL").upper()
        selected: list[str] = []
        if direction in {"ALL", "CALLERS"}:
            selected.extend(callers)
        if direction in {"ALL", "CALLEES"}:
            selected.extend(callees)
        deduped = list(dict.fromkeys(selected))
        rows = [self._symbols[value].compact() for value in deduped[:40] if value in self._symbols]
        return {
            "symbolId": symbol.symbol_id,
            "direction": direction,
            "references": rows,
            "truncated": len(deduped) > 40,
        }

    def workspace_update(
        self,
        *,
        add_symbols: Iterable[str] = (),
        remove_symbols: Iterable[str] = (),
        notes: Iterable[str] = (),
    ) -> dict[str, Any]:
        remove = {str(value) for value in remove_symbols}
        self._important_symbols = [
            value for value in self._important_symbols if value not in remove
        ]
        for value in add_symbols:
            symbol = self._resolve_symbol(str(value))
            if symbol and symbol.symbol_id not in self._important_symbols:
                self._important_symbols.append(symbol.symbol_id)
        for note in notes:
            normalized = str(note).strip()
            if normalized and normalized not in self._workspace_notes:
                self._workspace_notes.append(normalized[:1000])
        self._important_symbols = self._important_symbols[-40:]
        self._workspace_notes = self._workspace_notes[-40:]
        return self.workspace_get()

    def workspace_get(self) -> dict[str, Any]:
        return {
            "commit": self.commit_sha,
            "importantSymbols": [
                self._symbols[value].compact()
                for value in self._important_symbols
                if value in self._symbols
            ],
            "notes": list(self._workspace_notes),
        }

    def _build_relation_index(self) -> None:
        for edge in self.graph.edges:
            edge_type = str(edge.get("edge_type") or "")
            if edge_type not in REFERENCE_EDGE_TYPES:
                continue
            source = str(edge.get("source_node_id") or "")
            target = str(edge.get("target_node_id") or "")
            if source and target:
                self._outgoing[source].append((edge_type, target))
                self._incoming[target].append((edge_type, source))

    def _build_symbol_index(self) -> None:
        parent_by_node: dict[str, str] = {}
        for edge in self.graph.edges:
            if str(edge.get("edge_type") or "") not in {"CONTAINS", "DECLARES"}:
                continue
            parent_by_node[str(edge.get("target_node_id") or "")] = str(
                edge.get("source_node_id") or ""
            )

        candidates: list[tuple[dict[str, Any], str, str, int | None, int | None]] = []
        for node in self.graph.nodes:
            node_type = str(node.get("node_type") or "")
            source = node.get("source") or {}
            file_path = str(source.get("file_path") or source.get("filePath") or "").replace(
                "\\", "/"
            )
            if not file_path or node_type not in CODE_SYMBOL_NODE_TYPES:
                continue
            symbol_ref = str(
                source.get("symbol_ref")
                or source.get("symbolRef")
                or node.get("label")
                or node.get("node_id")
            )
            start = self._int_or_none(source.get("start_line") or source.get("startLine"))
            end = self._int_or_none(source.get("end_line") or source.get("endLine"))
            candidates.append((node, file_path, symbol_ref, start, end))

        for node, file_path, symbol_ref, start, end in candidates:
            node_id = str(node.get("node_id") or "")
            symbol_id = self._stable_symbol_id(file_path, symbol_ref)
            chunk_id = self._stable_chunk_id(file_path, symbol_ref, start, end)
            self._by_node[node_id] = symbol_id
            self._by_chunk[chunk_id] = symbol_id
            self._symbols[symbol_id] = CodeSymbol(
                symbol_id=symbol_id,
                chunk_id=chunk_id,
                node_id=node_id,
                node_type=str(node.get("node_type") or "SYMBOL"),
                label=str(node.get("label") or symbol_ref),
                file_path=file_path,
                symbol_ref=symbol_ref,
                parent_symbol_id=None,
                start_line=start,
                end_line=end,
                semantic_types=tuple(str(value) for value in node.get("semantic_types") or []),
                evidence_refs=tuple(str(value) for value in node.get("evidence_refs") or []),
            )

        for node_id, symbol_id in list(self._by_node.items()):
            parent_node = parent_by_node.get(node_id)
            parent_symbol_id = self._by_node.get(parent_node or "")
            if not parent_symbol_id:
                continue
            item = self._symbols[symbol_id]
            self._symbols[symbol_id] = CodeSymbol(
                symbol_id=item.symbol_id,
                chunk_id=item.chunk_id,
                node_id=item.node_id,
                node_type=item.node_type,
                label=item.label,
                file_path=item.file_path,
                symbol_ref=item.symbol_ref,
                parent_symbol_id=parent_symbol_id,
                start_line=item.start_line,
                end_line=item.end_line,
                semantic_types=item.semantic_types,
                evidence_refs=item.evidence_refs,
            )

    def _rank(self, query: str, scopes: tuple[str, ...]) -> list[CodeSymbol]:
        query_tokens = self._tokens(query)
        query_vector = self._hash_vector(query_tokens)
        scored: list[tuple[float, str, CodeSymbol]] = []
        pinned_nodes = {
            self._symbols[value].node_id
            for value in self._important_symbols
            if value in self._symbols
        }
        for symbol in self._symbols.values():
            if scopes and not any(symbol.file_path.startswith(scope) for scope in scopes):
                continue
            document = self._search_document(symbol, include_source=True)
            tokens = self._tokens(document)
            if not tokens:
                continue
            lexical = self._bm25(query_tokens, tokens)
            vector = self._cosine(query_vector, self._hash_vector(tokens))
            lowered = document.lower()
            exact = 1.0 if query.lower() in lowered else 0.0
            symbol_exact = 1.0 if any(
                token.lower() in symbol.symbol_ref.lower() for token in query_tokens
            ) else 0.0
            path_score = 1.0 if any(
                token.lower() in symbol.file_path.lower() for token in query_tokens
            ) else 0.0
            graph_score = self._graph_proximity(symbol.node_id, pinned_nodes)
            score = (
                lexical * 0.38
                + vector * 0.24
                + exact * 0.16
                + symbol_exact * 0.12
                + graph_score * 0.07
                + path_score * 0.03
            )
            if score > 0:
                scored.append((score, symbol.symbol_id, symbol))
        scored.sort(key=lambda row: (-row[0], row[1]))
        return [row[2] for row in scored]

    def _search_result(self, symbol: CodeSymbol) -> dict[str, Any]:
        item = symbol.compact()
        item["reason"] = (
            "hybrid BM25 + code/semantic hashed-vector + exact-symbol + graph-proximity rerank"
        )
        return item

    def _search_document(self, symbol: CodeSymbol, *, include_source: bool = False) -> str:
        parts = [
            symbol.label,
            symbol.symbol_ref,
            symbol.file_path,
            symbol.node_type,
            *symbol.semantic_types,
        ]
        if include_source:
            lines = self._read_file_lines(symbol.file_path)
            if lines is not None:
                start = max(1, int(symbol.start_line or 1))
                end = min(len(lines), int(symbol.end_line or start))
                if start <= end:
                    # Internal retrieval scoring may inspect the complete semantic
                    # symbol. It is never copied wholesale into an LLM response.
                    parts.append("\n".join(lines[start - 1 : end]))
        return " ".join(parts)

    def _build_document_frequency(self) -> Counter[str]:
        counts: Counter[str] = Counter()
        for symbol in self._symbols.values():
            counts.update(set(self._tokens(self._search_document(symbol))))
        return counts

    def _bm25(self, query_tokens: list[str], document_tokens: list[str]) -> float:
        if not query_tokens or not document_tokens:
            return 0.0
        frequencies = Counter(document_tokens)
        total_docs = max(1, len(self._symbols))
        length = len(document_tokens)
        score = 0.0
        for token in query_tokens:
            tf = frequencies[token]
            if not tf:
                continue
            df = self._document_frequency.get(token, 0)
            idf = math.log(1 + (total_docs - df + 0.5) / (df + 0.5))
            score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * length / 16)))
        return score / max(1.0, len(query_tokens))

    @classmethod
    def _tokens(cls, text: str) -> list[str]:
        expanded = _CAMEL.sub(" ", str(text)).replace("_", " ")
        return [value.lower() for value in _TOKEN.findall(expanded) if len(value) > 1]

    @staticmethod
    def _hash_vector(tokens: Iterable[str]) -> list[float]:
        vector = [0.0] * HASH_VECTOR_DIMENSIONS
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:2], "big") % HASH_VECTOR_DIMENSIONS
            sign = 1.0 if digest[2] & 1 else -1.0
            vector[index] += sign
        return vector

    @staticmethod
    def _cosine(left: list[float], right: list[float]) -> float:
        dot = sum(a * b for a, b in zip(left, right))
        left_norm = math.sqrt(sum(value * value for value in left))
        right_norm = math.sqrt(sum(value * value for value in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return max(0.0, dot / (left_norm * right_norm))

    def _graph_proximity(self, node_id: str, pinned_nodes: set[str]) -> float:
        if not pinned_nodes:
            return 0.0
        if node_id in pinned_nodes:
            return 1.0
        neighbors = {
            value for _, value in self._outgoing.get(node_id, [])
        } | {value for _, value in self._incoming.get(node_id, [])}
        return 0.7 if neighbors.intersection(pinned_nodes) else 0.0

    def _reference_ids(self, symbol: CodeSymbol) -> tuple[list[str], list[str]]:
        callers = [
            self._by_node[node]
            for _, node in self._incoming.get(symbol.node_id, [])
            if node in self._by_node
        ]
        callees = [
            self._by_node[node]
            for _, node in self._outgoing.get(symbol.node_id, [])
            if node in self._by_node
        ]
        return sorted(set(callers)), sorted(set(callees))

    def _resolve_symbol(self, value: str) -> CodeSymbol | None:
        if value in self._symbols:
            return self._symbols[value]
        mapped = self._by_chunk.get(value) or self._by_node.get(value)
        return self._symbols.get(mapped or "")

    def _read_file_lines(self, file_path: str) -> list[str] | None:
        if file_path in self._file_lines:
            return self._file_lines[file_path]
        path = self._source_path(file_path)
        if path is None:
            self._file_lines[file_path] = None
            return None
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            lines = None
        self._file_lines[file_path] = lines
        return lines

    def _source_path(self, file_path: str) -> Path | None:
        if self.workspace_path is None:
            return None
        candidate = (self.workspace_path / file_path).resolve(strict=False)
        root = self.workspace_path.resolve(strict=False)
        if candidate != root and root not in candidate.parents:
            return None
        return candidate if candidate.is_file() else None

    def _stable_symbol_id(self, file_path: str, symbol_ref: str) -> str:
        return f"sym://{quote(self.commit_sha, safe='')}/{quote(file_path, safe='/')}#{quote(symbol_ref, safe='.:$')}"

    def _stable_chunk_id(
        self,
        file_path: str,
        symbol_ref: str,
        start_line: int | None,
        end_line: int | None,
    ) -> str:
        return (
            f"chunk://{quote(self.commit_sha, safe='')}/{quote(file_path, safe='/')}#"
            f"{quote(symbol_ref, safe='.:$')}:{start_line or 0}-{end_line or 0}"
        )

    def _search_session_id(self, query: str, scopes: tuple[str, ...]) -> str:
        material = f"{self.commit_sha}\0{query}\0{'|'.join(scopes)}"
        return hashlib.sha256(material.encode("utf-8")).hexdigest()[:20]

    @staticmethod
    def _parse_search_cursor(cursor: str) -> tuple[str, int]:
        try:
            prefix, session_id, offset = str(cursor).split(":", 2)
            if prefix != "search":
                raise ValueError
            return session_id, max(0, int(offset))
        except (TypeError, ValueError) as error:
            raise ValueError("invalid search cursor") from error

    @staticmethod
    def _cursor_offset(cursor: str | None, *, prefix: str, default: int) -> int:
        if not cursor:
            return default
        try:
            value_prefix, offset = str(cursor).split(":", 1)
            if value_prefix != prefix:
                raise ValueError
            return max(0, int(offset))
        except (TypeError, ValueError) as error:
            raise ValueError(f"invalid {prefix} cursor") from error

    @staticmethod
    def _hierarchical_summary(
        symbols: list[CodeSymbol],
        kinds: Counter[str],
        semantic: list[str],
    ) -> str:
        if not symbols:
            return "No indexed semantic symbols."
        kind_text = ", ".join(f"{name}:{count}" for name, count in kinds.most_common(4))
        semantic_text = ", ".join(semantic[:6])
        if semantic_text:
            return f"{len(symbols)} symbols ({kind_text}); semantic roles: {semantic_text}."
        return f"{len(symbols)} symbols ({kind_text})."

    @staticmethod
    def _int_or_none(value: Any) -> int | None:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

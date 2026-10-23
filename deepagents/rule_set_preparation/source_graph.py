"""Bounded, pinned source retrieval. Structure is data; no legal semantics are inferred here."""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from typing import Any

from langchain_core.tools import tool
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from orchestration.agent_stream import publish_agent_stream_event

MAX_NODES = 20
MAX_CHARACTERS = 24000
GRAPH_TOOL_NAMES = frozenset({"search_legal_nodes", "get_legal_node", "inspect_legal_node", "follow_legal_reference"})
TRAVERSALS = ["PARENT", "CHILDREN", "SIBLINGS", "ANCESTORS", "REFERENCES", "REFERENCED_BY", "CHUNKS", "CONTEXT"]


class NodeArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str = Field(min_length=64, max_length=64)
    content_offset: int = Field(default=0, ge=0)
    max_characters: int = Field(default=8000, ge=1, le=MAX_CHARACTERS)


class SearchArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=MAX_NODES)
    offset: int = Field(default=0, ge=0)


class InspectArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str = Field(min_length=64, max_length=64)
    traversal: str = Field(json_schema_extra={"enum": TRAVERSALS})
    limit: int = Field(default=10, ge=1, le=MAX_NODES)
    offset: int = Field(default=0, ge=0)


class ReferenceArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference_id: str = Field(min_length=64, max_length=64)


class PinnedSourceGraph:
    def __init__(self, graph: dict[str, Any], chunks: list[dict[str, Any]]):
        self.graph = graph
        self.version = graph["legalSourceVersionId"]
        # Extracted but unreadable source material must remain visible to every
        # pinned-source consumer. It cannot be treated as an empty legal source.
        self.extraction_gaps = tuple(graph.get("extractionGaps") or ())
        document_ids = {node["documentId"] for node in graph["nodes"]}
        if any(
            not isinstance(gap, dict)
            or gap.get("documentId") not in document_ids
            or gap.get("kind") not in {"NO_TEXT_LAYER", "UNSUPPORTED_NUMBERING"}
            or (gap.get("page") is not None and (
                not isinstance(gap["page"], int) or gap["page"] < 1
            ))
            for gap in self.extraction_gaps
        ):
            raise ValueError("invalid pinned source extraction gap")
        self.nodes = {n["nodeId"]: n for n in graph["nodes"]}
        if not re.fullmatch(r"[a-f0-9]{64}", graph["materializationId"]) or any(not re.fullmatch(r"[a-f0-9]{64}", nid) for nid in self.nodes):
            raise ValueError("invalid structural identity")
        if any(n["legalSourceVersionId"] != self.version for n in self.nodes.values()):
            raise ValueError("source graph crosses pinned source versions")
        self.children: dict[str | None, list[str]] = defaultdict(list)
        self.forward: dict[str, list[dict]] = defaultdict(list)
        self.reverse: dict[str, list[dict]] = defaultdict(list)
        self.references = {r["referenceId"]: r for r in graph["references"]}
        self.chunks = {c["chunkId"]: c for c in chunks}
        self.chunk_ids: dict[str, list[str]] = defaultdict(list)
        self.units: dict[str, list[dict]] = defaultdict(list)
        for unit in graph.get("retrievalUnits", []):
            if unit["legalDocumentNodeId"] not in self.nodes:
                raise ValueError("retrieval unit leaves the pinned source graph")
            self.units[unit["legalDocumentNodeId"]].append(unit)
        self.postings: dict[str, dict[str, int]] = defaultdict(dict)
        self.lengths: dict[str, int] = {}
        for node in self.nodes.values():
            parent = node["parentNodeId"]
            if parent is not None and parent not in self.nodes:
                raise ValueError("source graph has an orphan parent")
            self.children[parent].append(node["nodeId"])
            tokens = re.findall(r"\w+", " ".join([node["content"], node["title"], node["structuralPath"]]).casefold())
            self.lengths[node["nodeId"]] = len(tokens)
            for token, count in Counter(tokens).items():
                self.postings[token][node["nodeId"]] = count
        for ids in self.children.values():
            ids.sort(key=lambda nid: (self.nodes[nid]["ordinal"], nid))
        for reference in graph["references"]:
            if reference["fromNodeId"] not in self.nodes or (reference["toNodeId"] is not None and reference["toNodeId"] not in self.nodes):
                raise ValueError("source graph reference leaves the pinned version")
            self.forward[reference["fromNodeId"]].append(reference)
            if reference["toNodeId"]:
                self.reverse[reference["toNodeId"]].append(reference)
        for mapping in graph["chunkMappings"]:
            if mapping["legalDocumentNodeId"] not in self.nodes or mapping["chunkId"] not in self.chunks:
                raise ValueError("source graph chunk mapping is invalid")
            self.chunk_ids[mapping["legalDocumentNodeId"]].append(mapping["chunkId"])
        self.average_length = sum(self.lengths.values()) / max(len(self.lengths), 1) or 1

    def base(self) -> dict:
        return {"legalSourceVersionId": self.version, "materializationId": self.graph["materializationId"]}

    def bounded_nodes(self, ids, *, limit=MAX_NODES, offset=0):
        unique = list(dict.fromkeys(ids))
        budget = MAX_CHARACTERS
        nodes = []
        for node_id in unique[offset:offset + limit]:
            node = self.nodes[node_id]
            content = node["content"][:budget]
            budget -= len(content)
            nodes.append({**node, "title": node["title"][:512], "content": content, "truncated": len(content) < len(node["content"])})
        return {**self.base(), "nodes": nodes, "total": len(unique), "offset": offset, "hasMore": offset + len(nodes) < len(unique)}

    def ancestors(self, node_id):
        seen = {node_id}
        ids = []
        parent = self.nodes[node_id]["parentNodeId"]
        while parent:
            if parent in seen:
                raise ValueError("cyclic source hierarchy")
            seen.add(parent)
            ids.append(parent)
            parent = self.nodes[parent]["parentNodeId"]
        return ids

    def search(self, query, limit, offset):
        # BM25 over source nodes. Existing vector/chunk retrieval can expand through chunkMappings.
        scores: dict[str, float] = defaultdict(float)
        total = len(self.nodes)
        for token in set(re.findall(r"\w+", query.casefold())):
            posting = self.postings.get(token, {})
            inverse = math.log(1 + (total - len(posting) + 0.5) / (len(posting) + 0.5))
            for node_id, frequency in posting.items():
                scores[node_id] += inverse * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * self.lengths[node_id] / self.average_length))
        ids = sorted(scores, key=lambda nid: (-scores[nid], nid))
        return self.bounded_nodes(ids, limit=limit, offset=offset)

    def inspect(self, node_id, traversal, limit, offset):
        if node_id not in self.nodes:
            return {**self.base(), "error": "NODE_NOT_IN_PINNED_SOURCE"}
        node = self.nodes[node_id]
        if traversal == "CHUNKS":
            ids = [cid for nid in [node_id, *self.ancestors(node_id)] for cid in self.chunk_ids.get(nid, [])]
            chunks = []
            budget = MAX_CHARACTERS
            for cid in ids[offset:offset + limit]:
                chunk = self.chunks[cid]
                content = chunk["content"][:budget]
                budget -= len(content)
                chunks.append({**chunk, "content": content, "truncated": len(content) < len(chunk["content"])})
            units = self.units.get(node_id, [])
            page = []
            for unit in units[offset:offset + limit]:
                content = unit["content"][:budget]
                budget -= len(content)
                page.append({**unit, "content": content, "truncated": len(content) < len(unit["content"])})
            return {**self.base(), "nodeId": node_id, "chunks": chunks, "retrievalUnits": page, "retrievalUnitCount": len(units),
                    "total": len(ids), "hasMore": offset + len(chunks) < len(ids) or offset + len(page) < len(units)}
        if traversal in {"REFERENCES", "REFERENCED_BY"}:
            refs = (self.forward if traversal == "REFERENCES" else self.reverse).get(node_id, [])
            page = refs[offset:offset + limit]
            ids = [r["toNodeId"] if traversal == "REFERENCES" else r["fromNodeId"] for r in page]
            return {**self.bounded_nodes([nid for nid in ids if nid], limit=limit), "references": page, "total": len(refs), "hasMore": offset + len(page) < len(refs)}
        if traversal == "PARENT":
            ids = [node["parentNodeId"]] if node["parentNodeId"] else []
        elif traversal == "CHILDREN":
            ids = self.children.get(node_id, [])
        elif traversal == "SIBLINGS":
            ids = [nid for nid in self.children.get(node["parentNodeId"], []) if nid != node_id]
        elif traversal == "ANCESTORS":
            ids = self.ancestors(node_id)
        elif traversal == "CONTEXT":
            ids = [node_id, *self.ancestors(node_id), *[r["toNodeId"] for r in self.forward.get(node_id, []) if r["toNodeId"]]]
        else:
            return {**self.base(), "error": "INVALID_STRUCTURAL_TRAVERSAL"}
        return self.bounded_nodes(ids, limit=limit, offset=offset)


def build_source_graph_tools(source: PinnedSourceGraph) -> list:
    def emit(kind, **fields):
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={"activity_kind": kind, **fields})

    @tool(args_schema=SearchArgs)
    def search_legal_nodes(query: str, limit: int = 10, offset: int = 0) -> str:
        """Search pinned legal nodes with BM25; return exact source identity and structural paths, bounded and paginated."""
        return json.dumps(source.search(query, limit, offset), ensure_ascii=False)

    @tool(args_schema=NodeArgs)
    def get_legal_node(node_id: str, content_offset: int = 0, max_characters: int = 8000) -> str:
        """Read an exact pinned node with its source/path/physical locator; request later content windows when truncated."""
        node = source.nodes.get(node_id)
        if node is None:
            return json.dumps({**source.base(), "error": "NODE_NOT_IN_PINNED_SOURCE"})
        content = node["content"][content_offset:content_offset + max_characters]
        emit("SOURCE_NODE_INSPECTED", source_node_id=node_id, structural_path=node["structuralPath"])
        return json.dumps({**source.base(), "node": {**node, "title": node["title"][:512], "content": content}, "contentOffset": content_offset,
                           "hasMore": content_offset + len(content) < len(node["content"])}, ensure_ascii=False)

    @tool(args_schema=InspectArgs)
    def inspect_legal_node(node_id: str, traversal: str, limit: int = 10, offset: int = 0) -> str:
        """Traverse PARENT, CHILDREN, SIBLINGS, ANCESTORS, REFERENCES, REFERENCED_BY, CHUNKS or bounded CONTEXT without re-searching text."""
        node = source.nodes.get(node_id)
        if node is not None and traversal in TRAVERSALS:
            emit("SOURCE_STRUCTURE_TRAVERSED", source_node_id=node_id, structural_path=node["structuralPath"], traversal=traversal)
        return json.dumps(source.inspect(node_id, traversal, limit, offset), ensure_ascii=False)

    @tool(args_schema=ReferenceArgs)
    def follow_legal_reference(reference_id: str) -> str:
        """Inspect/follow one explicit reference, retaining RESOLVED/AMBIGUOUS/UNRESOLVED state and candidates."""
        reference = source.references.get(reference_id)
        if reference is None:
            return json.dumps({**source.base(), "error": "REFERENCE_NOT_IN_PINNED_SOURCE"})
        target = reference["toNodeId"]
        emit("SOURCE_REFERENCE_FOLLOWED", reference_id=reference_id, from_node_id=reference["fromNodeId"], to_node_id=target,
             resolution_state=reference["resolutionState"])
        return json.dumps({**source.bounded_nodes([target] if target else reference["candidateNodeIds"]), "reference": reference}, ensure_ascii=False)

    def invalid_arguments(error: ValidationError) -> str:
        fields = "; ".join(
            f"{'.'.join(str(part) for part in item['loc'])}:{item['type']}"
            for item in error.errors(include_input=False, include_context=False)[:8]
        )
        return f"Source tool arguments rejected ({fields}). Correct the call to its declared schema."

    tools = [search_legal_nodes, get_legal_node, inspect_legal_node, follow_legal_reference]
    for source_tool in tools:
        source_tool.handle_validation_error = invalid_arguments
    return tools

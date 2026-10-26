"""Bounded, pinned source retrieval. Structure is data; no legal semantics are inferred here."""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from functools import cached_property, lru_cache
from typing import Any

from langchain_core.tools import tool
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from orchestration.agent_stream import publish_agent_stream_event

MAX_NODES = 20
MAX_CHARACTERS = 24000
GRAPH_TOOL_NAMES = frozenset({"list_legal_documents", "list_legal_structure", "resolve_legal_provision", "search_legal_nodes", "get_legal_node", "inspect_legal_node", "follow_legal_reference"})
TRAVERSALS = ["PARENT", "CHILDREN", "DESCENDANTS", "SIBLINGS", "ANCESTORS", "REFERENCES", "REFERENCED_BY", "CHUNKS", "CONTEXT"]


class StructureArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(min_length=1, max_length=500, description="Exact documentId or printed legal instrument identifier")
    parent_node_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    node_type: str | None = Field(default=None, description="Optional structural type, e.g. ARTICLE, CLAUSE, POINT, CHAPTER or ANNEX")
    limit: int = Field(default=20, ge=1, le=MAX_NODES)
    offset: int = Field(default=0, ge=0)


class ProvisionArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(min_length=1, max_length=500)
    locator: str = Field(min_length=1, max_length=500, description="Legal address: art-33, art-34::cl-2::pt-đ, chap-IV, or chapter/iv/article/41")


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
        self.reference_only_document_ids = frozenset(graph.get("referenceOnlyDocumentIds") or ())
        if not self.reference_only_document_ids.issubset(document_ids):
            raise ValueError("reference-only document leaves the pinned graph")
        self.nodes = {n["nodeId"]: n for n in graph["nodes"]}
        self.document_roots = [n for n in graph["nodes"] if n["nodeType"] == "DOCUMENT"]
        self.document_aliases = defaultdict(set)
        for node in self.document_roots:
            self.document_aliases[node["documentId"].casefold()].add(node["documentId"])
            for alias in re.findall(r"(?<!\w)\d+\s*/\s*(?:\d{4}\s*/\s*)?[^\W\d_][\w]*(?:[-–][\w]+)*", node["title"]):
                self.document_aliases[re.sub(r"\s", "", alias).casefold()].add(node["documentId"])
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
        self.search = lru_cache(maxsize=128)(self.search)
        self.review_node_ids = lru_cache(maxsize=1)(self.review_node_ids)
        self.reference_owners = lru_cache(maxsize=1)(self.reference_owners)

    @cached_property
    def file_index(self):
        """Printed addresses and file ownership are structural, never semantic classifications."""
        from rule_set_preparation.legal_source_files import safe_component
        prefixes = {"ARTICLE": "art", "CLAUSE": "cl", "POINT": "pt", "CHAPTER": "chap", "SECTION": "sec"}
        locators, locator_nodes, source_files, node_files = {}, {}, {}, {}
        file_articles = {}
        file_owners = {}
        def label(n):
            path = re.sub(r"/occurrence/\d+$", "", n["structuralPath"]).strip("/").split("/")
            if len(path) > 1 and path[-2].upper() == n["nodeType"]:
                return path[-1]
            prefix = prefixes.get(n["nodeType"], n["nodeType"].lower()) + "-"
            return path[-1].removeprefix(prefix) if path[-1].startswith(prefix) else str(n["label"])
        def component(n):
            value = n["nodeType"].lower() + "-" + label(n)
            occurrence = re.search(r"/occurrence/(\d+)$", n["structuralPath"])
            return safe_component(value + ("-occurrence-" + occurrence[1] if occurrence else ""))
        article_counts = Counter((n["documentId"], component(n)) for n in self.nodes.values() if n["nodeType"] == "ARTICLE")
        for node in self.nodes.values():
            lineage = [self.nodes[nid] for nid in reversed(self.ancestors(node["nodeId"]))] + [node]
            article_index = next((i for i, n in enumerate(lineage) if n["nodeType"] == "ARTICLE"), None)
            article = lineage[article_index] if article_index is not None else None
            # Repeated Article numbers retain their pinned ancestors instead of inventing occurrence ids.
            qualified = article is not None and article_counts[article["documentId"], component(article)] > 1
            address = lineage[article_index:] if article is not None and not qualified else (lineage[1:] if lineage[0]["nodeType"] == "DOCUMENT" else lineage)
            parts = []
            for n in address:
                part = prefixes.get(n["nodeType"], n["nodeType"].lower()) + "-" + label(n)
                occurrence = re.search(r"/occurrence/(\d+)$", n["structuralPath"])
                parts.append(part + ("/occurrence/" + occurrence[1] if occurrence else ""))
            locator = "::".join(parts) or "preamble"
            key = (node["documentId"], locator)
            if key in locator_nodes:
                raise ValueError("Non-unique printed structural locator: " + locator)
            locators[node["nodeId"]] = locator
            locator_nodes[key] = node["nodeId"]
            group = (lineage[article_index] if article_index is not None else
                     next((n for n in lineage if n["nodeType"] in {"ANNEX", "TABLE", "SCHEDULE"}), node))
            ancestors = [self.nodes[nid] for nid in reversed(self.ancestors(group["nodeId"])) if self.nodes[nid]["nodeType"] != "DOCUMENT"]
            directory = "/".join([safe_component(node["documentId"]), *[component(n) for n in ancestors]])
            name = "preamble" if group["nodeType"] == "DOCUMENT" else ("dieu-" if group["nodeType"] == "ARTICLE" else group["nodeType"].lower() + "-") + label(group)
            occurrence = re.search(r"/occurrence/(\d+)$", group["structuralPath"])
            if occurrence:
                name += "-occurrence-" + occurrence[1]
            path = f"/legal-source/{directory}/{safe_component(name)}.md"
            if path in file_owners and file_owners[path] != group["nodeId"]:
                raise ValueError("Source file path collision: " + path)
            file_owners[path] = group["nodeId"]
            source_files.setdefault(path, []).append(node["nodeId"])
            node_files[node["nodeId"]] = path
        file_articles = {path: locators[nid] for path, nid in file_owners.items()}
        for ids in source_files.values():
            ids.sort(key=lambda nid: (self.nodes[nid]["ordinal"], self.nodes[nid]["structuralPath"]))

        return {"locators": locators, "locator_nodes": locator_nodes, "source_files": source_files, "node_files": node_files, "file_articles": file_articles}

    @property
    def locators(self):
        return self.file_index["locators"]

    @property
    def locator_nodes(self):
        return self.file_index["locator_nodes"]

    @cached_property
    def source_files(self):
        return {path: ids for path, ids in self.all_source_files.items()
                if self.nodes[ids[0]]["documentId"] not in self.reference_only_document_ids}

    @property
    def all_source_files(self):
        return self.file_index["source_files"]

    def is_reference_only(self, node_id):
        return self.nodes.get(node_id, {}).get("documentId") in self.reference_only_document_ids

    @property
    def node_files(self):
        return self.file_index["node_files"]

    @property
    def file_articles(self):
        return self.file_index["file_articles"]

    def resolve_locator(self, document_id, locator):
        """Exact lookup, including occurrence/N; never return a truncated source body."""
        return self.locator_nodes.get((document_id, locator))

    def review_node_ids(self):
        if getattr(self, "_review_ids", None) is None:
            self._review_ids = self._compute_review_node_ids()
        return self._review_ids

    def _compute_review_node_ids(self):
        # Match sourceReviewUnits' heading-only exclusion; the API's total is checked before adoption.
        words = {"ARTICLE": "article|điều", "CLAUSE": "clause|khoản", "POINT": "point|điểm",
                 "CHAPTER": "chapter|chương", "SECTION": "section|mục|§", "PART": "part|phần",
                 "ANNEX": "annex|phụ lục", "PARAGRAPH": "paragraph", "TABLE": "table|bảng",
                 "TITLE": "title", "SCHEDULE": "schedule", "SUBCHAPTER": "subchapter",
                 "SUBSECTION": "subsection", "SUBPARAGRAPH": "subparagraph", "ITEM": "item"}
        result = set()
        for nid, node in self.nodes.items():
            if self.is_reference_only(nid):
                continue
            lines = [line.strip() for line in node["content"].strip().splitlines() if line.strip()]
            if not lines:
                continue
            heading = False
            if len(lines) == 1 and self.children.get(nid) and node["nodeType"] in words and node["nodeType"] != "ARTICLE":
                match = re.fullmatch(r"(?:" + words[node["nodeType"]] + r")\s*\(?" + re.escape(str(node["label"])) + r"\)?(?:\s*[.:-](?:\s+|$)|\s*[—–]\s*|\s*$)(.*)", re.sub(r"^#{1,6}\s+", "", lines[0]), re.I)
                heading = bool(match and match[1].strip() == node["title"].strip())
            if not heading:
                result.add(nid)
        return result

    def reference_owners(self):
        """Match reviewReferenceOwners: a heading's edge belongs to its first reviewable descendant."""
        units = self.review_node_ids()
        def owner(nid):
            if self.is_reference_only(nid):
                return None
            if nid in units:
                return nid
            return next((found for child in self.children.get(nid, []) if (found := owner(child))), None)
        return {rid: owner(ref["fromNodeId"]) for rid, ref in self.references.items()}

    def base(self) -> dict:
        return {"legalSourceVersionId": self.version, "materializationId": self.graph["materializationId"]}

    def _match_documents(self, document_id: str | None) -> set[str] | None:
        if not document_id:
            return None
        target = document_id.casefold().strip()
        matched = set()
        if target in self.document_aliases:
            matched.update(self.document_aliases[target])
        for alias in re.findall(r"(?<!\w)\d+\s*/\s*(?:\d{4}\s*/\s*)?[^\W\d_][\w]*(?:[-–][\w]+)*", target):
            cleaned = re.sub(r"\s", "", alias).casefold()
            if cleaned in self.document_aliases:
                matched.update(self.document_aliases[cleaned])
        if not matched:
            for node in self.document_roots:
                if node["documentId"].casefold() == target or target in node["title"].casefold():
                    matched.add(node["documentId"])
        return matched

    def structure(self, document_id=None, parent_node_id=None, node_type=None, limit=MAX_NODES, offset=0):
        documents = self._match_documents(document_id)
        nodes = self.document_roots if documents is None and not parent_node_id else [
            n for n in self.nodes.values()
            if (documents is None or n["documentId"] in documents)
            and (n["parentNodeId"] == parent_node_id if parent_node_id else True)
            and (not node_type or n["nodeType"] == node_type)
        ]
        nodes = sorted(nodes, key=lambda n: (n["documentId"], n["structuralPath"], n["ordinal"]))
        return {**self.base(), "nodes": [{k: v for k, v in n.items() if k != "content"} for n in nodes[offset:offset + limit]],
                "total": len(nodes), "offset": offset, "hasMore": offset + limit < len(nodes)}

    def resolve(self, document_id, locator):
        exact = self.resolve_locator(document_id, locator)
        if exact:
            return {**self.bounded_nodes([exact]), "resolutionState": "RESOLVED"}
        aliases = {
            "art": "article", "article": "article", "điều": "article",
            "cl": "clause", "clause": "clause", "khoản": "clause", "paragraph": "clause",
            "pt": "point", "point": "point", "điểm": "point",
            "chap": "chapter", "chapter": "chapter", "chương": "chapter",
            "sec": "section", "section": "section", "mục": "section",
            "annex": "annex", "phụ lục": "annex",
            "part": "part", "phần": "part",
            "table": "table", "bảng": "table",
        }
        locator = locator.casefold().strip("/")
        pattern = r"^(art|cl|pt|chap|sec|annex|part|table|article|điều|clause|khoản|paragraph|point|điểm|chapter|chương|section|mục)[-\s]([\w.-]+)"
        if "::" in locator or re.match(pattern, locator):
            segments = [re.fullmatch(pattern, part.strip()) for part in locator.split("::")]
            if not all(segments):
                return {**self.base(), "error": "INVALID_STRUCTURAL_LOCATOR"}
            suffix = "".join(f"/{aliases.get(m[1], m[1])}/{m[2]}" for m in segments)
        else:
            suffix = "/" + locator
        documents = self._match_documents(document_id)
        ids = [n["nodeId"] for n in self.nodes.values() if (documents is None or n["documentId"] in documents) and n["structuralPath"].casefold().endswith(suffix)]
        return {**self.bounded_nodes(ids), "resolutionState": "RESOLVED" if len(ids) == 1 else "AMBIGUOUS" if ids else "UNRESOLVED"}

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
        elif traversal == "DESCENDANTS":
            ids = [n["nodeId"] for n in self.nodes.values() if n["documentId"] == node["documentId"] and n["structuralPath"].startswith(node["structuralPath"] + "/")]
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

    @tool
    def list_legal_documents(offset: int = 0, limit: int = 20) -> str:
        """List pinned documents and their exact identifiers, without source bodies or a global node index."""
        return json.dumps(source.structure(limit=max(1, min(limit, MAX_NODES)), offset=max(0, offset)), ensure_ascii=False)

    @tool(args_schema=StructureArgs)
    def list_legal_structure(document_id: str, parent_node_id: str | None = None, node_type: str | None = None, limit: int = 20, offset: int = 0) -> str:
        """List a document's structure or a parent's children; filter ARTICLE, CLAUSE, POINT, CHAPTER, ANNEX or TABLE. Metadata only, paginated."""
        return json.dumps(source.structure(document_id, parent_node_id, node_type, limit, offset), ensure_ascii=False)

    @tool(args_schema=ProvisionArgs)
    def resolve_legal_provision(document_id: str, locator: str) -> str:
        """Read by printed document identifier and exact legal locator. Returns explicit ambiguity; never guesses between repeated labels."""
        return json.dumps(source.resolve(document_id, locator), ensure_ascii=False)

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

    tools = [list_legal_documents, list_legal_structure, resolve_legal_provision, search_legal_nodes, get_legal_node, inspect_legal_node, follow_legal_reference]
    for source_tool in tools:
        source_tool.handle_validation_error = invalid_arguments
    return tools

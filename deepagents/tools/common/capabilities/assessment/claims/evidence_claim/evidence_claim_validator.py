"""Fail closed when an LLM claim is not backed by material immutable provenance."""
from __future__ import annotations

import hashlib
import json
import re
import shlex
from dataclasses import replace
from pathlib import Path, PurePosixPath
from typing import Any

from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.schema.source_roles import (
    SOURCE_ROLE_PRODUCTION,
    SOURCE_ROLE_TEST,
    source_role,
)

from tools.common.capabilities.assessment.claims.evidence_claim.claim_topology import (
    ClaimTopologyValidationError,
    topology_criterion_kind,
    validate_claim_topology,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import ENGINEERING_EVIDENCE_CLAIM_TYPES, EvidenceClaim
from tools.common.capabilities.assessment.rule_assessment.absence_policy import (
    absence_may_finalize,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ASSESSMENT_VALIDATOR_ID,
    RULE_EVIDENCE_KINDS,
)


class EvidenceClaimValidationError(ValueError):
    pass


_MAX_CLAIM_PROVENANCE_REFS = 8
_DIRECT_SOURCE_SUFFIXES = frozenset(
    {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".go",
        ".java",
        ".kt",
        ".rs",
        ".cs",
        ".rb",
        ".php",
        ".swift",
        ".dart",
        ".sh",
        ".sql",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".tf",
        ".html",
        ".vue",
        ".svelte",
    }
)
_TOKEN = re.compile(r"[A-Za-zÀ-ỹ0-9]+", re.UNICODE)
_GENERIC_CRITERION_TOKENS = frozenset(
    {
        "ai",
        "system",
        "systems",
        "technical",
        "engineering",
        "requirement",
        "requirements",
        "evidence",
        "control",
        "controls",
        "data",
        "risk",
        "risks",
        "process",
        "management",
        "implementation",
        "implemented",
        "exists",
        "exist",
        "present",
        "documented",
        "ensure",
        "ensures",
        "must",
        "shall",
        "output",
        "surface",
        "with",
        "from",
        "that",
        "this",
        "the",
        "and",
        "for",
    }
)

# Certain governed requiredEvidence labels intentionally use stable business-neutral
# names while production code commonly uses protocol/library vocabulary instead. Map
# only those criteria to concrete implementation terms so valid C2PA/watermark/notice
# evidence can rank, while generic LLM token/accounting nodes cannot satisfy a
# transparency control merely because their label contains "output", "response", or
# an internal metadata field.
_CRITERION_EVIDENCE_TOKENS: dict[str, frozenset[str]] = {
    "AI_OUTPUT_SURFACE": frozenset(
        {
            "http",
            "notification",
            "publication",
            "publish",
            "storage",
            "stream",
            "websocket",
            "endpoint",
            "route",
            "download",
            "export",
            "render",
        }
    ),
    "DIRECT_AI_INTERACTION_SURFACE": frozenset(
        {
            "chatbot",
            "assistant",
            "bot",
            "chat",
            "conversation",
            "message",
            "reply",
        }
    ),
    "AI_INTERACTION_DISCLOSURE_CONTROL": frozenset(
        {"disclosure", "disclose", "notice", "label", "banner", "badge", "powered"}
    ),
    "AI_MEDIA_OUTPUT_SURFACE": frozenset(
        {
            "image",
            "audio",
            "video",
            "media",
            "frame",
            "codec",
            "mime",
            "render",
            "thumbnail",
        }
    ),
    "MACHINE_READABLE_MARK_CONTROL": frozenset(
        {
            "machine",
            "readable",
            "mark",
            "watermark",
            "provenance",
            "c2pa",
            "manifest",
            "xmp",
            "iptc",
            "exif",
            "credential",
            "credentials",
        }
    ),
    "PUBLIC_AI_CONTENT_SURFACE": frozenset(
        {"public", "publish", "publication", "post", "feed", "article", "broadcast", "share"}
    ),
    "PUBLIC_AI_CONTENT_NOTICE_CONTROL": frozenset(
        {"notice", "disclosure", "label", "badge", "banner"}
    ),
    "DEEPFAKE_OR_SIMULATED_MEDIA_SURFACE": frozenset(
        {
            "deepfake",
            "faceswap",
            "face",
            "swap",
            "voice",
            "clone",
            "cloning",
            "lipsync",
            "simulated",
            "synthetic",
            "impersonation",
        }
    ),
    "VISIBLE_DEEPFAKE_LABEL_CONTROL": frozenset(
        {"visible", "label", "overlay", "badge", "banner", "caption", "notice", "watermark"}
    ),
    "TRANSPARENCY_CONTROL_PRESENT": frozenset(
        {
            "disclosure",
            "notice",
            "label",
            "watermark",
            "provenance",
            "c2pa",
            "badge",
            "banner",
        }
    ),
    "TRANSPARENCY_CONTROL_CONTINUITY": frozenset(
        {
            "preserve",
            "preserved",
            "retain",
            "retained",
            "strip",
            "transcode",
            "export",
            "copy",
            "watermark",
            "provenance",
        }
    ),
    "ARTICLE_11_TRANSPARENCY_CONTROL": frozenset(
        {
            "disclosure",
            "notice",
            "label",
            "watermark",
            "provenance",
            "c2pa",
            "badge",
            "banner",
        }
    ),
}

_MATERIAL_RESOURCE_NODE_TYPES = frozenset(
    {
        "PACKAGE_DEPENDENCY",
        "EXTERNAL_SERVICE",
        "EXTERNAL_API",
        "DATABASE",
        "TABLE",
        "QUEUE",
        "AI_PROVIDER",
        "DATA_CATEGORY",
        "PERSONAL_DATA",
        "SENSITIVE_DATA",
    }
)
_CLOSED_CLAIM_TYPES = frozenset(
    {
        ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
        ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"],
    }
)


def normalize_source_path(value: Any) -> str:
    """Repository-relative POSIX path, or a validation error when it escapes the source."""
    path = str(value or "").replace("\\", "/").lstrip("/")
    parts = [part for part in path.split("/") if part not in {"", "."}]
    if (
        not parts
        or any(part == ".." for part in parts)
        or parts[0] in {".git", ".lcsp"}
    ):
        raise EvidenceClaimValidationError(
            "source location must remain inside customer repository source"
        )
    return "/".join(parts)


_DOCUMENTATION_SUFFIXES = frozenset({".md", ".markdown", ".rst", ".txt", ".adoc"})
_DOCUMENTATION_STEMS = ("README", "CHANGELOG", "LICENSE", "NOTICE", "CONTRIBUTING")


def is_implementation_evidence_path(value: Any) -> bool:
    """Production source that can close a criterion.

    Test/spec/script/example/generated files are excluded, and so is prose documentation:
    a README describes behaviour, it does not implement it. Configuration stays admissible.
    """
    path = PurePosixPath(normalize_source_path(value))
    return (
        source_role(str(path)) == SOURCE_ROLE_PRODUCTION
        and path.suffix.lower() not in _DOCUMENTATION_SUFFIXES
        and not path.name.upper().startswith(_DOCUMENTATION_STEMS)
    )


def verify_repository_source(
    path: str,
    start: int,
    end: int,
    repository_root: str | Path | None = None,
    *,
    required: bool = False,
) -> None:
    """Verify a citation against the live assessment repository when available.

    ``required=True`` (the governed rule-assessment boundary) fails closed when neither a
    sandbox backend nor a repository root is available.

    The sandbox backend is authoritative; ``repository_root`` is the on-disk fallback for
    runs that have a hydrated checkout but no sandbox backend bound.
    """
    from tools.common.capabilities.platform.repository_sandbox import (
        current_repository_backend,
    )

    backend = current_repository_backend()
    if backend is not None:
        responses = backend.download_files([f"/{path}"])
        content = None if not responses or responses[0].error else responses[0].content
    elif repository_root:
        root = Path(repository_root).resolve()
        target = (root / path).resolve()
        content = target.read_bytes() if target.is_relative_to(root) and target.is_file() else None
    elif required:
        raise EvidenceClaimValidationError(
            "no repository database is available to verify source locations"
        )
    else:
        # Deterministic unit/offline flows still validate against pinned graph anchors.
        return
    if content is None:
        raise EvidenceClaimValidationError(
            f"source location does not exist in repository database: {path}"
        )
    try:
        line_count = len(content.decode("utf-8").splitlines())
    except UnicodeDecodeError as error:
        raise EvidenceClaimValidationError(
            f"source location is not UTF-8 source text: {path}"
        ) from error
    if start > max(1, line_count) or end > max(1, line_count):
        raise EvidenceClaimValidationError(
            f"source location exceeds repository file bounds: {path}:{start}-{end}"
        )


class EvidenceClaimValidator:
    """Validate and minimize claim provenance against persisted graph identities.

    LLM observations may contain broad search pages. A closed EngineeringRule claim is
    allowed to retain only a small, criterion-ranked set of production/material refs.
    Test/spec/script/example evidence cannot close MET/NOT_MET, and test-only refs from
    older graph artifacts are removed even when the graph itself predates test filtering.
    Path-oriented criteria additionally require their supplied graph refs to prove the
    asserted topology rather than merely naming individually valid nodes.
    """

    def validate_governed(
        self,
        claim: EvidenceClaim,
        *,
        assessment_id: str,
        commit_sha: str,
    ) -> EvidenceClaim:
        """Validate a claim minted from an already-verified rule assessment (no graph).

        Accepts NOT_MET only as positive violation evidence (``evidence_kind``).
        ``source_verified`` is set only by the rule-assessment boundary after the live
        source check, so provenance is the verified ``source_locations`` themselves.
        """
        if claim.absence_scan is not None:
            return self._validate_absence_claim(claim)
        if not 0 <= claim.confidence <= 1:
            raise EvidenceClaimValidationError("claim confidence out of range")
        if claim.claim_type != ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]:
            # ``source_verified`` alone is not trusted: the runtime-stamped provenance must
            # bind every source location to this assessment, commit, rule and criterion.
            provenance = claim.evidence_provenance
            if not assessment_id or not commit_sha or not provenance or any(
                p.get("validator") != RULE_ASSESSMENT_VALIDATOR_ID
                or p.get("assessmentId") != assessment_id
                or p.get("repositoryVersion") != commit_sha
                or p.get("engineeringRuleId") != claim.engineering_rule_id
                or p.get("criterionId") != claim.criterion
                for p in provenance
            ):
                raise EvidenceClaimValidationError(
                    "evidence provenance does not bind to this assessment, commit, rule and criterion"
                )
        if claim.claim_type != ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"] and any(
            not is_implementation_evidence_path(location.get("path") or "")
            for location in claim.source_locations
        ):
            raise EvidenceClaimValidationError(
                "test/spec/script/example/generated/documentation evidence cannot close MET/NOT_MET"
            )
        if claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]:
            # Positive violation evidence only: verified source showing contradicting
            # behaviour. Absence is rejected above and never reaches here.
            if not (
                claim.source_verified
                and claim.criterion
                and claim.value is False
                and claim.confidence > 0
                and claim.source_locations
                and claim.evidence_kind == RULE_EVIDENCE_KINDS["demonstratesViolation"]
            ):
                raise EvidenceClaimValidationError(
                    "NOT_MET requires verified source locations marked DEMONSTRATES_VIOLATION"
                )
            return claim
        if claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]:
            if not (claim.source_verified and claim.criterion and claim.value is True):
                raise EvidenceClaimValidationError(
                    "closed engineering claim requires verified source evidence for a criterion"
                )
            if not (claim.source_locations or claim.evidence_refs):
                raise EvidenceClaimValidationError(
                    "closed engineering claim requires source evidence"
                )
            return claim
        if claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]:
            if claim.value is not None or not claim.limitations:
                raise EvidenceClaimValidationError(
                    "unresolved claim requires no value and at least one limitation"
                )
            return claim
        raise EvidenceClaimValidationError("unsupported governed claim type")

    def validate(
        self,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph | dict,
    ) -> EvidenceClaim:
        if claim.absence_scan is not None:
            # A search manifest, not graph provenance: nothing here resolves in the graph.
            return self._validate_absence_claim(claim)
        value = (
            graph
            if isinstance(graph, ProgramEvidenceGraph)
            else ProgramEvidenceGraph.from_dict(graph)
        )
        claim = self._resolve_source_locations(claim, value)
        anchors = {str(anchor["anchor_id"]) for anchor in value.source_anchors}
        nodes = {str(node["node_id"]) for node in value.nodes}
        edges = {str(edge["edge_id"]) for edge in value.edges}
        known = set(value.evidence_refs) | anchors | nodes | edges

        supplied_refs = {
            *claim.evidence_refs,
            *claim.graph_path_refs,
            *claim.source_anchor_refs,
        }
        if not 0 <= claim.confidence <= 1:
            raise EvidenceClaimValidationError("claim confidence out of range")
        if claim.claim_type in _CLOSED_CLAIM_TYPES and not claim.criterion:
            raise EvidenceClaimValidationError(
                "closed engineering claim requires a requiredEvidence criterion"
            )
        if claim.claim_type in _CLOSED_CLAIM_TYPES and claim.confidence <= 0:
            raise EvidenceClaimValidationError(
                "zero-confidence engineering claim cannot close a criterion"
            )
        if not supplied_refs:
            if (
                claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                and claim.value is None
                and claim.confidence == 0
                and claim.limitations
            ):
                return claim
            if (
                claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]
                and claim.value is True
                and claim.source_locations
                and not topology_criterion_kind(claim.criterion)
            ):
                self._validate_direct_source_claim(claim, value)
                return replace(claim, source_verified=True)
            raise EvidenceClaimValidationError(
                "claim source locations did not resolve to governed repository provenance"
            )

        missing = [ref for ref in claim.evidence_refs if ref not in known]
        if missing:
            raise EvidenceClaimValidationError(f"unknown evidence refs: {missing}")

        missing_anchors = set(claim.source_anchor_refs) - anchors
        if missing_anchors:
            raise EvidenceClaimValidationError(
                f"source anchor does not resolve: {sorted(missing_anchors)}"
            )

        unknown_paths = [ref for ref in claim.graph_path_refs if ref not in known]
        if unknown_paths:
            raise EvidenceClaimValidationError(
                f"graph path ref does not resolve: {unknown_paths}"
            )

        if claim.claim_type in _CLOSED_CLAIM_TYPES:
            try:
                validate_claim_topology(
                    criterion=claim.criterion,
                    graph_path_refs=claim.graph_path_refs,
                    graph=value,
                    claim_value=claim.value,
                )
            except ClaimTopologyValidationError as error:
                raise EvidenceClaimValidationError(str(error)) from error

        selected = self._criterion_scoped_material_refs(claim, value)
        if claim.claim_type in _CLOSED_CLAIM_TYPES and not any(selected.values()):
            raise EvidenceClaimValidationError(
                "closed engineering claim requires criterion-aligned material production evidence"
            )

        return replace(
            claim,
            evidence_refs=selected["evidence"],
            graph_path_refs=selected["graph"],
            source_anchor_refs=selected["anchor"],
        )

    @staticmethod
    def _validate_absence_claim(claim: EvidenceClaim) -> EvidenceClaim:
        """Absence never finalizes a rule: FINAL_ABSENCE is disabled (see absence_policy)."""
        if not absence_may_finalize(claim.absence_scan):
            raise EvidenceClaimValidationError(
                "absence cannot be finalised from a deterministic keyword scan"
            )
        raise EvidenceClaimValidationError("absence claims are not accepted")

    def _resolve_source_locations(
        cls,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph,
    ) -> EvidenceClaim:
        """Resolve direct repo citations internally; models never need graph IDs."""
        if not claim.source_locations:
            return claim

        normalized: list[dict[str, Any]] = []
        anchors: set[str] = set(claim.source_anchor_refs)
        evidence: set[str] = set(claim.evidence_refs)
        seed_nodes: set[str] = set()

        anchor_rows = [
            row
            for row in graph.source_anchors
            if isinstance(row, dict) and row.get("file_path")
        ]
        node_by_id = {
            str(node.get("node_id")): node
            for node in graph.nodes
            if isinstance(node, dict) and node.get("node_id")
        }

        for raw in claim.source_locations:
            if not isinstance(raw, dict):
                raise EvidenceClaimValidationError("source location must be an object")
            path = normalize_source_path(raw.get("path") or raw.get("file_path"))
            try:
                start = int(raw.get("start_line") or raw.get("startLine"))
                end = int(raw.get("end_line") or raw.get("endLine"))
            except (TypeError, ValueError) as error:
                raise EvidenceClaimValidationError(
                    "source location requires integer start/end lines"
                ) from error
            if start < 1 or end < start:
                raise EvidenceClaimValidationError("source location line range is invalid")
            symbol = str(raw.get("symbol") or raw.get("symbol_ref") or "").strip() or None
            verify_repository_source(path, start, end)
            normalized.append(
                {
                    "path": path,
                    "start_line": start,
                    "end_line": end,
                    **({"symbol": symbol} if symbol else {}),
                }
            )

            matched = False
            for anchor in anchor_rows:
                if normalize_source_path(anchor.get("file_path")) != path:
                    continue
                if symbol and anchor.get("symbol_ref") and str(anchor.get("symbol_ref")) != symbol:
                    continue
                if not cls._ranges_overlap(
                    start,
                    end,
                    anchor.get("start_line"),
                    anchor.get("end_line"),
                ):
                    continue
                matched = True
                anchor_id = str(anchor.get("anchor_id") or "")
                node_id = str(anchor.get("graph_node_id") or "")
                if anchor_id:
                    anchors.add(anchor_id)
                if node_id:
                    seed_nodes.add(node_id)
                    node = node_by_id.get(node_id)
                    if node:
                        evidence.update(str(ref) for ref in node.get("evidence_refs") or [] if str(ref))

            # Historical graphs can contain node source locations without a materialized
            # source-anchor row. Preserve deterministic compatibility without exposing
            # node IDs to the model.
            if not matched:
                for node_id, node in node_by_id.items():
                    source = node.get("source")
                    if not isinstance(source, dict):
                        continue
                    if normalize_source_path(
                        source.get("file_path") or source.get("filePath")
                    ) != path:
                        continue
                    if not cls._ranges_overlap(
                        start,
                        end,
                        source.get("start_line") or source.get("startLine"),
                        source.get("end_line") or source.get("endLine"),
                    ):
                        continue
                    seed_nodes.add(node_id)
                    evidence.update(str(ref) for ref in node.get("evidence_refs") or [] if str(ref))

        graph_refs = set(claim.graph_path_refs)
        if topology_criterion_kind(claim.criterion) and seed_nodes:
            graph_refs.update(cls._bounded_graph_refs(graph, seed_nodes))

        return replace(
            claim,
            evidence_refs=tuple(sorted(evidence)),
            graph_path_refs=tuple(sorted(graph_refs)),
            source_anchor_refs=tuple(sorted(anchors)),
            source_locations=tuple(normalized),
        )

    @staticmethod
    def _ranges_overlap(
        start: int,
        end: int,
        other_start: Any,
        other_end: Any,
    ) -> bool:
        try:
            left = int(other_start) if other_start is not None else 1
            right = int(other_end) if other_end is not None else left
        except (TypeError, ValueError):
            return True
        return not (end < left or start > right)

    @classmethod
    def _validate_direct_source_claim(
        cls,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph,
    ) -> None:
        """Accept positive source evidence only from the pinned, unchanged baseline."""
        from tools.common.capabilities.platform.repository_sandbox import (
            current_repository_backend,
        )

        backend = current_repository_backend()
        scan_job_id = graph.provenance.get("scan_job_id")
        if backend is None or not graph.snapshot_id or not scan_job_id:
            raise EvidenceClaimValidationError(
                "direct source evidence requires the pinned assessment repository"
            )
        marker = backend.download_files(["/.lcsp/repository.json"])
        try:
            metadata = json.loads(marker[0].content.decode("utf-8"))
        except (
            IndexError,
            AttributeError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as error:
            raise EvidenceClaimValidationError(
                "assessment repository pin could not be verified"
            ) from error
        if not isinstance(metadata, dict) or (
            metadata.get("snapshotId") != graph.snapshot_id
            or metadata.get("scanJobId") != scan_job_id
            or metadata.get("commitSha") != graph.commit_sha
        ):
            raise EvidenceClaimValidationError(
                "assessment repository does not match the pinned evidence graph"
            )
        if not claim.criterion or len(claim.source_locations) > _MAX_CLAIM_PROVENANCE_REFS:
            raise EvidenceClaimValidationError(
                "direct source claim requires a bounded criterion and source set"
            )

        criterion_name = claim.criterion.strip().upper()
        derived = cls._tokens(claim.criterion) - _GENERIC_CRITERION_TOKENS
        criterion_tokens = set(
            _CRITERION_EVIDENCE_TOKENS.get(criterion_name, frozenset(derived))
        )
        if not criterion_tokens:
            raise EvidenceClaimValidationError(
                "direct source claim has no material criterion terms"
            )

        relevant = False
        for location in claim.source_locations:
            path = normalize_source_path(location.get("path"))
            start = int(location["start_line"])
            end = int(location["end_line"])
            source_path = PurePosixPath(path)
            if (
                source_role(path) != SOURCE_ROLE_PRODUCTION
                or (
                    source_path.suffix.lower() not in _DIRECT_SOURCE_SUFFIXES
                    and source_path.name not in {"Dockerfile", "Containerfile"}
                )
                or end - start >= 80
            ):
                raise EvidenceClaimValidationError(
                    "direct source evidence must cite bounded production code"
                )
            baseline = backend.execute(
                f"git rev-parse --verify {shlex.quote('HEAD:' + path)}"
            )
            baseline_hash = str(getattr(baseline, "output", "") or "").strip()
            response = backend.download_files([f"/{path}"])
            if not response or response[0].error or response[0].content is None:
                raise EvidenceClaimValidationError("direct source citation is unavailable")
            content = response[0].content
            header = f"blob {len(content)}\0".encode("ascii")
            digest = (
                hashlib.sha1(header + content).hexdigest()
                if len(baseline_hash) == 40
                else hashlib.sha256(header + content).hexdigest()
            )
            if (
                getattr(baseline, "exit_code", 1) != 0
                or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", baseline_hash)
                or digest != baseline_hash
            ):
                raise EvidenceClaimValidationError(
                    "direct source citation differs from pinned repository baseline"
                )
            lines = content.decode("utf-8").splitlines()
            excerpt = "\n".join(lines[start - 1 : end])
            material_lines = [
                line
                for line in excerpt.splitlines()
                if line.strip()
                and not line.lstrip().startswith(("#", "//", "/*", "*", "--"))
            ]
            if material_lines and criterion_tokens.intersection(
                cls._tokens("\n".join(material_lines))
            ):
                relevant = True
        if not relevant:
            raise EvidenceClaimValidationError(
                "direct source claim requires criterion-aligned source content"
            )

    @staticmethod
    def _bounded_graph_refs(
        graph: ProgramEvidenceGraph,
        seed_nodes: set[str],
        *,
        max_depth: int = 8,
        max_edges: int = 100,
    ) -> set[str]:
        """Derive legacy topology refs internally from source-cited graph nodes."""
        edges = [
            edge
            for edge in graph.edges
            if isinstance(edge, dict)
            and edge.get("edge_id")
            and edge.get("source_node_id")
            and edge.get("target_node_id")
        ]
        frontier = set(seed_nodes)
        visited = set(seed_nodes)
        refs: set[str] = set()
        for _ in range(max_depth):
            if not frontier or len(refs) >= max_edges:
                break
            next_frontier: set[str] = set()
            for edge in edges:
                source = str(edge.get("source_node_id"))
                target = str(edge.get("target_node_id"))
                if source not in frontier and target not in frontier:
                    continue
                refs.add(str(edge.get("edge_id")))
                if len(refs) >= max_edges:
                    break
                if source not in visited:
                    next_frontier.add(source)
                if target not in visited:
                    next_frontier.add(target)
            visited.update(next_frontier)
            frontier = next_frontier
        return refs


    @classmethod
    def _criterion_scoped_material_refs(
        cls,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph,
    ) -> dict[str, tuple[str, ...]]:
        node_by_id = {
            str(node.get("node_id")): node
            for node in graph.nodes
            if node.get("node_id")
        }
        edge_by_id = {
            str(edge.get("edge_id")): edge
            for edge in graph.edges
            if edge.get("edge_id")
        }
        anchor_by_id = {
            str(anchor.get("anchor_id")): anchor
            for anchor in graph.source_anchors
            if anchor.get("anchor_id")
        }
        evidence_to_nodes: dict[str, list[dict[str, Any]]] = {}
        evidence_to_edges: dict[str, list[dict[str, Any]]] = {}
        for node in graph.nodes:
            for ref in node.get("evidence_refs") or []:
                evidence_to_nodes.setdefault(str(ref), []).append(node)
        for edge in graph.edges:
            for ref in edge.get("evidence_refs") or []:
                evidence_to_edges.setdefault(str(ref), []).append(edge)

        criterion_name = str(claim.criterion or "").strip().upper()
        derived_tokens = cls._tokens(claim.criterion or "") - _GENERIC_CRITERION_TOKENS
        criterion_tokens = set(
            _CRITERION_EVIDENCE_TOKENS.get(criterion_name, frozenset(derived_tokens))
        )
        topology_kind = topology_criterion_kind(claim.criterion)
        candidates: list[tuple[int, int, str, str]] = []

        def add(kind: str, ref: str, rank: int) -> None:
            material, text = cls._reference_materiality(
                ref,
                node_by_id=node_by_id,
                edge_by_id=edge_by_id,
                anchor_by_id=anchor_by_id,
                evidence_to_nodes=evidence_to_nodes,
                evidence_to_edges=evidence_to_edges,
            )
            if not material:
                return
            score = len(criterion_tokens.intersection(cls._tokens(text)))
            candidates.append((score, rank, kind, ref))

        for ref in claim.source_anchor_refs:
            add("anchor", ref, 0)
        for ref in claim.graph_path_refs:
            add("graph", ref, 1)
        for ref in claim.evidence_refs:
            add("evidence", ref, 2)

        candidates.sort(key=lambda row: (-row[0], row[1], row[3]))
        positive = [row for row in candidates if row[0] > 0]
        fallback = [row for row in candidates if row[0] == 0]

        if topology_kind:
            # Topology validation already proved the structural relation. Preserve the
            # bounded material graph refs even when labels do not literally contain
            # criterion words such as "downstream" or "path"; lexical scoring is only
            # ranking here, not a second authority that can erase the proven path.
            graph_candidates = [row for row in candidates if row[2] == "graph"]
            chosen = graph_candidates[:_MAX_CLAIM_PROVENANCE_REFS]
            if len(chosen) < _MAX_CLAIM_PROVENANCE_REFS:
                chosen.extend(
                    row
                    for row in [*positive, *fallback]
                    if row not in chosen
                )
                chosen = chosen[:_MAX_CLAIM_PROVENANCE_REFS]
        elif criterion_tokens:
            chosen = positive[:_MAX_CLAIM_PROVENANCE_REFS]
        else:
            chosen = fallback[:2]

        result: dict[str, list[str]] = {"evidence": [], "graph": [], "anchor": []}
        for _, _, kind, ref in chosen:
            if ref not in result[kind]:
                result[kind].append(ref)
        return {key: tuple(value) for key, value in result.items()}

    @classmethod
    def _reference_materiality(
        cls,
        ref: str,
        *,
        node_by_id: dict[str, dict[str, Any]],
        edge_by_id: dict[str, dict[str, Any]],
        anchor_by_id: dict[str, dict[str, Any]],
        evidence_to_nodes: dict[str, list[dict[str, Any]]],
        evidence_to_edges: dict[str, list[dict[str, Any]]],
    ) -> tuple[bool, str]:
        nodes: list[dict[str, Any]] = []
        anchors: list[dict[str, Any]] = []
        evidence_edges: list[dict[str, Any]] = []
        edge = edge_by_id.get(ref)
        if ref in node_by_id:
            nodes.append(node_by_id[ref])
        if ref in anchor_by_id:
            anchor = anchor_by_id[ref]
            anchors.append(anchor)
            linked = node_by_id.get(str(anchor.get("graph_node_id") or ""))
            if linked:
                nodes.append(linked)
        if edge:
            evidence_edges.append(edge)
            for key in ("source_node_id", "target_node_id"):
                linked = node_by_id.get(str(edge.get(key) or ""))
                if linked:
                    nodes.append(linked)
        nodes.extend(evidence_to_nodes.get(ref, []))
        for evidence_edge in evidence_to_edges.get(ref, []):
            evidence_edges.append(evidence_edge)
            for key in ("source_node_id", "target_node_id"):
                linked = node_by_id.get(str(evidence_edge.get(key) or ""))
                if linked:
                    nodes.append(linked)

        paths = {
            str((node.get("source") or {}).get("file_path") or "")
            for node in nodes
            if (node.get("source") or {}).get("file_path")
        }
        paths.update(
            str(anchor.get("file_path") or "")
            for anchor in anchors
            if anchor.get("file_path")
        )
        roles = {source_role(path) for path in paths if path}
        if SOURCE_ROLE_TEST in roles and roles == {SOURCE_ROLE_TEST}:
            return False, ""
        if paths and SOURCE_ROLE_PRODUCTION not in roles:
            return False, ""

        node_types = {str(node.get("node_type") or "") for node in nodes}
        material = SOURCE_ROLE_PRODUCTION in roles or bool(
            node_types.intersection(_MATERIAL_RESOURCE_NODE_TYPES)
        )
        if not material:
            return False, ""

        # Criterion relevance must be derived from evidence VALUES only. Serializing
        # dictionaries with their field names caused generic keys such as `file_path`
        # and `metadata` to look like implementation evidence for media/mark controls.
        # Keep structural/materiality checks above, then rank only the concrete node,
        # source, semantic, attribute-value and edge-type values that the scanner saw.
        text_values: list[str] = []
        seen_nodes: set[str] = set()
        for node in nodes[:12]:
            node_id = str(node.get("node_id") or "")
            if node_id and node_id in seen_nodes:
                continue
            if node_id:
                seen_nodes.add(node_id)
            source = node.get("source") if isinstance(node.get("source"), dict) else {}
            text_values.extend(
                value
                for value in (
                    str(node.get("node_type") or ""),
                    str(node.get("label") or ""),
                    str(source.get("file_path") or ""),
                    str(source.get("symbol_ref") or ""),
                )
                if value
            )
            text_values.extend(
                str(value) for value in node.get("semantic_types") or [] if value
            )
            text_values.extend(cls._semantic_values(node.get("attributes") or {}))

        for anchor in anchors[:8]:
            text_values.extend(
                value
                for value in (
                    str(anchor.get("file_path") or ""),
                    str(anchor.get("symbol_ref") or ""),
                )
                if value
            )

        seen_edges: set[str] = set()
        for evidence_edge in evidence_edges[:12]:
            edge_id = str(evidence_edge.get("edge_id") or "")
            if edge_id and edge_id in seen_edges:
                continue
            if edge_id:
                seen_edges.add(edge_id)
            edge_type = str(evidence_edge.get("edge_type") or "")
            if edge_type:
                text_values.append(edge_type)
            text_values.extend(
                cls._semantic_values(evidence_edge.get("attributes") or {})
            )

        return True, " ".join(text_values)

    @classmethod
    def _semantic_values(cls, value: Any, *, depth: int = 4) -> list[str]:
        """Flatten bounded primitive values without leaking schema/key names into scoring."""
        if depth <= 0 or value is None:
            return []
        if isinstance(value, dict):
            result: list[str] = []
            for item in list(value.values())[:32]:
                result.extend(cls._semantic_values(item, depth=depth - 1))
            return result
        if isinstance(value, (list, tuple, set, frozenset)):
            result = []
            for item in list(value)[:32]:
                result.extend(cls._semantic_values(item, depth=depth - 1))
            return result
        if isinstance(value, (str, int, float, bool)):
            rendered = str(value).strip()
            return [rendered] if rendered else []
        return []

    @staticmethod
    def _tokens(value: str) -> set[str]:
        return {
            token.lower()
            for token in _TOKEN.findall(str(value).replace("_", " ").replace("-", " "))
            if len(token) > 2
        }

"""Evidence-bound repository-wide project and boundary resolution."""
from __future__ import annotations

import xml.etree.ElementTree as ET
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)


@dataclass(frozen=True)
class CrossResolutionResult:
    resolved_edges: int = 0
    limitations: tuple[str, ...] = ()
    unresolved: tuple[str, ...] = ()


class CrossReferenceResolver:
    """Resolve only canonical project/boundary facts with explicit evidence."""

    name = "cross_project"

    def enrich(self, program: SemanticProgram, workspace: Path, project_discovery=None) -> CrossResolutionResult:
        limitations: list[str] = []
        unresolved: list[str] = []
        resolved = 0
        if project_discovery is not None:
            try:
                count, project_limits = self._project_references(program, workspace, project_discovery)
            except (KeyboardInterrupt, SystemExit):
                raise
            except Exception as exc:  # resolver-local failure must not erase language facts
                count, project_limits = 0, [f"cross_project_dependency_resolution_failed:{type(exc).__name__}"]
            resolved += count
            limitations.extend(project_limits)
        try:
            count, http_limits, http_unresolved = self._http_boundaries(program, project_discovery)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:  # resolver-local failure must not erase language facts
            count, http_limits, http_unresolved = 0, [f"cross_http_resolution_failed:{type(exc).__name__}"], []
        resolved += count
        limitations.extend(http_limits)
        unresolved.extend(http_unresolved)
        try:
            count, messaging_limits, messaging_unresolved = self._messaging_boundaries(program, project_discovery)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            count, messaging_limits, messaging_unresolved = 0, [f"cross_messaging_resolution_failed:{type(exc).__name__}"], []
        resolved += count
        limitations.extend(messaging_limits)
        unresolved.extend(messaging_unresolved)
        program.coverage_notes.extend(limitations)
        program.unresolved_frontiers.extend(unresolved)
        program.coverage_notes = sorted(set(program.coverage_notes))
        program.unresolved_frontiers = sorted(set(program.unresolved_frontiers))
        return CrossResolutionResult(resolved, tuple(sorted(set(limitations))), tuple(sorted(set(unresolved))))

    def _messaging_boundaries(self, program, discovery):
        """Converge explicitly identified producer/consumer resources.

        Producers and consumers are emitted by language/framework analyzers.  This
        pass only links distinct resources when provider, kind, and literal name are
        all present; generic names and dynamic configuration remain unresolved.
        """
        resources = [node for node in program.nodes if node.node_type in {"QUEUE", "EVENT"}]
        groups: dict[tuple[str, str, str], list] = {}
        for node in resources:
            attrs = node.attributes or {}
            provider = str(attrs.get("provider") or attrs.get("messagingProvider") or "").lower()
            name = str(attrs.get("resourceName") or attrs.get("topic") or attrs.get("queue") or "").strip()
            kind = node.node_type
            if not provider or not name:
                continue
            groups.setdefault((provider, kind, name), []).append(node)
        resolved = 0
        limitations: list[str] = []
        unresolved: list[str] = []
        for identity, candidates in sorted(groups.items()):
            unique = sorted({node.key: node for node in candidates}.values(), key=lambda node: node.key)
            if len(unique) < 2:
                continue
            for left, right in zip(unique, unique[1:]):
                if not any(edge.edge_type == "RESOLVES_TO" and edge.source_key == left.key and edge.target_key == right.key for edge in program.edges):
                    program.add_edge(SemanticEdgeFact("RESOLVES_TO", left.key, right.key, attributes={"resolution": "MESSAGING_RESOURCE", "provider": identity[0], "resourceType": identity[1], "resourceName": identity[2]}, resolution_state="CORROBORATED"))
                    resolved += 1
        return resolved, limitations, unresolved

    def _project_references(self, program, workspace, discovery):
        by_root = {item.relative_root: item for item in discovery.projects}
        by_manifest = {}
        for project in discovery.projects:
            for manifest in project.manifest_paths:
                by_manifest[(workspace / manifest).resolve(strict=False)] = project
        limitations: list[str] = []
        resolved = 0
        for source in sorted(discovery.projects, key=lambda item: item.project_id):
            for manifest_name in sorted(source.manifest_paths):
                manifest = workspace / manifest_name
                if manifest.name == "go.mod":
                    count, refs = self._go_references(manifest, source, discovery, program, by_manifest)
                    resolved += count; limitations.extend(refs)
                    continue
                if manifest.name == "Cargo.toml":
                    count, refs = self._cargo_references(manifest, source, discovery, program, by_manifest)
                    resolved += count; limitations.extend(refs)
                    continue
                if manifest.suffix.lower() not in {".csproj", ".xml", ".gradle", ".kts"} or not manifest.is_file():
                    continue
                if manifest.suffix.lower() in {".gradle", ".kts"}:
                    try:
                        text = manifest.read_text(encoding="utf-8")
                    except (OSError, UnicodeError):
                        limitations.append(f"cross_project_metadata_partial:{manifest_name}")
                        continue
                    for value in sorted(set(re.findall(r"project\s*\(\s*['\"](:[^'\"]+)['\"]", text))):
                        module = value.lstrip(":").replace(":", "/")
                        candidates = self._gradle_suffix_candidates(module, discovery)
                        if len(candidates) != 1:
                            if not candidates:
                                limitations.append(f"cross_project_reference_unresolved:{manifest_name}:{value}")
                            else:
                                limitations.append(f"cross_project_reference_ambiguous:{manifest_name}:{value}")
                            continue
                        target = candidates[0]
                        if target is None:
                            limitations.append(f"cross_project_reference_unresolved:{manifest_name}:{value}")
                            continue
                        source_key = self._project_node(program, source)
                        target_key = self._project_node(program, target)
                        if not self._has_edge(program, "DEPENDS_ON", source_key, target_key):
                            program.add_edge(SemanticEdgeFact("DEPENDS_ON", source_key, target_key, evidence_refs=(f"source:{manifest_name}", f"target:{target.relative_root or '.'}"), attributes={"relationship": "PROJECT_REFERENCE"}))
                            resolved += 1
                    continue
                try:
                    root = ET.fromstring(manifest.read_text(encoding="utf-8"))
                except (OSError, UnicodeError, ET.ParseError):
                    limitations.append(f"cross_project_metadata_partial:{manifest_name}")
                    continue
                source_key = self._project_node(program, source)
                for item in root.iter():
                    tag = item.tag.rsplit("}", 1)[-1]
                    if tag not in {"ProjectReference", "module"}:
                        continue
                    value = item.attrib.get("Include") if tag == "ProjectReference" else (item.text.strip() if item.text else None)
                    if not value:
                        continue
                    if tag == "module":
                        target_path = (manifest.parent / value / "pom.xml").resolve(strict=False)
                    else:
                        target_path = (manifest.parent / value).resolve(strict=False)
                    target = by_manifest.get(target_path)
                    if target is None and manifest.name in {"build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"}:
                        module = value.lstrip(":").replace(":", "/")
                        candidates = self._gradle_suffix_candidates(module, discovery)
                        if len(candidates) != 1:
                            if not candidates:
                                limitations.append(f"cross_project_reference_unresolved:{manifest_name}:{value}")
                            else:
                                limitations.append(f"cross_project_reference_ambiguous:{manifest_name}:{value}")
                            continue
                        target = candidates[0]
                    if target is None:
                        limitations.append(f"cross_project_reference_unresolved:{manifest_name}:{value}")
                        continue
                    target_key = self._project_node(program, target)
                    if not self._has_edge(program, "DEPENDS_ON", source_key, target_key):
                        program.add_edge(
                            SemanticEdgeFact(
                                "DEPENDS_ON",
                                source_key,
                                target_key,
                                evidence_refs=(f"source:{manifest_name}", f"target:{target.relative_root or '.'}"),
                                attributes={"relationship": "PROJECT_REFERENCE"},
                            )
                        )
                        resolved += 1
        return resolved, limitations

    @staticmethod
    def _gradle_suffix_candidates(module, discovery):
        """Return all static Gradle suffix matches; never choose by order."""
        return sorted(
            (
                candidate
                for candidate in discovery.projects
                if candidate.relative_root.endswith(module)
            ),
            key=lambda candidate: candidate.project_id,
        )

    def _go_references(self, manifest, source, discovery, program, by_manifest):
        if not manifest.is_file(): return 0, []
        limitations=[]; resolved=0; source_key=self._project_node(program, source)
        try: text=manifest.read_text(encoding="utf-8")
        except (OSError, UnicodeError): return 0, [f"cross_project_metadata_partial:{manifest.name}"]
        for match in re.finditer(r"^\s*replace\s+\S+\s*=>\s*([^\s]+)", text, re.M):
            value=match.group(1); target_path=(manifest.parent/value/"go.mod").resolve(strict=False)
            target=by_manifest.get(target_path)
            if target is None:
                limitations.append(f"cross_project_reference_unresolved:{manifest.name}:{value}"); continue
            target_key=self._project_node(program,target)
            if not self._has_edge(program,"DEPENDS_ON",source_key,target_key):
                program.add_edge(SemanticEdgeFact("DEPENDS_ON",source_key,target_key,evidence_refs=(f"source:{manifest.name}",f"target:{target.relative_root or '.'}"),attributes={"relationship":"PROJECT_REFERENCE"})); resolved+=1
        return resolved, limitations

    def _cargo_references(self, manifest, source, discovery, program, by_manifest):
        if not manifest.is_file(): return 0, []
        try: payload=tomllib.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, tomllib.TOMLDecodeError): return 0, [f"cross_project_metadata_partial:{manifest.name}"]
        limitations=[]; resolved=0; source_key=self._project_node(program,source)
        for name,value in sorted((payload.get("dependencies") or {}).items()):
            if not isinstance(value,dict) or not isinstance(value.get("path"),str): continue
            target_path=(manifest.parent/value["path"])/"Cargo.toml"; target=by_manifest.get(target_path.resolve(strict=False))
            if target is None:
                limitations.append(f"cross_project_reference_unresolved:{manifest.name}:{name}"); continue
            target_key=self._project_node(program,target)
            if not self._has_edge(program,"DEPENDS_ON",source_key,target_key):
                program.add_edge(SemanticEdgeFact("DEPENDS_ON",source_key,target_key,evidence_refs=(f"source:{manifest.name}",f"target:{target.relative_root or '.'}"),attributes={"relationship":"PROJECT_REFERENCE"})); resolved+=1
        return resolved, limitations

    def _http_boundaries(self, program, discovery):
        # Only source-backed route declarations are eligible targets.  Boundary
        # extraction may also create route-shaped anchors for client calls; those
        # are not server endpoints and must not participate in cross-project
        # matching.
        routes = [
            node for node in program.nodes
            if node.node_type == "HTTP_ROUTE" and node.file_path
        ]
        calls = [
            node
            for node in program.nodes
            if node.node_type == "CALL_SITE" and str(node.attributes.get("integrationType", "")).upper() == "HTTP"
        ]
        if not routes or not calls:
            return 0, [], []
        limitations: list[str] = []
        unresolved: list[str] = []
        resolved = 0
        for call in sorted(calls, key=lambda item: item.key):
            path = call.attributes.get("route") or call.attributes.get("path")
            method = str(call.attributes.get("method", "GET")).upper()
            if not isinstance(path, str) or not path.startswith("/"):
                if path is not None:
                    unresolved.append(call.key)
                    limitations.append(f"cross_http_dynamic:{call.file_path}:{call.start_line or 0}")
                continue
            matching = [route for route in routes if str(route.attributes.get("method", "GET")).upper() == method and self._route_matches(path, str(route.attributes.get("route", "")))]
            if not matching:
                continue
            if len(matching) > 1:
                unresolved.append(call.key)
                limitations.append(f"cross_http_ambiguous:{call.file_path}:{call.start_line or 0}")
                continue
            target = matching[0]
            edge_key = ("CALLS_API", call.key, target.key)
            if not any((edge.edge_type, edge.source_key, edge.target_key) == edge_key for edge in program.edges):
                program.add_edge(
                    SemanticEdgeFact(
                        "CALLS_API",
                        call.key,
                        target.key,
                        evidence_refs=(
                            f"source:{call.file_path}:{call.start_line or 0}",
                            f"target:{target.file_path}:{target.start_line or 0}",
                        ),
                        attributes={"resolution": "CROSS_PROJECT"},
                    )
                )
                resolved += 1
        return resolved, limitations, unresolved

    @staticmethod
    def _project_node(program, project):
        key = f"project:{project.project_id}"
        if not any(node.key == key for node in program.nodes):
            program.add_node(SemanticNodeFact(key, "MODULE", project.project_name or project.relative_root or ".", attributes={"projectId": project.project_id, "projectRoot": project.relative_root}))
        return key

    @staticmethod
    def _project_for(file_path, discovery):
        if not file_path or discovery is None:
            return None
        value = file_path.replace("\\", "/")
        owner = discovery.file_ownership.get(value)
        if owner:
            return owner
        return None

    @staticmethod
    def _has_edge(program, edge_type, source, target):
        return any(edge.edge_type == edge_type and edge.source_key == source and edge.target_key == target for edge in program.edges)

    @staticmethod
    def _route_matches(path, template):
        def normalize(value):
            value = value.split("?", 1)[0].strip()
            return "/" + value.strip("/") if value.strip("/") else "/"

        left = normalize(path).split("/")
        right = normalize(template).split("/")
        if len(left) != len(right):
            return False
        return all(a == b or (b.startswith("{") and b.endswith("}")) or b.startswith(":") for a, b in zip(left, right))

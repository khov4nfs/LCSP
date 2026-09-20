from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_PARTIAL, ANALYZER_SUCCESS
from .protocol import FrameworkAnalysisResult, FrameworkCapability


class SpringFrameworkDetector:
    name = "spring"

    def detect(self, project, workspace: Path, jvm_result) -> tuple[str, ...]:
        for manifest_name in project.manifest_paths:
            path = workspace / manifest_name
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                continue
            if any(token in text.lower() for token in ("spring-boot", "springframework", "org.springframework")):
                return ("spring",)
        return ()


class SpringFrameworkAdapter:
    framework = "spring"

    def supports(self, framework: str) -> bool:
        return framework == self.framework

    def capabilities(self) -> FrameworkCapability:
        return FrameworkCapability(routes=True, controllers=True, persistence_models=True, jobs=True, callbacks=False, dynamic_resolution=False)

    def analyze(self, project, workspace: Path, jvm_result) -> FrameworkAnalysisResult:
        program = SemanticProgram()
        limitations: list[str] = []
        evidence: list[str] = []
        source_files = sorted(
            path.relative_to(workspace).as_posix()
            for path in project.root_path.rglob("*")
            if path.is_file() and path.suffix.lower() in {".java", ".kt"}
            and not any(part in {"target", "build", ".gradle", "out", ".git", "generated"} for part in path.parts)
        )
        for relative in source_files:
            try:
                text = (workspace / relative).read_text(encoding="utf-8", errors="replace")
            except OSError:
                limitations.append(f"spring_source_read_failed:file={relative}")
                continue
            self._roles(relative, text, jvm_result, program, evidence)
            self._routes(relative, text, jvm_result, program, limitations, evidence)
            self._di_and_persistence(relative, text, jvm_result, program, limitations, evidence)
            self._jobs(relative, text, program, evidence)
        return FrameworkAnalysisResult(
            framework=self.framework,
            project_id=project.project_id,
            status=ANALYZER_PARTIAL if limitations else ANALYZER_SUCCESS,
            capabilities=self.capabilities(),
            semantic_program=program,
            coverage_limitations=tuple(sorted(set(limitations))),
            evidence=tuple(sorted(set(evidence))),
        )

    def _roles(self, relative, text, jvm_result, program, evidence):
        roles = []
        if re.search(r"@(RestController|Controller)\b", text): roles.append("CONTROLLER")
        if re.search(r"@(Service|Component)\b", text): roles.append("SERVICE")
        if re.search(r"@Repository\b", text): roles.append("REPOSITORY")
        if re.search(r"@Entity\b", text): roles.append("ENTITY")
        if not roles: return
        match = re.search(r"\b(?:class|interface|object)\s+([A-Za-z_]\w*)", text)
        if not match: return
        name = match.group(1)
        for role in roles:
            evidence.append(f"{relative}:1:{role}")
            for node in jvm_result.semantic_program.nodes:
                if node.file_path == relative and node.node_type in {"CLASS", "INTERFACE", "TYPE"} and node.label.split(".")[-1] == name:
                    program.add_node(replace(node, semantic_types=tuple(sorted(set((*node.semantic_types, role)))), attributes={**node.attributes, "framework": "spring", "frameworkRole": role}))

    def _routes(self, relative, text, jvm_result, program, limitations, evidence):
        class_prefix = self._annotation_value(text, "RequestMapping")
        class_name = re.search(r"\b(?:class|object)\s+([A-Za-z_]\w*)", text)
        owner = class_name.group(1) if class_name else None
        for match in re.finditer(r"@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*(?:\(\s*([^)]*)\))?", text):
            annotation, args = match.group(1), match.group(2) or ""
            method = {"GetMapping":"GET", "PostMapping":"POST", "PutMapping":"PUT", "PatchMapping":"PATCH", "DeleteMapping":"DELETE"}.get(annotation)
            if method is None:
                method_match = re.search(r"method\s*=\s*RequestMethod\.([A-Z]+)", args)
                method = method_match.group(1) if method_match else "GET"
            route_match = re.search(r"[\"']([^\"']*)[\"']", args)
            if not route_match:
                limitations.append(f"spring_dynamic_route:file={relative}:{text[:match.start()].count(chr(10))+1}")
                continue
            route = self._join(class_prefix, route_match.group(1))
            line = text[:match.start()].count("\n") + 1
            key = f"spring:route:{relative}:{line}:{method}:{route}"
            program.add_node(SemanticNodeFact(key, "HTTP_ROUTE", f"{method} {route}", relative, line, line, attributes={"framework":"spring", "method":method, "route":route}, semantic_types=("SPRING_ROUTE",)))
            handler = self._handler(jvm_result, relative, text[match.end():], owner)
            if handler:
                program.add_edge(SemanticEdgeFact("HANDLED_BY", key, handler.key, attributes={"framework":"spring"}, evidence_refs=(f"evidence:{relative}:{line}",)))
            else:
                limitations.append(f"spring_route_handler_unresolved:file={relative}:{line}")
            evidence.append(f"{relative}:{line}:route")

    def _jobs(self, relative, text, program, evidence):
        if "@Scheduled" not in text: return
        match = re.search(r"\b(?:class|object)\s+([A-Za-z_]\w*)", text)
        if match:
            key = f"spring:job:{relative}:{match.start(1)}"
            program.add_node(SemanticNodeFact(key, "BACKGROUND_JOB", match.group(1), relative, text[:match.start()].count("\n") + 1, text[:match.start()].count("\n") + 1, attributes={"framework":"spring", "frameworkRole":"SCHEDULED_JOB"}, semantic_types=("SCHEDULED_JOB",)))
            evidence.append(f"{relative}:scheduled")

    def _di_and_persistence(self, relative, text, jvm_result, program, limitations, evidence):
        owner_match = re.search(r"\b(?:class|object)\s+([A-Za-z_]\w*)", text)
        if not owner_match:
            return
        owner = next((node for node in jvm_result.semantic_program.nodes if node.file_path == relative and node.node_type == "CLASS" and node.label.endswith(owner_match.group(1))), None)
        if owner is None:
            return
        for parameter in re.findall(r"(?:public|private|protected)?\s*\w+[<>, ?]*\s+([A-Za-z_]\w*)\s*(?:[,)]|$)", text):
            if parameter in {"return", "class", "if"}:
                continue
            dependency = f"spring:dependency:{relative}:{parameter}"
            program.add_node(SemanticNodeFact(dependency, "TYPE", parameter, relative, owner.start_line, owner.end_line, attributes={"framework":"spring", "resolution":"UNRESOLVED"}, resolution_state="UNRESOLVED"))
            program.add_edge(SemanticEdgeFact("DEPENDS_ON", owner.key, dependency, attributes={"framework":"spring", "injection":"constructor_or_field"}, coverage_state="LIMITED", resolution_state="UNRESOLVED"))
            evidence.append(f"{relative}:dependency:{parameter}")
        if "@Entity" in text and "@Table" in text:
            table = re.search(r"@Table\s*\(\s*name\s*=\s*[\"']([^\"']+)", text)
            if table:
                table_key = f"spring:table:{relative}:{table.group(1)}"
                program.add_node(SemanticNodeFact(table_key, "TABLE", table.group(1), relative, owner.start_line, owner.end_line, attributes={"framework":"spring", "explicit":True}, semantic_types=("TABLE",)))
                program.add_edge(SemanticEdgeFact("RESOLVES_TO", owner.key, table_key, attributes={"framework":"spring"}))
                evidence.append(f"{relative}:table:{table.group(1)}")

    @staticmethod
    def _annotation_value(text, annotation):
        match = re.search(rf"@{annotation}\s*\(\s*[\"']([^\"']*)[\"']", text)
        return match.group(1) if match else ""

    @staticmethod
    def _join(prefix, suffix):
        value = f"{prefix.rstrip('/')}/{suffix.lstrip('/')}" if prefix else suffix
        return "/" + value.strip("/") if value.strip("/") else "/"

    @staticmethod
    def _handler(result, relative, tail, owner):
        method = re.search(r"\b(?:fun\s+|[A-Za-z_<>,?\[\].]+\s+)([A-Za-z_]\w*)\s*\(", tail)
        if not method: return None
        name = method.group(1)
        return next((node for node in result.semantic_program.nodes if node.file_path == relative and node.node_type in {"METHOD", "FUNCTION"} and node.label.endswith(f".{name}")), None)

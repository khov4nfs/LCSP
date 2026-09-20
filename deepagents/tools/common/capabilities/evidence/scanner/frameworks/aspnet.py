from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import replace
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import (
    SemanticEdgeFact,
    SemanticNodeFact,
    SemanticProgram,
)
from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_PARTIAL,
    ANALYZER_SUCCESS,
)
from .protocol import FrameworkAdapter, FrameworkAnalysisResult, FrameworkCapability


class AspNetCoreFrameworkDetector:
    name = "aspnet_core"

    def detect(self, project, workspace: Path, csharp_result) -> tuple[str, ...]:
        for value in project.manifest_paths:
            manifest = workspace / value
            if manifest.suffix.lower() != ".csproj" or not manifest.is_file():
                continue
            try:
                root = ET.fromstring(manifest.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, ET.ParseError):
                continue
            sdk = root.attrib.get("Sdk", "")
            packages = {
                item.attrib.get("Include", "").lower()
                for item in root.iter()
                if item.tag.rsplit("}", 1)[-1] == "PackageReference"
            }
            if "Microsoft.NET.Sdk.Web" in sdk or any(
                item.startswith(("microsoft.aspnetcore", "microsoft.extensions.hosting"))
                for item in packages
            ):
                return (self.name,)
        return ()


class AspNetCoreFrameworkAdapter:
    framework = "aspnet_core"

    def supports(self, framework: str) -> bool:
        return framework == self.framework

    def capabilities(self) -> FrameworkCapability:
        return FrameworkCapability(
            routes=True,
            controllers=True,
            persistence_models=True,
            jobs=True,
            callbacks=False,
            dynamic_resolution=False,
        )

    def analyze(self, project, workspace: Path, csharp_result) -> FrameworkAnalysisResult:
        program = SemanticProgram()
        limitations: list[str] = []
        evidence: list[str] = []
        for relative in self._files(project, workspace):
            try:
                text = (workspace / relative).read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                limitations.append(f"aspnet_read_failed: file={relative}")
                continue
            self._roles(relative, text, csharp_result, program, evidence)
            self._routes(relative, text, csharp_result, program, limitations, evidence)
            self._di(relative, text, program, evidence)
            self._minimal_api(relative, text, program, limitations, evidence)
        return FrameworkAnalysisResult(
            framework=self.framework,
            project_id=project.project_id,
            status=ANALYZER_PARTIAL if limitations else ANALYZER_SUCCESS,
            capabilities=self.capabilities(),
            semantic_program=program,
            coverage_limitations=tuple(sorted(set(limitations))),
            evidence=tuple(sorted(set(evidence))),
        )

    @staticmethod
    def _files(project, workspace):
        root = project.root_path
        return sorted(
            path.relative_to(workspace).as_posix()
            for path in root.rglob("*.cs")
            if path.is_file()
            and not any(part in {"bin", "obj", "generated", ".git"} for part in path.parts)
        )

    def _roles(self, relative, text, csharp_result, program, evidence):
        for match in re.finditer(
            r"(?P<attrs>(?:\s*\[[^\]]+\])+)?\s*(?:public\s+)?class\s+(?P<name>[A-Za-z_]\w*)\s*(?::\s*(?P<bases>[^\{]+))?",
            text,
        ):
            name = match.group("name")
            bases = match.group("bases") or ""
            attrs = match.group("attrs") or ""
            role = None
            if "ApiController" in attrs or "ControllerBase" in bases or name.endswith("Controller"):
                role = "CONTROLLER"
            elif "DbContext" in bases:
                role = "DATABASE_CONTEXT"
            elif "BackgroundService" in bases:
                role = "BACKGROUND_SERVICE"
            if role is None:
                continue
            node = self._find_node(csharp_result, relative, name, "CLASS")
            if node is None:
                continue
            program.add_node(
                replace(
                    node,
                    attributes={**node.attributes, "framework": "aspnet_core", "frameworkRole": role},
                    semantic_types=tuple(sorted(set((*node.semantic_types, role)))),
                )
            )
            evidence.append(f"{relative}:{text[:match.start()].count(chr(10)) + 1}:{role}")

    def _routes(self, relative, text, csharp_result, program, limitations, evidence):
        class_routes = {}
        for match in re.finditer(r"(?P<attrs>(?:\s*\[[^\]]+\])+)?\s*(?:public\s+)?class\s+(?P<class>[A-Za-z_]\w*)[^\{]*", text):
            attrs = match.group("attrs") or ""
            route = re.search(r"\[Route\(\s*[\"']([^\"']+)", attrs)
            if route:
                class_routes[match.group("class")] = route.group(1)
        for match in re.finditer(
            r"(?P<attrs>(?:\s*\[[^\]]+\])+)?\s*(?:public|private|protected|internal|static|async|\s)+[^\n\{;]+\s+(?P<method>[A-Za-z_]\w*)\s*\(",
            text,
        ):
            attrs = match.group("attrs") or ""
            http = re.search(r"\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)(?:\(\s*[\"']([^\"']*)[\"'])?", attrs)
            if not http:
                continue
            class_match = list(re.finditer(r"class\s+([A-Za-z_]\w*)", text[: match.start()]))
            if not class_match:
                continue
            class_name = class_match[-1].group(1)
            base = class_routes.get(class_name)
            if base is None:
                limitations.append(f"aspnet_route_class_path_unresolved: file={relative}")
                continue
            suffix = http.group(2) or ""
            route = "/" + "/".join(part.strip("/") for part in (base, suffix) if part.strip("/"))
            route = route if route != "/" else "/"
            line = text[: match.start()].count(chr(10)) + 1
            key = f"aspnet:route:{relative}:{line}:{http.group(1)}:{route}"
            program.add_node(SemanticNodeFact(key, "HTTP_ROUTE", f"{http.group(1)[2:].upper()} {route}", relative, line, line, attributes={"framework": "aspnet_core", "method": http.group(1)[2:].upper(), "route": route}, semantic_types=("HTTP_ROUTE",)))
            handler = self._find_node(csharp_result, relative, match.group("method"), "METHOD", class_name)
            if handler is None:
                limitations.append(f"aspnet_route_handler_unresolved: {class_name}.{match.group('method')}")
                program.unresolved_frontiers.append(key)
            else:
                program.add_edge(SemanticEdgeFact("HANDLED_BY", key, handler.key, attributes={"framework": "aspnet_core"}))
            evidence.append(f"{relative}:{line}:route")
        if re.search(r"\[Route\(\s*[^\"']", text):
            limitations.append(f"aspnet_dynamic_route: file={relative}")

    def _minimal_api(self, relative, text, program, limitations, evidence):
        for match in re.finditer(r"app\.Map(Get|Post|Put|Patch|Delete)\(\s*[\"']([^\"']+)", text):
            line = text[: match.start()].count(chr(10)) + 1
            key = f"aspnet:minimal:{relative}:{line}:{match.group(1)}:{match.group(2)}"
            program.add_node(SemanticNodeFact(key, "HTTP_ROUTE", f"{match.group(1).upper()} {match.group(2)}", relative, line, line, attributes={"framework": "aspnet_core", "method": match.group(1).upper(), "route": match.group(2), "minimalApi": True}, semantic_types=("HTTP_ROUTE",)))
            evidence.append(f"{relative}:{line}:minimal-route")
        if re.search(r"app\.Map(?:Get|Post|Put|Patch|Delete)\(\s*[^\"']", text):
            limitations.append(f"aspnet_dynamic_minimal_route: file={relative}")

    def _di(self, relative, text, program, evidence):
        for match in re.finditer(r"Add(?:Scoped|Singleton|Transient)\s*<\s*([^,>]+)\s*,\s*([^>]+)>", text):
            abstraction, implementation = (item.strip() for item in match.groups())
            line = text[: match.start()].count(chr(10)) + 1
            key = f"aspnet:di:{relative}:{line}:{abstraction}"
            program.add_node(SemanticNodeFact(key, "TYPE", abstraction, relative, line, line, attributes={"framework": "aspnet_core", "implementation": implementation, "lifetime": match.group(0).split("Add", 1)[1].split("<", 1)[0]}))
            evidence.append(f"{relative}:{line}:di")

    @staticmethod
    def _find_node(result, relative, name, node_type, owner=None):
        if result is None:
            return None
        for node in result.semantic_program.nodes:
            if node.node_type != node_type or node.file_path != relative:
                continue
            if owner and not (
                node.label.startswith(owner + ".")
                or node.label.endswith(f"::{owner}.{name}")
            ):
                continue
            if node.label == name or node.label.endswith("." + name):
                return node
        return None

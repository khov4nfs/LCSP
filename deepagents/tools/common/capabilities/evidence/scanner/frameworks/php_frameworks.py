from __future__ import annotations
import json, re
from dataclasses import replace
from pathlib import Path
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_PARTIAL, ANALYZER_SUCCESS
from .protocol import FrameworkAnalysisResult, FrameworkCapability

def _composer(project, workspace):
    for manifest in project.manifest_paths:
        if Path(manifest).name != "composer.json": continue
        try: return json.loads((workspace / manifest).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError): return {}
    return {}

class LaravelFrameworkDetector:
    name = "laravel"
    def detect(self, project, workspace, language_result):
        deps = {**(_composer(project, workspace).get("require") or {}), **(_composer(project, workspace).get("require-dev") or {})}
        return ("laravel",) if any(name.lower() == "laravel/framework" for name in deps) else ()

class SymfonyFrameworkDetector:
    name = "symfony"
    def detect(self, project, workspace, language_result):
        deps = {**(_composer(project, workspace).get("require") or {}), **(_composer(project, workspace).get("require-dev") or {})}
        names = {name.lower() for name in deps}
        return ("symfony",) if any(name.startswith("symfony/") and name not in {"symfony/polyfill-php80", "symfony/polyfill-mbstring"} for name in names) and "laravel/framework" not in names else ()

class _PhpFrameworkAdapter:
    framework = ""
    def supports(self, framework): return framework == self.framework
    def capabilities(self): return FrameworkCapability(routes=True, controllers=True, persistence_models=True, jobs=True, dynamic_resolution=False)
    def analyze(self, project, workspace, language_result):
        program = SemanticProgram(); limits=[]; files = sorted(str(path.relative_to(workspace)).replace("\\", "/") for path in project.root_path.rglob("*.php") if path.is_file() and "vendor" not in path.parts)
        for relative in files:
            try: text=(workspace/relative).read_text(encoding="utf-8", errors="replace")
            except OSError: limits.append(f"{self.framework}_read_failed:file={relative}"); continue
            self._roles(relative, text, language_result, program)
            self._routes(relative, text, language_result, program, limits)
        return FrameworkAnalysisResult(self.framework, project.project_id, ANALYZER_PARTIAL if limits else ANALYZER_SUCCESS, self.capabilities(), program, tuple(sorted(set(limits))))
    def _roles(self, relative, text, result, program):
        roles=[]
        if self.framework == "laravel":
            if "extends Controller" in text: roles.append("CONTROLLER")
            if "extends Model" in text: roles.append("ENTITY")
        else:
            if "#[Route" in text or "extends AbstractController" in text: roles.append("CONTROLLER")
            if "#[ORM\\Entity" in text: roles.append("ENTITY")
        match=re.search(r"\bclass\s+([A-Za-z_]\w*)", text)
        if not match:return
        for role in roles:
            for node in result.semantic_program.nodes:
                if node.file_path == relative and node.node_type == "CLASS" and node.label.endswith(match.group(1)):
                    program.add_node(replace(node, semantic_types=tuple(sorted(set((*node.semantic_types, role)))), attributes={**node.attributes,"framework":self.framework,"frameworkRole":role}))
    def _routes(self, relative, text, result, program, limits):
        if self.framework == "laravel":
            patterns=r"Route::(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]"
            for match in re.finditer(patterns,text,re.I):
                self._emit(relative,text,match.start(),match.group(1).upper(),match.group(2),result,program,limits)
        else:
            for match in re.finditer(r"#\[Route\s*\(\s*['\"]([^'\"]+)['\"](?:[^)]*methods\s*:\s*\[\s*['\"]([A-Z]+))?",text):
                self._emit(relative,text,match.start(),match.group(2) or "GET",match.group(1),result,program,limits)
    def _emit(self, relative,text,offset,method,path,result,program,limits):
        line=text[:offset].count("\n")+1; key=f"{self.framework}:route:{relative}:{line}:{method}:{path}"
        program.add_node(SemanticNodeFact(key,"HTTP_ROUTE",f"{method} {path}",relative,line,line,attributes={"framework":self.framework,"method":method,"route":path},semantic_types=(f"{self.framework.upper()}_ROUTE",)))
        method_match=re.search(r"\b(?:function|fn)\s+([A-Za-z_]\w*)",text[offset:])
        if method_match:
            handler=next((node for node in result.semantic_program.nodes if node.file_path==relative and node.node_type in {"METHOD","FUNCTION"} and node.label.endswith(method_match.group(1))),None)
            if handler: program.add_edge(SemanticEdgeFact("HANDLED_BY",key,handler.key,attributes={"framework":self.framework}))
            else: limits.append(f"{self.framework}_route_handler_unresolved:file={relative}:{line}")

class LaravelFrameworkAdapter(_PhpFrameworkAdapter): framework="laravel"
class SymfonyFrameworkAdapter(_PhpFrameworkAdapter): framework="symfony"

from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_PARTIAL, ANALYZER_SUCCESS
from .protocol import FrameworkAnalysisResult, FrameworkCapability


def _manifest_text(project, workspace, names):
    for value in project.manifest_paths:
        path = workspace / value
        if path.name in names and path.is_file():
            try: yield path.name, path.read_text(encoding="utf-8")
            except (OSError, UnicodeError): continue


class _MobileDetector:
    name = ""
    framework = ""
    language = ""

    def detect(self, project, workspace: Path, language_result):
        allowed = self.language if isinstance(self.language, tuple) else (self.language,)
        if language_result.language not in allowed: return ()
        manifests = dict(_manifest_text(project, workspace, {"package.json", "pubspec.yaml", "AndroidManifest.xml", "Podfile", "Package.swift"}))
        if self.framework == "ios":
            if project.project_kind == "ios" or any(name in {"Podfile", "Package.swift"} for name in manifests): return (self.framework,)
        if self.framework == "android":
            if project.project_kind == "android" or "AndroidManifest.xml" in manifests: return (self.framework,)
        if self.framework == "react_native":
            try: payload=json.loads(manifests.get("package.json", "{}"))
            except json.JSONDecodeError: payload={}
            deps={**payload.get("dependencies", {}), **payload.get("devDependencies", {})} if isinstance(payload, dict) else {}
            if any(name in deps for name in ("react-native", "expo")): return (self.framework,)
        if self.framework == "flutter" and "pubspec.yaml" in manifests and re.search(r"^\s{2}flutter:\s*(?:sdk:\s*flutter)?", manifests["pubspec.yaml"], re.M): return (self.framework,)
        return ()


class _MobileAdapter:
    framework = ""
    language = ""

    def supports(self, framework): return framework == self.framework
    def capabilities(self): return FrameworkCapability(routes=True, controllers=True, persistence_models=False, jobs=False, callbacks=False, dynamic_resolution=False)

    def analyze(self, project, workspace: Path, language_result):
        program=SemanticProgram(); limitations=[]; files=self._files(project, workspace)
        for relative in files:
            try: text=(workspace/relative).read_text(encoding="utf-8")
            except (OSError, UnicodeError): limitations.append(f"{self.framework}_read_failed:file={relative}"); continue
            self._enrich(relative,text,language_result,program,limitations)
        return FrameworkAnalysisResult(self.framework, project.project_id, ANALYZER_PARTIAL if limitations else ANALYZER_SUCCESS, self.capabilities(), program, tuple(sorted(set(limitations))), tuple(sorted({f"{self.framework}:{item}" for item in files})))

    def _files(self, project, workspace):
        root=project.root_path
        try: return sorted(path.relative_to(workspace).as_posix() for path in root.rglob("*") if path.is_file() and not any(part in path.parts for part in ("node_modules","Pods","build","DerivedData",".dart_tool",".git","target")))
        except OSError: return []

    def _enrich(self, relative, text, language_result, program, limitations):
        raise NotImplementedError

    @staticmethod
    def _annotate(language_result, program, role, predicate, framework):
        for node in language_result.native_result.semantic_program.nodes:
            if predicate(node):
                program.add_node(replace(node, semantic_types=tuple(sorted(set((*node.semantic_types, "MOBILE_ROLE")))), attributes={**node.attributes, "framework": framework, "mobileRole": role}))

    @staticmethod
    def _navigation(relative, text, language_result, program, pattern, framework):
        for match in re.finditer(pattern, text):
            line=text.count("\n",0,match.start())+1; target=match.group(1) if match.lastindex else None
            source=next((node for node in language_result.native_result.semantic_program.nodes if node.file_path==relative and (node.start_line or 0)<=line<=(node.end_line or line)),None)
            target_node=next((node for node in language_result.native_result.semantic_program.nodes if target and node.label.split(".")[-1].split("::")[-1]==target),None)
            if source and target_node:
                program.add_edge(SemanticEdgeFact("NAVIGATES_TO", source.key, target_node.key, attributes={"framework":framework}, evidence_refs=(f"source:{relative}:{line}",)))
            else:
                program.unresolved_frontiers.append(f"{framework}:navigation:{relative}:{line}")


class IOSFrameworkDetector(_MobileDetector): name="ios"; framework="ios"; language=("swift", "objc")
class AndroidFrameworkDetector(_MobileDetector): name="android"; framework="android"; language=("java", "kotlin")
class ReactNativeFrameworkDetector(_MobileDetector): name="react_native"; framework="react_native"; language=("typescript", "javascript")
class FlutterFrameworkDetector(_MobileDetector): name="flutter"; framework="flutter"; language="dart"


class IOSFrameworkAdapter(_MobileAdapter):
    framework="ios"
    def _enrich(self, relative,text,language_result,program,limitations):
        self._annotate(language_result,program,"view",lambda n: n.file_path==relative and (n.label.endswith("View") or "View" in n.label),self.framework)
        self._annotate(language_result,program,"application_entry",lambda n: n.file_path==relative and "main" in n.attributes.get("mobileRole", ""),self.framework)
        self._navigation(relative,text,language_result,program,r"(?:NavigationLink|pushViewController|present)\s*\([^\"']*[\"']([^\"']+)",self.framework)
        for match in re.finditer(r"(?:NS[A-Za-z]+UsageDescription|UIApplicationExitsOnSuspend)", text):
            line=text.count("\n",0,match.start())+1; key=f"mobile:ios:permission:{relative}:{line}"
            program.add_node(SemanticNodeFact(key,"MODULE",match.group(0),relative,line,line,attributes={"framework":self.framework,"permissionDeclared":True}))

class AndroidFrameworkAdapter(_MobileAdapter):
    framework="android"
    def _enrich(self, relative,text,language_result,program,limitations):
        self._annotate(language_result,program,"activity_fragment",lambda n: n.file_path==relative and n.node_type=="CLASS" and bool(re.search(r"(?:Activity|Fragment)$",n.label)),self.framework)
        if relative.endswith("AndroidManifest.xml"):
            for match in re.finditer(r"<uses-permission[^>]+android:name=\"([^\"]+)\"",text):
                line=text.count("\n",0,match.start())+1; key=f"mobile:android:permission:{relative}:{line}"; program.add_node(SemanticNodeFact(key,"MODULE",match.group(1),relative,line,line,attributes={"framework":self.framework,"permissionDeclared":True}))
            for match in re.finditer(r"android:name=\"([^\"]+)\"",text):
                line=text.count("\n",0,match.start())+1; key=f"mobile:android:entry:{relative}:{line}"; program.add_node(SemanticNodeFact(key,"MODULE",match.group(1),relative,line,line,attributes={"framework":self.framework,"mobileRole":"manifest_component"}))
        self._navigation(relative,text,language_result,program,r"Intent\s*\([^,]+,\s*([A-Za-z_]\w*)::class\.java",self.framework)

class ReactNativeFrameworkAdapter(_MobileAdapter):
    framework="react_native"
    def _enrich(self, relative,text,language_result,program,limitations):
        self._annotate(language_result,program,"screen_component",lambda n: n.file_path==relative and n.node_type in {"FUNCTION","CLASS"},self.framework)
        self._navigation(relative,text,language_result,program,r"(?:navigate|push)\s*\(\s*[\"']([^\"']+)",self.framework)

class FlutterFrameworkAdapter(_MobileAdapter):
    framework="flutter"
    def _enrich(self, relative,text,language_result,program,limitations):
        self._annotate(language_result,program,"widget",lambda n: n.file_path==relative and n.node_type=="CLASS" and bool(re.search(r"(?:Page|Screen|Widget)$",n.label)),self.framework)
        self._navigation(relative,text,language_result,program,r"(?:pushNamed|push)\s*\([^\"']*[\"']([^\"']+)",self.framework)

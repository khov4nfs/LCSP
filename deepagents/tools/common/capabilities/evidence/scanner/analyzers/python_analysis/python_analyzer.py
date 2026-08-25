from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from tools.common.capabilities.evidence.scanner.parsers.python.python_ast_parser import ParsedPythonFile, PythonAstParser
from tools.common.capabilities.evidence.scanner.parsers.python.python_cst_parser import PythonCstParser

from tools.common.capabilities.evidence.scanner.analyzers.ai_invocation.ai_pattern_rules import AI_RULE_TABLE
from .level_guard import LevelGuard


@dataclass(frozen=True)
class AiCallSite:
    file_path: str
    line_number: int
    function_name: str
    module_alias: str
    matched_rule_id: str
    finding_type: str
    analysis_level: str
    call_args_schema: list[str]
    has_dynamic_call: bool
    kwarg_names: list[str]
    confidence: float = 0.0
    evidence: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class TechnicalFinding:
    finding_type: str
    confidence: float
    evidence: list[dict]
    file_path: str
    analysis_level: str


@dataclass(frozen=True)
class PythonAnalysisResult:
    files_analyzed: int
    files_skipped: int
    ai_call_sites: list[AiCallSite]
    import_map: dict[str, str]
    unsupported_dynamic_flows: list[dict]
    coverage_limitation: bool
    coverage_limitations: list[str] = field(default_factory=list)

    @property
    def findings(self) -> list[TechnicalFinding]:
        findings = [
            TechnicalFinding(
                finding_type=site.finding_type,
                confidence=round(min(1.0, max(0.0, site.confidence)), 2),
                evidence=list(site.evidence),
                file_path=site.file_path,
                analysis_level=site.analysis_level,
            )
            for site in self.ai_call_sites
        ]
        findings.extend(
            TechnicalFinding(
                finding_type="UNSUPPORTED_DYNAMIC_FLOW",
                confidence=1.0,
                evidence=[
                    {
                        "file": flow.get("file"),
                        "line": flow.get("line"),
                        "reason": flow.get("reason"),
                    }
                ],
                file_path=str(flow.get("file", "")),
                analysis_level="L3",
            )
            for flow in self.unsupported_dynamic_flows
        )
        return findings


class PythonAnalyzer:
    def __init__(self, workspace: str | Path, max_l3_hops: int = 1) -> None:
        self._workspace = Path(workspace)
        self._max_l3_hops = max(1, max_l3_hops)
        self._ast_parser = PythonAstParser()
        self._cst_parser = PythonCstParser()
        self._level_guard = LevelGuard()

    def analyze(self, include_files: Iterable[str] | None = None) -> PythonAnalysisResult:
        parsed_files = self._parse_workspace(include_files)
        import_map: dict[str, str] = {}
        for parsed in parsed_files:
            import_map.update(parsed.import_map)

        kwarg_names: dict[str, dict[int, list[str]]] = {}
        coverage_limitations = [
            f"python_ast_parse_skipped: file={parsed.relative_path} "
            f"reason={parsed.skip_reason or 'unavailable'}"
            for parsed in parsed_files
            if parsed.coverage_limited
        ]
        for parsed in parsed_files:
            if parsed.tree is None:
                continue
            cst_result = self._cst_parser.parse_call_keywords(
                parsed.path,
                self._workspace,
            )
            kwarg_names[parsed.relative_path] = cst_result.kwarg_names_by_line
            coverage_limitations.extend(cst_result.coverage_limitations)

        call_sites: list[AiCallSite] = []
        unsupported: list[dict] = []
        for parsed in parsed_files:
            if parsed.tree is None:
                continue
            sites, flows = self._analyze_file(
                parsed,
                kwarg_names.get(parsed.relative_path, {}),
                analysis_level="L1",
            )
            call_sites.extend(sites)
            unsupported.extend(flows)

        call_sites.extend(self._l3_import_chain_sites(parsed_files, kwarg_names))

        return PythonAnalysisResult(
            files_analyzed=sum(1 for parsed in parsed_files if parsed.tree is not None),
            files_skipped=sum(1 for parsed in parsed_files if parsed.tree is None),
            ai_call_sites=self._dedupe_sites(call_sites),
            import_map=import_map,
            unsupported_dynamic_flows=self._dedupe_flows(unsupported),
            coverage_limitation=bool(coverage_limitations),
            coverage_limitations=coverage_limitations,
        )

    def _parse_workspace(
        self,
        include_files: Iterable[str] | None = None,
    ) -> list[ParsedPythonFile]:
        parsed_files: list[ParsedPythonFile] = []

        if include_files is None:
            for path in sorted(self._workspace.rglob("*.py")):
                if not self._level_guard.allowed_path(path):
                    continue
                parsed_files.append(self._ast_parser.parse_file(path, self._workspace))
            return parsed_files

        workspace_resolved = self._workspace.resolve(strict=False)
        for relative_file in include_files:
            candidate = (self._workspace / relative_file).resolve(strict=False)
            try:
                candidate.relative_to(workspace_resolved)
            except ValueError:
                continue

            if not candidate.is_file() or candidate.suffix.lower() != ".py":
                continue
            if not self._level_guard.allowed_path(candidate):
                continue

            parsed_files.append(self._ast_parser.parse_file(candidate, self._workspace))

        parsed_files.sort(key=lambda parsed: parsed.relative_path)
        return parsed_files

    def _analyze_file(
        self,
        parsed: ParsedPythonFile,
        kwarg_names_by_line: dict[int, list[str]],
        analysis_level: str,
    ) -> tuple[list[AiCallSite], list[dict]]:
        assert parsed.tree is not None
        call_sites: list[AiCallSite] = []
        unsupported: list[dict] = []

        for node in ast.walk(parsed.tree):
            dynamic_flow = None
            if isinstance(node, ast.Call):
                dynamic_flow = self._level_guard.dynamic_flow_for_call(
                    node, parsed.relative_path
                )
                if dynamic_flow is not None:
                    unsupported.append(dynamic_flow)
                    call_sites.append(
                        self._dynamic_site(parsed.relative_path, node, dynamic_flow)
                    )
                    continue
                call_sites.extend(
                    self._sites_for_call(
                        parsed,
                        node,
                        kwarg_names_by_line.get(getattr(node, "lineno", 1), []),
                        analysis_level,
                    )
                )
            elif isinstance(node, (ast.JoinedStr, ast.Assign, ast.AnnAssign)):
                call_sites.extend(self._sites_for_prompt_node(parsed, node, analysis_level))

        return call_sites, unsupported

    def _sites_for_call(
        self,
        parsed: ParsedPythonFile,
        node: ast.Call,
        kwarg_names: list[str],
        analysis_level: str,
    ) -> list[AiCallSite]:
        call_name = self._call_name(node.func)
        if not call_name:
            return []

        package_candidates = self._packages_for_call(parsed.import_map, call_name)
        matched: list[AiCallSite] = []
        for rule in AI_RULE_TABLE:
            package = str(rule["package"])
            if package != "*" and package not in package_candidates:
                continue
            if not self._rule_matches(rule, call_name, kwarg_names):
                continue
            matched.append(
                AiCallSite(
                    file_path=parsed.relative_path,
                    line_number=getattr(node, "lineno", 1),
                    function_name=call_name.rsplit(".", 1)[-1],
                    module_alias=call_name.split(".", 1)[0],
                    matched_rule_id=str(rule["rule_id"]),
                    finding_type=str(rule["finding_type"]),
                    analysis_level=analysis_level,
                    call_args_schema=self._call_args_schema(node),
                    has_dynamic_call=False,
                    kwarg_names=list(kwarg_names),
                    confidence=round(float(rule["base_confidence"]), 2),
                    evidence=[
                        {
                            "file": parsed.relative_path,
                            "line": getattr(node, "lineno", 1),
                            "rule_id": str(rule["rule_id"]),
                            "call": call_name,
                            "arg_names": self._call_args_schema(node),
                            "kwarg_names": list(kwarg_names),
                        }
                    ],
                )
            )
        return matched

    def _sites_for_prompt_node(
        self, parsed: ParsedPythonFile, node: ast.AST, analysis_level: str
    ) -> list[AiCallSite]:
        names = {child.id for child in ast.walk(node) if isinstance(child, ast.Name)}
        candidates: list[AiCallSite] = []
        if any(name in names for name in ("SYSTEM_PROMPT", "system_prompt", "system_message")):
            rule = next(rule for rule in AI_RULE_TABLE if rule["rule_id"] == "py-system-prompt-variable")
            if isinstance(node, ast.JoinedStr):
                rule = next(rule for rule in AI_RULE_TABLE if rule["rule_id"] == "py-dynamic-prompt-ref")
            candidates.append(
                AiCallSite(
                    file_path=parsed.relative_path,
                    line_number=getattr(node, "lineno", 1),
                    function_name="prompt_reference",
                    module_alias="*",
                    matched_rule_id=str(rule["rule_id"]),
                    finding_type=str(rule["finding_type"]),
                    analysis_level=analysis_level,
                    call_args_schema=[],
                    has_dynamic_call=False,
                    kwarg_names=[],
                    confidence=round(float(rule["base_confidence"]), 2),
                    evidence=[
                        {
                            "file": parsed.relative_path,
                            "line": getattr(node, "lineno", 1),
                            "rule_id": str(rule["rule_id"]),
                            "symbols": sorted(names),
                        }
                    ],
                )
            )
        return candidates

    def _l3_import_chain_sites(
        self,
        parsed_files: list[ParsedPythonFile],
        kwarg_names_by_file: dict[str, dict[int, list[str]]],
    ) -> list[AiCallSite]:
        if self._max_l3_hops < 1:
            return []
        by_module = {
            self._module_name(parsed.relative_path): parsed
            for parsed in parsed_files
            if parsed.tree is not None
        }
        sites: list[AiCallSite] = []
        for parsed in parsed_files:
            if parsed.tree is None:
                continue
            imported_modules = {
                module for module, _symbol in parsed.imported_symbols.values() if module
            }
            for module in imported_modules:
                target = by_module.get(module)
                if target is None or target is parsed:
                    continue
                target_kwarg_names = kwarg_names_by_file.get(target.relative_path, {})
                target_sites, _flows = self._analyze_file(target, target_kwarg_names, "L3")
                sites.extend(target_sites)
        return sites

    def _dynamic_site(
        self, relative_path: str, node: ast.Call, dynamic_flow: dict
    ) -> AiCallSite:
        return AiCallSite(
            file_path=relative_path,
            line_number=getattr(node, "lineno", 1),
            function_name="dynamic_call",
            module_alias="*",
            matched_rule_id="py-unsupported-dynamic-flow",
            finding_type="UNSUPPORTED_DYNAMIC_FLOW",
            analysis_level="L3",
            call_args_schema=self._call_args_schema(node),
            has_dynamic_call=True,
            kwarg_names=[keyword.arg for keyword in node.keywords if keyword.arg],
            confidence=1.0,
            evidence=[
                {
                    "file": relative_path,
                    "line": dynamic_flow.get("line"),
                    "reason": dynamic_flow.get("reason"),
                }
            ],
        )

    def _rule_matches(self, rule: dict, call_name: str, kwarg_names: list[str]) -> bool:
        patterns = [str(pattern) for pattern in rule["pattern"]]
        rule_id = str(rule["rule_id"])
        if rule_id.endswith("model-kwarg"):
            return "model" in kwarg_names
        return any(self._pattern_matches(pattern, call_name) for pattern in patterns)

    def _pattern_matches(self, pattern: str, call_name: str) -> bool:
        cleaned = pattern.replace("(", "").replace(")", "")
        if cleaned.startswith("."):
            return call_name.endswith(cleaned[1:])
        return call_name == cleaned or call_name.endswith(f".{cleaned}") or cleaned in call_name

    def _packages_for_call(self, import_map: dict[str, str], call_name: str) -> set[str]:
        alias = call_name.split(".", 1)[0]
        packages = {import_map.get(alias, alias)}
        packages.update(import_map.values())
        if any(name in packages for name in ("sklearn", "tensorflow", "keras", "torch")):
            packages.add("*")
        return packages

    def _call_name(self, node: ast.AST) -> str:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = self._call_name(node.value)
            return f"{base}.{node.attr}" if base else node.attr
        if isinstance(node, ast.Call):
            return self._call_name(node.func)
        return ""

    def _call_args_schema(self, node: ast.Call) -> list[str]:
        return [f"position_{idx}" for idx, _arg in enumerate(node.args)] + [
            keyword.arg for keyword in node.keywords if keyword.arg is not None
        ]

    def _module_name(self, relative_path: str) -> str:
        path = Path(relative_path)
        if path.name == "__init__.py":
            return ".".join(path.parent.parts)
        return ".".join(path.with_suffix("").parts)

    def _dedupe_sites(self, sites: Iterable[AiCallSite]) -> list[AiCallSite]:
        seen: set[tuple[str, int, str, str, str]] = set()
        deduped: list[AiCallSite] = []
        for site in sites:
            key = (
                site.file_path,
                site.line_number,
                site.matched_rule_id,
                site.finding_type,
                site.analysis_level,
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(site)
        return deduped

    def _dedupe_flows(self, flows: Iterable[dict]) -> list[dict]:
        seen: set[tuple[str, object, object]] = set()
        deduped: list[dict] = []
        for flow in flows:
            key = (str(flow.get("file")), flow.get("line"), flow.get("reason"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(flow)
        return deduped

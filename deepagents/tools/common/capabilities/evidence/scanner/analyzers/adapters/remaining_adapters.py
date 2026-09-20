"""Bounded structural and explicit-recognition adapters for remaining LCSP languages."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Sequence

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_PARTIAL,
    ANALYZER_UNSUPPORTED,
    AnalyzerCapability,
    CanonicalAnalyzerResult,
)


_STRUCTURAL = {"c", "cpp", "shell", "powershell", "sql", "solidity"}
_EXTENSIONS = {
    "scala": {".scala"}, "elixir": {".ex", ".exs"}, "clojure": {".clj", ".cljs", ".cljc"},
    "c": {".c", ".h"}, "cpp": {".cc", ".cpp", ".cxx", ".hpp", ".hh"},
    "shell": {".sh", ".bash", ".zsh"}, "powershell": {".ps1", ".psm1"},
    "sql": {".sql"}, "lua": {".lua"}, "r": {".r"}, "haskell": {".hs"}, "solidity": {".sol"},
}


class RemainingLanguageAdapter:
    language = ""

    def supports(self, language: str) -> bool:
        return language == self.language

    def capabilities(self) -> AnalyzerCapability:
        structural = self.language in _STRUCTURAL
        return AnalyzerCapability(
            symbols=structural,
            imports=structural,
            calls=structural,
            dependencies=False,
            dynamic_resolution=False,
            framework_semantics=False,
            ai_invocations=False,
        )

    def analyze(self, workspace: Path, include_files: Sequence[str] | None) -> CanonicalAnalyzerResult:
        files = self._files(workspace, include_files)
        if self.language not in _STRUCTURAL:
            return CanonicalAnalyzerResult(
                language=self.language,
                status=ANALYZER_UNSUPPORTED,
                capabilities=self.capabilities(),
                files_analyzed=0,
                files_skipped=len(files),
                coverage_limitations=(f"{self.language}_recognized_only_static_semantics_unavailable",),
            )
        program = SemanticProgram()
        limitations: list[str] = []
        analyzed = 0
        skipped = 0
        for rel in files:
            try:
                text = (workspace / rel).read_text(encoding="utf-8", errors="replace")
            except OSError:
                skipped += 1
                limitations.append(f"{self.language}_read_failed:file={rel}")
                continue
            analyzed += 1
            self._extract(rel, text, program, limitations)
        return CanonicalAnalyzerResult(
            language=self.language,
            status=ANALYZER_PARTIAL,
            capabilities=self.capabilities(),
            native_result=program,
            files_analyzed=analyzed,
            files_skipped=skipped,
            coverage_limitations=tuple(sorted(set(limitations))),
            semantic_facts=tuple(program.nodes),
            structural_facts=tuple(program.nodes),
        )

    def _files(self, workspace: Path, include_files: Sequence[str] | None) -> tuple[str, ...]:
        allowed = _EXTENSIONS[self.language]
        if include_files is not None:
            return tuple(sorted(str(path).replace("\\", "/") for path in include_files if Path(str(path)).suffix.lower() in allowed))
        excluded = {".git", "build", "target", "vendor", "node_modules", "generated", "artifacts", "cache"}
        return tuple(sorted(path.relative_to(workspace).as_posix() for path in workspace.rglob("*") if path.is_file() and path.suffix.lower() in allowed and not any(part in excluded for part in path.parts)))

    def _extract(self, rel: str, text: str, program: SemanticProgram, limitations: list[str]) -> None:
        lines = text.splitlines() or [""]
        for line_no, line in enumerate(lines, 1):
            for kind, name in self._declarations(line):
                key = f"remaining:{self.language}:{rel}:{line_no}:{kind}:{name}"
                program.add_node(SemanticNodeFact(key, kind, name, rel, line_no, line_no, symbol_ref=name, attributes={"language": self.language, "coverage": "STRUCTURAL"}, semantic_types=(kind,)))
            for imported in self._imports(line):
                key = f"remaining:{self.language}:{rel}:{line_no}:import:{imported}"
                program.add_node(SemanticNodeFact(key, "PACKAGE_DEPENDENCY", imported, rel, line_no, line_no, attributes={"language": self.language, "import": imported}, semantic_types=("PACKAGE_DEPENDENCY",)))
            for call in self._calls(line):
                key = f"remaining:{self.language}:{rel}:{line_no}:call:{call}"
                program.add_node(SemanticNodeFact(key, "CALL_SITE", call, rel, line_no, line_no, attributes={"language": self.language, "resolution": "UNRESOLVED"}, resolution_state="UNRESOLVED"))
        if self.language in {"c", "cpp"} and re.search(r"#\s*if|#\s*define", text):
            limitations.append(f"{self.language}_preprocessor_semantics_partial:file={rel}")
        if re.search(r"\b(eval|Invoke-Expression|source\s+\$|\$\{?\w+\}?\s*\(|call\s*\(|delegatecall|staticcall)\b", text, re.I):
            limitations.append(f"{self.language}_dynamic_execution_unresolved:file={rel}")

    def _declarations(self, line: str) -> list[tuple[str, str]]:
        patterns = {
            "c": [("FUNCTION", r"\b(?:[A-Za-z_]\w*\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{")],
            "cpp": [("CLASS", r"\b(?:class|struct)\s+([A-Za-z_]\w*)"), ("FUNCTION", r"\b([A-Za-z_]\w*)\s*\([^;]*\)\s*\{")],
            "shell": [("FUNCTION", r"\b([A-Za-z_]\w*)\s*\(\s*\)\s*\{")],
            "powershell": [("FUNCTION", r"\bfunction\s+([A-Za-z_-][\w-]*)")],
            "sql": [("TABLE", r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\[\]`\"']?([\w.-]+)")],
            "solidity": [("CLASS", r"\b(?:contract|interface|library)\s+([A-Za-z_]\w*)"), ("FUNCTION", r"\bfunction\s+([A-Za-z_]\w*)"), ("EVENT", r"\bevent\s+([A-Za-z_]\w*)")],
        }.get(self.language, [])
        result = []
        for kind, pattern in patterns:
            result.extend((kind, match.group(1)) for match in re.finditer(pattern, line, re.I))
        return result

    def _imports(self, line: str) -> list[str]:
        if self.language in {"c", "cpp"}:
            return re.findall(r"#\s*include\s*[<\"]([^>\"]+)", line)
        if self.language == "shell":
            return re.findall(r"\b(?:source|\.)\s+([^\s;]+)", line)
        if self.language == "powershell":
            return re.findall(r"\bImport-Module\s+['\"]?([^'\"\s]+)", line, re.I)
        return []

    def _calls(self, line: str) -> list[str]:
        if self.language == "sql":
            return []
        if self.language == "shell":
            return re.findall(r"\b(?:curl|wget|python|node|ruby|go|pwsh|bash|sh)\b", line)
        if self.language == "powershell":
            return re.findall(r"\b(?:Invoke-RestMethod|Invoke-WebRequest|Start-Process|[A-Z][A-Za-z]+-[A-Za-z]+)\b", line)
        return [match.group(1) for match in re.finditer(r"\b([A-Za-z_]\w*)\s*\(", line) if match.group(1) not in {"if", "for", "while", "switch"}]


class ScalaLanguageAdapter(RemainingLanguageAdapter): language = "scala"
class ElixirLanguageAdapter(RemainingLanguageAdapter): language = "elixir"
class ClojureLanguageAdapter(RemainingLanguageAdapter): language = "clojure"
class CLanguageAdapter(RemainingLanguageAdapter): language = "c"
class CppLanguageAdapter(RemainingLanguageAdapter): language = "cpp"
class ShellLanguageAdapter(RemainingLanguageAdapter): language = "shell"
class PowerShellLanguageAdapter(RemainingLanguageAdapter): language = "powershell"
class SqlLanguageAdapter(RemainingLanguageAdapter): language = "sql"
class LuaLanguageAdapter(RemainingLanguageAdapter): language = "lua"
class RLanguageAdapter(RemainingLanguageAdapter): language = "r"
class HaskellLanguageAdapter(RemainingLanguageAdapter): language = "haskell"
class SolidityLanguageAdapter(RemainingLanguageAdapter): language = "solidity"

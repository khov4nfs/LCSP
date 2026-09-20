from __future__ import annotations

from dataclasses import dataclass, field


LANGUAGE_PYTHON = "python"
LANGUAGE_TYPESCRIPT = "typescript"
LANGUAGE_JAVASCRIPT = "javascript"
LANGUAGE_JAVA = "java"
LANGUAGE_KOTLIN = "kotlin"
LANGUAGE_GO = "go"
LANGUAGE_CSHARP = "csharp"
LANGUAGE_RUST = "rust"
LANGUAGE_RUBY = "ruby"
LANGUAGE_SWIFT = "swift"
LANGUAGE_OBJECTIVE_C = "objc"
LANGUAGE_DART = "dart"
LANGUAGE_SCALA = "scala"
LANGUAGE_ELIXIR = "elixir"
LANGUAGE_CLOJURE = "clojure"
LANGUAGE_C = "c"
LANGUAGE_CPP = "cpp"
LANGUAGE_SHELL = "shell"
LANGUAGE_POWERSHELL = "powershell"
LANGUAGE_SQL = "sql"
LANGUAGE_LUA = "lua"
LANGUAGE_R = "r"
LANGUAGE_HASKELL = "haskell"
LANGUAGE_SOLIDITY = "solidity"
LANGUAGE_YAML = "yaml"
LANGUAGE_JSON = "json"
LANGUAGE_OTHER = "other"
LANGUAGE_BINARY = "binary"
LANGUAGE_UNKNOWN = "unknown"

SUPPORT_FULL = "FULL"
SUPPORT_BASIC = "BASIC"
SUPPORT_MANIFEST_ONLY = "MANIFEST_ONLY"
SUPPORT_SKIP = "SKIP"


@dataclass(frozen=True)
class LanguageClassification:
    file_path: str
    language: str
    support_level: str
    file_size_bytes: int
    line_count: int | None
    skip_reason: str | None
    coverage_limitation: bool


@dataclass(frozen=True)
class AnalyzerDispatch:
    python_files: list[str] = field(default_factory=list)
    ts_js_files: list[str] = field(default_factory=list)
    basic_files: list[str] = field(default_factory=list)
    skipped_files: list[str] = field(default_factory=list)
    coverage_limitations: list[dict[str, str]] = field(default_factory=list)
    semantic_files: dict[str, list[str]] = field(default_factory=dict)

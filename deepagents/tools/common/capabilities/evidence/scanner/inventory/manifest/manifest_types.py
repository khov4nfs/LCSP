from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ManifestFact:
    manifest_type: str
    file_path: str
    package_names: list[str] = field(default_factory=list)
    env_var_names: list[str] = field(default_factory=list)
    config_key_names: list[str] = field(default_factory=list)
    ai_relevant_signals: list[str] = field(default_factory=list)
    parse_error: bool = False


@dataclass(frozen=True)
class ManifestParseResult:
    facts: list[ManifestFact]
    coverage_limitations: list[str] = field(default_factory=list)

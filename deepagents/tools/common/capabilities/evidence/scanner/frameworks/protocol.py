from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticProgram


@dataclass(frozen=True)
class FrameworkCapability:
    routes: bool = False
    controllers: bool = False
    persistence_models: bool = False
    jobs: bool = False
    callbacks: bool = False
    dynamic_resolution: bool = False


@dataclass(frozen=True)
class FrameworkAnalysisResult:
    framework: str
    project_id: str
    status: str
    capabilities: FrameworkCapability
    semantic_program: SemanticProgram = field(default_factory=SemanticProgram)
    coverage_limitations: tuple[str, ...] = ()
    evidence: tuple[str, ...] = ()


class FrameworkDetector(Protocol):
    name: str

    def detect(self, project, workspace: Path, language_result: Any) -> tuple[str, ...]: ...


class FrameworkAdapter(Protocol):
    framework: str

    def supports(self, framework: str) -> bool: ...

    def capabilities(self) -> FrameworkCapability: ...

    def analyze(self, project, workspace: Path, language_result: Any) -> FrameworkAnalysisResult: ...

"""Build deterministic project/language analyzer execution units."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Iterable

from ..language.language_types import LanguageClassification, SUPPORT_FULL
from ..language.language_classifier import is_excluded_source_path
from ...analyzers.registry import LanguageAnalyzerRegistry
from ...analyzers.protocol import ANALYZER_UNSUPPORTED
from .project_types import (
    AnalyzerExecutionUnit,
    ProjectDiscoveryResult,
    ProjectExecutionPlan,
    ProjectLanguageResult,
)


REPOSITORY_PROJECT_ID = "repository-unowned"
_UNSUPPORTED_CODE_LANGUAGES = frozenset(
    {
        "go",
        "java",
        "kotlin",
        "php",
        "ruby",
        "rust",
        "swift",
        "objc",
        "dart",
    }
)


class ProjectExecutionPlanner:
    """Partition classified files once and coalesce TS/JS per project."""

    def build(
        self,
        workspace: Path,
        discovery: ProjectDiscoveryResult,
        classifications: Iterable[LanguageClassification],
        registry: LanguageAnalyzerRegistry,
    ) -> ProjectExecutionPlan:
        descriptors = {project.project_id: project for project in discovery.projects}
        grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
        non_semantic: list[ProjectLanguageResult] = []
        for classification in classifications:
            if is_excluded_source_path(classification.file_path):
                continue
            if classification.support_level != SUPPORT_FULL:
                if classification.language in _UNSUPPORTED_CODE_LANGUAGES:
                    project_id = discovery.file_ownership.get(
                        classification.file_path, REPOSITORY_PROJECT_ID
                    )
                    non_semantic.append(
                        ProjectLanguageResult(
                            project_id=project_id,
                            language=classification.language,
                            analyzer=None,
                            status=ANALYZER_UNSUPPORTED,
                            files=(classification.file_path,),
                            coverage_limitations=(
                                "no semantic analyzer registered",
                            ),
                        )
                    )
                continue
            project_id = discovery.file_ownership.get(classification.file_path, REPOSITORY_PROJECT_ID)
            project = descriptors.get(project_id)
            language = classification.language
            adapter = registry.resolve(language)
            if adapter is None:
                non_semantic.append(
                    ProjectLanguageResult(
                        project_id=project_id,
                        language=language,
                        analyzer=None,
                        status=ANALYZER_UNSUPPORTED,
                        files=(classification.file_path,),
                        coverage_limitations=("no semantic analyzer registered",),
                    )
                )
                continue
            grouped[(project_id, adapter.language)].append(classification.file_path)

        units: list[AnalyzerExecutionUnit] = []
        for (project_id, analyzer_language), files in sorted(grouped.items()):
            project = descriptors.get(project_id)
            root = project.root_path if project is not None else workspace
            # TS and JS intentionally share the adapter language and one unit.
            source_language = "typescript" if analyzer_language == "ts_js" else analyzer_language
            adapter = registry.resolve(source_language)
            units.append(
                AnalyzerExecutionUnit(
                    project_id=project_id,
                    project_root=root,
                    language=source_language,
                    files=tuple(sorted(set(files))),
                    analyzer=adapter.language if adapter is not None else None,
                    capabilities=adapter.capabilities() if adapter is not None else None,
                )
            )
        return ProjectExecutionPlan(
            units=tuple(units),
            non_semantic_results=tuple(
                sorted(non_semantic, key=lambda item: (item.project_id, item.language, item.files))
            ),
        )

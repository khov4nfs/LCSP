"""Project-aware aggregation without changing native analyzer result contracts."""
from __future__ import annotations

from collections.abc import Iterable

from .project_types import ProjectDescriptor, ProjectLanguageResult, ProjectScanResult


def aggregate_project_results(
    projects: Iterable[ProjectDescriptor],
    language_results: Iterable[ProjectLanguageResult],
    limitations: Iterable[str] = (),
) -> tuple[ProjectScanResult, ...]:
    by_project: dict[str, list[ProjectLanguageResult]] = {project.project_id: [] for project in projects}
    for result in language_results:
        by_project.setdefault(result.project_id, []).append(result)
    return tuple(
        ProjectScanResult(
            project_id=project_id,
            language_results=tuple(sorted(results, key=lambda item: (item.language, item.analyzer or ""))),
            limitations=tuple(sorted(set(limitations))),
        )
        for project_id, results in sorted(by_project.items())
    )

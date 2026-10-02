"""The subject/customer repository is hydrated into the sandbox at this root.

It is the only runtime target for Codebase Memory and the agent's native filesystem
tools; the LCSP platform repository is never a runtime audit target.
"""

from __future__ import annotations

import os
from collections.abc import Callable

from .repository_sandbox import REPOSITORY_ROOT

SUBJECT_REPOSITORY_ROOT = REPOSITORY_ROOT
LIMITATION_CODES = {
    "subjectRootInvalid": "SUBJECT_REPOSITORY_ROOT_INVALID",
    "platformRepoRejected": "PLATFORM_REPO_REJECTED",
}
_PLATFORM_MARKERS = (
    ("deepagents", "packages/contracts"),
    ("apps/api", "apps/web", "deepagents"),
)


class SubjectRepositoryRootError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def is_platform_repo_path(
    repo_root: str, *, exists: Callable[[str], bool] | None = None
) -> bool:
    if not repo_root:
        return False
    probe = exists or os.path.exists
    root = str(repo_root).rstrip("/")
    return any(
        all(probe(os.path.join(root, marker)) for marker in markers)
        for markers in _PLATFORM_MARKERS
    )


def validate_subject_repo_root(
    repo_root: str,
    *,
    benchmark_mode: bool = False,
    exists: Callable[[str], bool] | None = None,
) -> str:
    root = str(repo_root or "").rstrip("/")
    if benchmark_mode and root:
        return root
    if root != SUBJECT_REPOSITORY_ROOT:
        code = (
            LIMITATION_CODES["platformRepoRejected"]
            if is_platform_repo_path(root, exists=exists)
            else LIMITATION_CODES["subjectRootInvalid"]
        )
        raise SubjectRepositoryRootError(
            code, "repository root is not the hydrated subject repository"
        )
    if is_platform_repo_path(root, exists=exists):
        raise SubjectRepositoryRootError(
            LIMITATION_CODES["platformRepoRejected"],
            "the hydrated repository looks like the LCSP platform repository",
        )
    return root

__all__ = [
    "LIMITATION_CODES",
    "SUBJECT_REPOSITORY_ROOT",
    "SubjectRepositoryRootError",
    "is_platform_repo_path",
    "validate_subject_repo_root",
]

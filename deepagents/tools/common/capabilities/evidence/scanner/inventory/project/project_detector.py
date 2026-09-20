from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .project_types import ProjectDescriptor


class ProjectDetector(Protocol):
    name: str

    def detect(self, workspace: Path) -> tuple[ProjectDescriptor, ...]: ...

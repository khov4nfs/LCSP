from __future__ import annotations

import os
from pathlib import Path

from tools.common.capabilities.platform.logging_path import get_repo_root

DEFAULT_LEGAL_CHROMA_DIR = ".chorma"


def default_legal_chroma_path() -> Path:
    configured = os.getenv("LEGAL_CHROMA_PATH", "").strip()
    if configured:
        path = Path(configured)
        return path if path.is_absolute() else Path(get_repo_root()) / path
    return Path(get_repo_root()) / DEFAULT_LEGAL_CHROMA_DIR


def resolve_legal_chroma_path(chroma_path: str | Path | None = None) -> str:
    if chroma_path is None or str(chroma_path).strip() == "":
        return str(default_legal_chroma_path())
    path = Path(chroma_path)
    return str(path if path.is_absolute() else Path(get_repo_root()) / path)

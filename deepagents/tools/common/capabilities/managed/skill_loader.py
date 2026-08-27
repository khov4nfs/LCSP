"""Load checked-in Managed Deep Agent skills for bounded specialist prompts."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SKILLS_ROOT = PROJECT_ROOT / "skills"


@lru_cache(maxsize=16)
def load_project_skill(name: str) -> str:
    """Return one checked-in skill body by canonical project skill name."""
    normalized = name.strip()
    if not normalized or any(part in normalized for part in ("/", "\\", "..")):
        raise ValueError("project skill name must be a single canonical directory name")

    skill_path = SKILLS_ROOT / normalized / "SKILL.md"
    if not skill_path.is_file():
        raise FileNotFoundError(f"project skill not found: {normalized}")

    content = skill_path.read_text(encoding="utf-8").strip()
    if not content:
        raise ValueError(f"project skill is empty: {normalized}")
    return content

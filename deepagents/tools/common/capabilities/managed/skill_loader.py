"""Load checked-in Managed Deep Agent skills for bounded specialist prompts."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SKILLS_ROOT = PROJECT_ROOT / "skills"


def _normalize_project_skill_name(name: str) -> str:
    normalized = name.strip()
    if not normalized or any(part in normalized for part in ("/", "\\", "..")):
        raise ValueError("project skill name must be a single canonical directory name")
    return normalized


def _read_required_text(path: Path, label: str) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"project skill {label} not found: {path.name}")
    content = path.read_text(encoding="utf-8").strip()
    if not content:
        raise ValueError(f"project skill {label} is empty: {path.name}")
    return content


@lru_cache(maxsize=16)
def load_project_skill(name: str) -> str:
    """Return one checked-in skill body by canonical project skill name."""
    normalized = _normalize_project_skill_name(name)
    return _read_required_text(SKILLS_ROOT / normalized / "SKILL.md", normalized)


def _normalize_reference_path(reference: str) -> Path:
    rel = Path(reference.strip())
    if (
        not reference.strip()
        or rel.is_absolute()
        or ".." in rel.parts
        or len(rel.parts) < 2
        or rel.parts[0] != "references"
        or rel.suffix != ".md"
    ):
        raise ValueError(
            "skill references must be bounded markdown files under references/"
        )
    return rel


@lru_cache(maxsize=16)
def load_project_skill_package(
    name: str,
    references: tuple[str, ...] = (),
) -> str:
    """Return a skill body plus selected checked-in references.

    Specialist prompts use this when a Skill's protected/adaptive rules live in
    reference files rather than only in the top-level SKILL.md. References are
    bounded to the same skill package and deterministic markdown files.
    """
    normalized = _normalize_project_skill_name(name)
    package_root = SKILLS_ROOT / normalized
    sections = [load_project_skill(normalized)]
    seen: set[str] = set()
    for reference in references:
        rel = _normalize_reference_path(reference)
        rel_key = rel.as_posix()
        if rel_key in seen:
            continue
        seen.add(rel_key)
        body = _read_required_text(package_root / rel, rel_key)
        sections.append(
            f"## Checked-in skill reference: `{rel_key}`\n\n{body}"
        )
    return "\n\n---\n\n".join(sections)

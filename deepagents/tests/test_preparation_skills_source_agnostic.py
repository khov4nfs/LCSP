"""Guard general reusable skills against named-law fixture contamination."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] / "skills"


def test_preparation_skills_are_source_agnostic():
    for directory in ROOT.glob("rule-preparation-*"):
        for filename in ("SKILL.md", "SKILL.vi.md"):
            text = (directory / filename).read_text(encoding="utf-8")
            assert not re.search(r"\b(?:Law|Luật)\s+(?:134|71)\b", text), (directory, filename)
            assert "pinned" in text.lower() or "nguồn" in text.lower() or "source" in text.lower()

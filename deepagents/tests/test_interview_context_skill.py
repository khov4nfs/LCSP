from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from tools.common.capabilities.managed.skill_loader import (
    load_project_skill,
    load_project_skill_package,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PROJECT_ROOT.parent
SKILL_ROOT = PROJECT_ROOT / "skills" / "interview-context"
FROZEN_SKILL_ROOT = (
    REPO_ROOT
    / "frozen"
    / "interview-agent-frozen"
    / "LCSP_Interview_Context_Skill_Pack"
    / "en"
    / "deepagents"
    / "skills"
    / "interview-context"
)


def _relative_files(root: Path) -> set[str]:
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts
    }


def test_interview_context_skill_package_matches_frozen_english_pack() -> None:
    actual_files = _relative_files(SKILL_ROOT)
    frozen_files = _relative_files(FROZEN_SKILL_ROOT)

    assert actual_files == frozen_files
    for relative_path in sorted(actual_files):
        assert (SKILL_ROOT / relative_path).read_bytes() == (
            FROZEN_SKILL_ROOT / relative_path
        ).read_bytes(), relative_path


def test_interview_context_skill_lint_contract_passes() -> None:
    result = subprocess.run(
        [sys.executable, "-S", str(SKILL_ROOT / "evals" / "lint_contract.py")],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "CONTRACT LINT OK" in result.stdout


def test_interview_context_skill_lint_mutation_guards_reject_regressions() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-S",
            str(SKILL_ROOT / "evals" / "test_linter_mutations.py"),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "LINT GUARD MUTATION TESTS OK" in result.stdout


def test_interview_context_runtime_prompt_includes_protected_and_adaptive_rules() -> None:
    from subagents.interview.definition import (  # noqa: PLC0415
        INTERVIEW_SKILL,
        INTERVIEW_SKILL_REFERENCES,
        SYSTEM_PROMPT,
    )

    assert load_project_skill("interview-context").startswith("---\nname: interview-context")
    assert "references/protected-boundaries.md" in INTERVIEW_SKILL_REFERENCES
    assert "references/adaptive-rules.md" in INTERVIEW_SKILL_REFERENCES
    assert "references/agent-runtime-contract.md" in INTERVIEW_SKILL_REFERENCES
    assert "PR-IA-018 — Protected Sufficiency Guardrails" in INTERVIEW_SKILL
    assert "AR-IA-001 — Materiality first" in INTERVIEW_SKILL
    assert "Validated runtime and governed assessment state" in INTERVIEW_SKILL
    assert "Customer-safe evidence explanation" in INTERVIEW_SKILL
    assert "`PRE_PLANNER` is a legacy compatibility alias" in INTERVIEW_SKILL
    assert "## Checked-in Interview skill" in SYSTEM_PROMPT
    assert "PR-IA-018 — Protected Sufficiency Guardrails" in SYSTEM_PROMPT
    assert "AR-IA-001 — Materiality first" in SYSTEM_PROMPT


def test_skill_package_loader_rejects_unbounded_reference_paths() -> None:
    with pytest.raises(ValueError):
        load_project_skill_package("interview-context", ("../outside.md",))
    with pytest.raises(ValueError):
        load_project_skill_package("interview-context", ("evals/evals.json",))

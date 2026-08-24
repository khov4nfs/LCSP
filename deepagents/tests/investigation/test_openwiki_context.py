from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

import pytest

from tools.planner.investigation.openwiki_context import (
    OPENWIKI_HINT_AUTHORITY,
    OpenWikiContextProvider,
    OpenWikiContextRequiredError,
)


class Candidate:
    concept = "HUMAN_OVERSIGHT"
    engineering_rule_id = "rule-human-oversight"
    required_evidence = ("HUMAN_REVIEW_PATH",)
    starting_node_types = ("AI_MODEL_INVOCATION",)
    target_node_types = ("HUMAN_REVIEW",)


def test_openwiki_context_is_absent_when_wiki_is_not_generated(tmp_path, monkeypatch) -> None:
    context = OpenWikiContextProvider(tmp_path).collect_for_candidates([Candidate()])

    assert context["available"] is False
    assert context["authority"] == OPENWIKI_HINT_AUTHORITY
    assert context["hintCount"] == 0

    monkeypatch.setenv("OPENWIKI_RUNTIME_COMMAND", "missing-openwiki-runtime-command")
    with pytest.raises(OpenWikiContextRequiredError, match="OPENWIKI_RUNTIME_COMMAND_UNAVAILABLE"):
        OpenWikiContextProvider(tmp_path).collect_required_for_candidates([Candidate()])


def test_openwiki_context_returns_bounded_unverified_hints(tmp_path) -> None:
    wiki = tmp_path / "openwiki" / "architecture"
    wiki.mkdir(parents=True)
    (wiki / "overview.md").write_text(
        "# Runtime Architecture\n\n"
        "The AI model invocation feeds a human review workflow before approval.",
        encoding="utf-8",
    )

    context = OpenWikiContextProvider(tmp_path).collect_for_candidates([Candidate()])

    assert context["available"] is True
    assert context["authority"] == OPENWIKI_HINT_AUTHORITY
    assert context["hintCount"] == 1
    assert context["hints"][0]["path"] == "openwiki/architecture/overview.md"
    assert context["hints"][0]["authority"] == OPENWIKI_HINT_AUTHORITY
    assert "source evidence" in context["hints"][0]["policy"]
    assert "human review workflow" in context["hints"][0]["snippet"].lower()


def test_required_openwiki_context_rejects_empty_matches(tmp_path) -> None:
    wiki = tmp_path / "openwiki"
    wiki.mkdir()
    (wiki / "overview.md").write_text(
        "# Architecture\n\nOnly billing exports are documented here.",
        encoding="utf-8",
    )

    with pytest.raises(OpenWikiContextRequiredError, match="OPENWIKI_HINTS_NOT_MATERIAL"):
        OpenWikiContextProvider(tmp_path).collect_required_for_candidates([Candidate()])


def test_required_openwiki_context_generates_missing_wiki_at_runtime(
    tmp_path,
    monkeypatch,
) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_openwiki = bin_dir / "fake-openwiki"
    fake_openwiki.write_text(
        "#!/bin/sh\n"
        "mkdir -p openwiki/architecture\n"
        "printf '%s\\n' '# Runtime Architecture' "
        "'AI model invocation reaches a human review workflow.' "
        "> openwiki/architecture/overview.md\n",
        encoding="utf-8",
    )
    fake_openwiki.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    monkeypatch.setenv("OPENWIKI_RUNTIME_COMMAND", "fake-openwiki")

    context = OpenWikiContextProvider(tmp_path).collect_required_for_candidates(
        [Candidate()]
    )

    assert context["available"] is True
    assert context["hintCount"] == 1
    assert context["hints"][0]["path"] == "openwiki/architecture/overview.md"


def test_repo_openwiki_runtime_script_generates_required_hints(tmp_path, monkeypatch) -> None:
    (tmp_path / "package.json").write_text(
        '{"dependencies":{"@ai-sdk/openai":"latest","next":"latest"}}',
        encoding="utf-8",
    )
    app_dir = tmp_path / "apps" / "api" / "src"
    app_dir.mkdir(parents=True)
    (app_dir / "classification-route.ts").write_text("placeholder", encoding="utf-8")

    repo_root = Path(__file__).resolve().parents[3]
    script = repo_root / "scripts" / "openwiki_runtime.py"
    subprocess.run(
        [sys.executable, str(script)],
        cwd=tmp_path,
        check=True,
        text=True,
        capture_output=True,
    )
    monkeypatch.setenv(
        "OPENWIKI_RUNTIME_COMMAND",
        f"{sys.executable} {script}",
    )

    context = OpenWikiContextProvider(tmp_path).collect_required_for_candidates(
        [Candidate()]
    )

    assert context["available"] is True
    assert context["hintCount"] >= 1
    assert (tmp_path / "openwiki" / "architecture" / "overview.md").is_file()

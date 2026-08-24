"""OpenWiki documentation hints for EngineeringRule planning."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shlex
import shutil
import subprocess
from typing import Any, Iterable


OPENWIKI_HINT_AUTHORITY = "UNVERIFIED_ARCHITECTURE_HINT"
OPENWIKI_HINT_POLICY = (
    "May prioritize planner investigation only. Must not satisfy legal citations, "
    "source evidence, compliance, or gap classification."
)
_MAX_FILES = 12
_MAX_FILE_CHARS = 4000
_MAX_SNIPPETS = 8
_MAX_SNIPPET_CHARS = 700
_SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build"}
_DEFAULT_OPENWIKI_RUNTIME_COMMAND = "openwiki --init --print"
_DEFAULT_OPENWIKI_TIMEOUT_SECONDS = 180


class OpenWikiContextRequiredError(RuntimeError):
    pass


@dataclass(frozen=True)
class OpenWikiHint:
    path: str
    title: str
    snippet: str
    matched_terms: tuple[str, ...]

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "title": self.title,
            "snippet": self.snippet,
            "matchedTerms": list(self.matched_terms),
            "authority": OPENWIKI_HINT_AUTHORITY,
            "policy": OPENWIKI_HINT_POLICY,
        }


class OpenWikiContextProvider:
    """Read generated OpenWiki docs as unverified planner hints.

    OpenWiki output is synthesized documentation. It is intentionally excluded from
    evidence refs and source anchors; downstream claims still need graph/source proof.
    """

    def __init__(self, workspace_path: str | Path | None = None) -> None:
        self._workspace_path = Path(workspace_path or ".").resolve()

    def collect_for_candidates(self, candidates: Iterable[Any]) -> dict[str, Any]:
        wiki_root = self._workspace_path / "openwiki"
        if not wiki_root.is_dir():
            return self._empty("OPENWIKI_NOT_AVAILABLE")

        terms = self._candidate_terms(candidates)
        if not terms:
            return self._empty("NO_CANDIDATE_TERMS")

        hints: list[OpenWikiHint] = []
        for path in self._markdown_files(wiki_root):
            try:
                text = path.read_text(encoding="utf-8")[:_MAX_FILE_CHARS]
            except OSError:
                continue
            matched = tuple(term for term in terms if term.lower() in text.lower())
            if not matched:
                continue
            hints.append(
                OpenWikiHint(
                    path=str(path.relative_to(self._workspace_path)),
                    title=self._title(text, path),
                    snippet=self._snippet(text, matched),
                    matched_terms=matched[:6],
                )
            )
            if len(hints) >= _MAX_SNIPPETS:
                break

        return {
            "source": "openwiki",
            "available": True,
            "authority": OPENWIKI_HINT_AUTHORITY,
            "policy": OPENWIKI_HINT_POLICY,
            "hintCount": len(hints),
            "hints": [hint.to_prompt_dict() for hint in hints],
        }

    def collect_required_for_candidates(self, candidates: Iterable[Any]) -> dict[str, Any]:
        self._ensure_openwiki_generated()
        context = self.collect_for_candidates(candidates)
        if not context.get("available"):
            raise OpenWikiContextRequiredError(
                str(context.get("reason") or "OPENWIKI_NOT_AVAILABLE")
            )
        if int(context.get("hintCount") or 0) <= 0:
            raise OpenWikiContextRequiredError("OPENWIKI_HINTS_NOT_MATERIAL")
        return context

    def _ensure_openwiki_generated(self) -> None:
        wiki_root = self._workspace_path / "openwiki"
        if wiki_root.is_dir():
            return

        command = os.getenv(
            "OPENWIKI_RUNTIME_COMMAND",
            _DEFAULT_OPENWIKI_RUNTIME_COMMAND,
        ).strip()
        if not command:
            raise OpenWikiContextRequiredError("OPENWIKI_RUNTIME_COMMAND_EMPTY")
        argv = shlex.split(command)
        executable = shutil.which(argv[0])
        if not executable:
            raise OpenWikiContextRequiredError("OPENWIKI_RUNTIME_COMMAND_UNAVAILABLE")
        argv[0] = executable

        try:
            subprocess.run(
                argv,
                cwd=self._workspace_path,
                text=True,
                capture_output=True,
                timeout=int(
                    os.getenv(
                        "OPENWIKI_RUNTIME_TIMEOUT_SECONDS",
                        str(_DEFAULT_OPENWIKI_TIMEOUT_SECONDS),
                    )
                ),
                check=True,
            )
        except subprocess.TimeoutExpired as error:
            raise OpenWikiContextRequiredError("OPENWIKI_RUNTIME_TIMEOUT") from error
        except (OSError, subprocess.CalledProcessError) as error:
            raise OpenWikiContextRequiredError("OPENWIKI_RUNTIME_FAILED") from error

        if not wiki_root.is_dir():
            raise OpenWikiContextRequiredError("OPENWIKI_RUNTIME_DID_NOT_WRITE_ARTIFACT")

    @staticmethod
    def _empty(reason: str) -> dict[str, Any]:
        return {
            "source": "openwiki",
            "available": False,
            "authority": OPENWIKI_HINT_AUTHORITY,
            "policy": OPENWIKI_HINT_POLICY,
            "reason": reason,
            "hintCount": 0,
            "hints": [],
        }

    @staticmethod
    def _candidate_terms(candidates: Iterable[Any]) -> tuple[str, ...]:
        terms: list[str] = []
        for candidate in candidates:
            values = [
                getattr(candidate, "concept", ""),
                getattr(candidate, "engineering_rule_id", ""),
                *getattr(candidate, "required_evidence", ()),
                *getattr(candidate, "starting_node_types", ()),
                *getattr(candidate, "target_node_types", ()),
            ]
            for value in values:
                for term in str(value).replace("::", "_").replace("-", "_").split("_"):
                    normalized = term.strip()
                    if len(normalized) >= 4:
                        terms.append(normalized)
        return tuple(dict.fromkeys(terms))[:80]

    @staticmethod
    def _markdown_files(wiki_root: Path) -> list[Path]:
        files: list[Path] = []
        for path in sorted(wiki_root.rglob("*.md")):
            if any(part in _SKIP_DIRS for part in path.parts):
                continue
            files.append(path)
            if len(files) >= _MAX_FILES:
                break
        return files

    @staticmethod
    def _title(text: str, path: Path) -> str:
        for line in text.splitlines():
            value = line.strip()
            if value.startswith("#"):
                return value.lstrip("#").strip()[:120]
        return path.stem[:120]

    @staticmethod
    def _snippet(text: str, matched_terms: tuple[str, ...]) -> str:
        lowered = text.lower()
        first_match = min(
            (lowered.find(term.lower()) for term in matched_terms if term.lower() in lowered),
            default=0,
        )
        start = max(0, first_match - 160)
        snippet = " ".join(text[start : start + _MAX_SNIPPET_CHARS].split())
        return snippet

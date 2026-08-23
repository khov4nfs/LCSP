#!/usr/bin/env python3
"""Generate bounded OpenWiki planner hints for an LCSP-scanned repository.

This runtime intentionally writes synthesized documentation only. It does not emit
source code, secrets, or claim-grade evidence; downstream LCSP validators still
require graph/source anchors for technical claims.
"""

from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
from typing import Any


SKIP_DIRS = {
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "openwiki",
}
MAX_FILES = 2500
MAX_PATHS = 80
MAX_DEPENDENCIES = 160

PLANNER_VOCABULARY = (
    "AI model invocation",
    "AI capability",
    "AI input",
    "AI output",
    "human review",
    "human oversight",
    "human authority",
    "decision path",
    "business decision",
    "classification",
    "classification dossier",
    "reclassification",
    "notification",
    "direct interaction",
    "disclosure",
    "transparency",
    "machine readable media",
    "public content notice",
    "deepfake label",
    "incident detection",
    "incident remediation",
    "incident report",
    "risk management",
    "data governance",
    "sensitive data",
    "personal data",
    "data sharing",
    "technical documentation",
    "logs",
    "explainability",
    "security control",
    "intrusion",
    "confidentiality",
    "audit evidence",
    "public service",
    "health",
    "education",
    "high risk",
    "medium risk",
    "manipulation",
    "vulnerable exploitation",
    "harmful fake content",
    "unlawful data",
    "intellectual property",
    "sandbox fraud",
)


def main() -> int:
    root = Path.cwd().resolve()
    wiki = root / "openwiki" / "architecture"
    wiki.mkdir(parents=True, exist_ok=True)

    files = list(_iter_files(root))
    manifests = _manifest_summaries(root)
    dependencies = _dependencies(root)
    top_dirs = _top_directories(files)
    keyword_hits = _keyword_hits(files, manifests, dependencies)

    (wiki / "overview.md").write_text(
        _overview(root, files, manifests, dependencies, top_dirs, keyword_hits),
        encoding="utf-8",
    )
    (wiki / "planner-index.md").write_text(
        _planner_index(keyword_hits),
        encoding="utf-8",
    )
    return 0


def _iter_files(root: Path):
    count = 0
    for path in sorted(root.rglob("*")):
        if count >= MAX_FILES:
            break
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        count += 1
        yield path


def _manifest_summaries(root: Path) -> list[str]:
    summaries: list[str] = []
    for name in ("package.json", "pyproject.toml", "pnpm-workspace.yaml"):
        for path in sorted(root.rglob(name)):
            if any(part in SKIP_DIRS for part in path.relative_to(root).parts):
                continue
            summaries.append(str(path.relative_to(root)))
            if len(summaries) >= 40:
                return summaries
    return summaries


def _dependencies(root: Path) -> list[str]:
    names: list[str] = []
    for package_json in sorted(root.rglob("package.json")):
        if any(part in SKIP_DIRS for part in package_json.relative_to(root).parts):
            continue
        try:
            data = json.loads(package_json.read_text(encoding="utf-8")[:120_000])
        except (OSError, json.JSONDecodeError):
            continue
        for key in (
            "dependencies",
            "devDependencies",
            "peerDependencies",
            "optionalDependencies",
        ):
            values = data.get(key)
            if isinstance(values, dict):
                names.extend(str(name) for name in values)
        if len(names) >= MAX_DEPENDENCIES:
            break
    return sorted(dict.fromkeys(names))[:MAX_DEPENDENCIES]


def _top_directories(files: list[Path]) -> list[str]:
    counts: Counter[str] = Counter()
    for path in files:
        parts = path.parts
        try:
            rel = path.relative_to(Path.cwd()).parts
        except ValueError:
            rel = parts
        if rel:
            counts[rel[0]] += 1
        if len(rel) >= 2:
            counts["/".join(rel[:2])] += 1
    return [f"{name} ({count} files)" for name, count in counts.most_common(40)]


def _keyword_hits(
    files: list[Path],
    manifests: list[str],
    dependencies: list[str],
) -> dict[str, int]:
    haystack = "\n".join(
        [
            *(str(path.relative_to(Path.cwd())) for path in files[:MAX_PATHS]),
            *manifests,
            *dependencies,
            *PLANNER_VOCABULARY,
        ]
    ).lower()
    result: dict[str, int] = {}
    for phrase in PLANNER_VOCABULARY:
        terms = [part for part in phrase.lower().replace("-", " ").split() if len(part) >= 4]
        score = sum(haystack.count(term) for term in terms)
        if score > 0:
            result[phrase] = score
    return dict(sorted(result.items(), key=lambda item: (-item[1], item[0])))


def _overview(
    root: Path,
    files: list[Path],
    manifests: list[str],
    dependencies: list[str],
    top_dirs: list[str],
    keyword_hits: dict[str, int],
) -> str:
    ext_counts = Counter(path.suffix.lower() or "[none]" for path in files)
    lines = [
        "# Runtime Architecture",
        "",
        "Authority: UNVERIFIED_ARCHITECTURE_HINT.",
        "Policy: planner prioritization only; not source evidence, legal citation, compliance proof, or gap classification.",
        "",
        f"Repository snapshot root: {root.name}.",
        f"Indexed files: {len(files)}.",
        "",
        "## File Mix",
        "",
        *_bullets(f"{ext}: {count}" for ext, count in ext_counts.most_common(20)),
        "",
        "## Primary Areas",
        "",
        *_bullets(top_dirs),
        "",
        "## Manifests",
        "",
        *_bullets(manifests or ["No supported manifests detected."]),
        "",
        "## Dependency Signals",
        "",
        *_bullets(dependencies[:80] or ["No package dependency names detected."]),
        "",
        "## Planning Concepts",
        "",
        *_bullets(f"{name} (signal score {score})" for name, score in keyword_hits.items()),
        "",
    ]
    return "\n".join(lines)


def _planner_index(keyword_hits: dict[str, int]) -> str:
    lines = [
        "# Planner Index",
        "",
        "Authority: UNVERIFIED_ARCHITECTURE_HINT.",
        "Policy: use these words only to choose investigation direction. Never use them as source evidence.",
        "",
        "The repository should be investigated for concrete source anchors before any legal or technical claim.",
        "",
        "## Investigation Terms",
        "",
        *_bullets(keyword_hits.keys()),
        "",
    ]
    return "\n".join(lines)


def _bullets(values) -> list[str]:
    return [f"- {value}" for value in values]


if __name__ == "__main__":
    raise SystemExit(main())

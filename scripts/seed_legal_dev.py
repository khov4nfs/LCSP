#!/usr/bin/env python3
"""One development entrypoint for LCSP legal corpus/rule/EngineeringRule seeding."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


DEFAULT_CORPUS_VERSION = "VN-LEGAL-2026-08"
_EXISTING_GOVERNED_CORPUS_MESSAGE = (
    "already exists and is not the same approved dev seed"
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    normalized_argv = list(sys.argv[1:] if argv is None else argv)
    if normalized_argv and normalized_argv[0] == "--":
        normalized_argv = normalized_argv[1:]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-version", default=DEFAULT_CORPUS_VERSION)
    parser.add_argument("--env-file", default=None)
    parser.add_argument("--chroma-path", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--strict-corpus",
        action="store_true",
        help="Fail instead of continuing when the corpus version already exists.",
    )
    return parser.parse_args(normalized_argv)


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    python_path = str(repo_root / "deepagents")
    env["PYTHONPATH"] = (
        python_path
        if not env.get("PYTHONPATH")
        else f"{python_path}{os.pathsep}{env['PYTHONPATH']}"
    )

    phases = [
        (
            "legal corpus",
            [
                sys.executable,
                str(repo_root / "scripts" / "seed_legal_corpus_dev.py"),
                "--corpus-version",
                args.corpus_version,
                *optional("--env-file", args.env_file),
                *optional("--chroma-path", args.chroma_path),
                *flag("--dry-run", args.dry_run),
            ],
        ),
    ]

    for phase_name, command in phases:
        print(f"[seed:legal:dev] {phase_name}")
        result = subprocess.run(
            command,
            cwd=repo_root,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        if result.returncode == 0:
            continue
        combined_output = f"{result.stdout}\n{result.stderr}"
        if (
            phase_name == "legal corpus"
            and not args.strict_corpus
            and _EXISTING_GOVERNED_CORPUS_MESSAGE in combined_output
        ):
            print(
                "[seed:legal:dev] legal corpus already exists with governed state; "
                "continuing with legal-rule and EngineeringRule phases."
            )
            continue
        return result.returncode
    return 0


def optional(name: str, value: str | None) -> list[str]:
    return [name, value] if value else []


def flag(name: str, enabled: bool) -> list[str]:
    return [name] if enabled else []


if __name__ == "__main__":
    raise SystemExit(main())

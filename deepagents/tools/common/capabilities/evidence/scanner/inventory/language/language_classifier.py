from __future__ import annotations

from pathlib import Path

from .language_types import (
    LANGUAGE_BINARY,
    LANGUAGE_CSHARP,
    LANGUAGE_GO,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_JAVA,
    LANGUAGE_JSON,
    LANGUAGE_KOTLIN,
    LANGUAGE_OTHER,
    LANGUAGE_PYTHON,
    LANGUAGE_RUST,
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_UNKNOWN,
    LANGUAGE_YAML,
    SUPPORT_BASIC,
    SUPPORT_FULL,
    SUPPORT_MANIFEST_ONLY,
    SUPPORT_SKIP,
    LanguageClassification,
)


DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
JSON_MANIFEST_MAX_BYTES = 100 * 1024

EXCLUDED_DIR_NAMES = {
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    ".git",
    "dist",
    "build",
    ".tox",
}

BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".mp3",
    ".mov",
    ".avi",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".7z",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".class",
    ".jar",
    ".pyc",
}

DOC_EXTENSIONS = {".md", ".rst", ".txt"}

CONFIG_EXTENSIONS = {".toml", ".cfg", ".ini", ".env"}

LOCK_FILE_NAMES = {
    "yarn.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "poetry.lock",
    "pdm.lock",
    "Pipfile.lock",
}


def _line_count(path: Path) -> int:
    # Only counts newlines from UTF-8 text; malformed bytes are ignored.
    text = path.read_text(encoding="utf-8", errors="ignore")
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


class LanguageClassifier:
    def __init__(self, *, max_file_size_bytes: int = DEFAULT_MAX_FILE_SIZE_BYTES) -> None:
        self._max_file_size_bytes = max_file_size_bytes

    def classify_workspace(self, workspace_path: str | Path) -> list[LanguageClassification]:
        import os

        workspace = Path(workspace_path).resolve(strict=False)
        results: list[LanguageClassification] = []

        for root, dirnames, filenames in os.walk(workspace):
            rel_root = Path(root).resolve(strict=False).relative_to(workspace).as_posix()
            if rel_root == ".":
                rel_root = ""

            dirnames[:] = [
                d
                for d in sorted(dirnames)
                if not self._is_excluded(f"{rel_root}/{d}" if rel_root else d)
            ]

            for filename in sorted(filenames):
                file_path = Path(root) / filename
                relative_path = file_path.resolve(strict=False).relative_to(workspace).as_posix()
                if self._is_excluded(relative_path):
                    continue
                try:
                    results.append(self._classify_file(file_path, relative_path))
                except OSError:
                    results.append(
                        LanguageClassification(
                            file_path=relative_path,
                            language=LANGUAGE_UNKNOWN,
                            support_level=SUPPORT_SKIP,
                            file_size_bytes=0,
                            line_count=None,
                            skip_reason="file_access_failed",
                            coverage_limitation=True,
                        )
                    )

        results.sort(key=lambda item: item.file_path)
        return results

    def _classify_file(self, file_path: Path, relative_path: str) -> LanguageClassification:
        file_size = file_path.stat().st_size

        if file_size > self._max_file_size_bytes:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_UNKNOWN,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="file_size_limit_exceeded",
                coverage_limitation=True,
            )

        if file_path.name.endswith(".d.ts"):
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_TYPESCRIPT,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="typescript_declaration_file",
                coverage_limitation=False,
            )

        if file_path.name.endswith(".min.js"):
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_JAVASCRIPT,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="minified_js_unsupported",
                coverage_limitation=True,
            )

        if file_path.name in LOCK_FILE_NAMES:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_OTHER,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="lock_file",
                coverage_limitation=False,
            )

        suffix = file_path.suffix.lower()
        if suffix in BINARY_EXTENSIONS:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_BINARY,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="binary_file_extension",
                coverage_limitation=True,
            )

        if self._is_binary(file_path):
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_BINARY,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="binary_content_detected",
                coverage_limitation=True,
            )

        line_count = _line_count(file_path)
        if suffix == ".js" and file_size > 10 * 1024 and line_count < 5:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_JAVASCRIPT,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason="minified_js_heuristic",
                coverage_limitation=True,
            )

        if suffix == ".py":
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_PYTHON,
                support_level=SUPPORT_FULL,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason=None,
                coverage_limitation=False,
            )

        if suffix in {".ts", ".tsx"}:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_TYPESCRIPT,
                support_level=SUPPORT_FULL,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason=None,
                coverage_limitation=False,
            )

        if suffix in {".js", ".jsx", ".mjs", ".cjs"}:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_JAVASCRIPT,
                support_level=SUPPORT_FULL,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason=None,
                coverage_limitation=False,
            )

        basic_language = {
            ".java": LANGUAGE_JAVA,
            ".kt": LANGUAGE_KOTLIN,
            ".kts": LANGUAGE_KOTLIN,
            ".go": LANGUAGE_GO,
            ".cs": LANGUAGE_CSHARP,
            ".rs": LANGUAGE_RUST,
        }.get(suffix)
        if basic_language is not None:
            return LanguageClassification(
                file_path=relative_path,
                language=basic_language,
                support_level=SUPPORT_BASIC,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason=None,
                coverage_limitation=False,
            )

        if suffix in {".yaml", ".yml"}:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_YAML,
                support_level=SUPPORT_BASIC,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason=None,
                coverage_limitation=False,
            )

        if suffix == ".json":
            support_level = SUPPORT_BASIC
            coverage_limitation = False
            if file_size > JSON_MANIFEST_MAX_BYTES:
                support_level = SUPPORT_MANIFEST_ONLY
                coverage_limitation = True

            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_JSON,
                support_level=support_level,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason=None,
                coverage_limitation=coverage_limitation,
            )

        if suffix in CONFIG_EXTENSIONS or file_path.name == ".env":
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_OTHER,
                support_level=SUPPORT_MANIFEST_ONLY,
                file_size_bytes=file_size,
                line_count=line_count,
                skip_reason="manifest_only_config_file",
                coverage_limitation=False,
            )

        if suffix in DOC_EXTENSIONS:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_OTHER,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="documentation_file",
                coverage_limitation=False,
            )

        if file_path.name in LOCK_FILE_NAMES:
            return LanguageClassification(
                file_path=relative_path,
                language=LANGUAGE_OTHER,
                support_level=SUPPORT_SKIP,
                file_size_bytes=file_size,
                line_count=None,
                skip_reason="lock_file",
                coverage_limitation=False,
            )

        return LanguageClassification(
            file_path=relative_path,
            language=LANGUAGE_UNKNOWN,
            support_level=SUPPORT_MANIFEST_ONLY,
            file_size_bytes=file_size,
            line_count=line_count,
            skip_reason="manifest_only_unknown_type",
            coverage_limitation=True,
        )

    def _is_excluded(self, relative_path: str) -> bool:
        parts = relative_path.split("/")
        for part in parts:
            if part in EXCLUDED_DIR_NAMES:
                return True
            if part.endswith(".egg-info"):
                return True
        return False

    def _is_binary(self, file_path: Path) -> bool:
        try:
            with file_path.open("rb") as handle:
                sample = handle.read(512)
        except OSError:
            return True

        if not sample:
            return False

        try:
            sample.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            return True

        return False

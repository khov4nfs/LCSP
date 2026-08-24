from __future__ import annotations

from pathlib import Path

import pytest

from tools.graph.scanner.inventory.analyzer_router import AnalyzerRouter
from tools.graph.scanner.inventory.language_classifier import LanguageClassifier
from tools.graph.scanner.inventory.language_types import (
    LANGUAGE_BINARY,
    LANGUAGE_CSHARP,
    LANGUAGE_GO,
    LANGUAGE_JAVA,
    LANGUAGE_KOTLIN,
    LANGUAGE_PYTHON,
    LANGUAGE_RUST,
    LANGUAGE_TYPESCRIPT,
    SUPPORT_BASIC,
    SUPPORT_FULL,
    SUPPORT_MANIFEST_ONLY,
    SUPPORT_SKIP,
    LanguageClassification,
)


def _find_classification(result, suffix: str):
    for item in result:
        if item.file_path.endswith(suffix):
            return item
    raise AssertionError(f"classification not found: suffix={suffix}")


@pytest.mark.p0
def test_t01_python_file_classified_full_and_routed(workspace_dir: Path) -> None:
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "main.py").write_text("print('ok')\n", encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, "src/main.py")
    dispatch = AnalyzerRouter().route(classifications)

    assert target.language == LANGUAGE_PYTHON
    assert target.support_level == SUPPORT_FULL
    assert "src/main.py" in dispatch.python_files


@pytest.mark.p0
def test_t02_typescript_file_classified_full_and_routed(workspace_dir: Path) -> None:
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "app.ts").write_text("export const app = 1;\n", encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, "src/app.ts")
    dispatch = AnalyzerRouter().route(classifications)

    assert target.language == LANGUAGE_TYPESCRIPT
    assert target.support_level == SUPPORT_FULL
    assert "src/app.ts" in dispatch.ts_js_files


@pytest.mark.p0
def test_t03_minified_js_skipped_with_coverage_limitation(workspace_dir: Path) -> None:
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "utils.min.js").write_text("const a=1;\n", encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, "src/utils.min.js")
    dispatch = AnalyzerRouter().route(classifications)

    assert target.support_level == SUPPORT_SKIP
    assert target.coverage_limitation is True
    assert any(item["file_path"] == "src/utils.min.js" for item in dispatch.coverage_limitations)


@pytest.mark.p0
def test_t04_oversized_file_skipped_with_coverage_limitation(workspace_dir: Path) -> None:
    (workspace_dir / "src").mkdir()
    (workspace_dir / "src" / "large.py").write_bytes(b"x" * 11)

    classifications = LanguageClassifier(max_file_size_bytes=10).classify_workspace(workspace_dir)
    target = _find_classification(classifications, "src/large.py")

    assert target.support_level == SUPPORT_SKIP
    assert target.coverage_limitation is True
    assert target.skip_reason == "file_size_limit_exceeded"


@pytest.mark.p0
def test_t05_node_modules_is_excluded_before_classification(workspace_dir: Path) -> None:
    (workspace_dir / "node_modules" / "openai").mkdir(parents=True)
    (workspace_dir / "node_modules" / "openai" / "index.js").write_text(
        "module.exports = {};\n",
        encoding="utf-8",
    )

    classifications = LanguageClassifier().classify_workspace(workspace_dir)

    assert classifications == []


@pytest.mark.p0
def test_t06_router_enforces_python_quota_and_records_limitation(workspace_dir: Path) -> None:
    (workspace_dir / "src").mkdir()
    max_python_files = 5
    for index in range(max_python_files + 1):
        (workspace_dir / "src" / f"f_{index}.py").write_text("print('ok')\n", encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    dispatch = AnalyzerRouter(max_python_files=max_python_files).route(classifications)

    assert len(dispatch.python_files) == max_python_files
    assert len(dispatch.skipped_files) == 1
    assert dispatch.skipped_files[0].startswith("src/f_")
    assert dispatch.skipped_files[0].endswith(".py")
    assert any(
        item["reason"].startswith("python_file_limit_exceeded")
        for item in dispatch.coverage_limitations
    )


@pytest.mark.p0
def test_router_default_full_scan_does_not_drop_ts_js_after_500_files() -> None:
    classifications = [
        LanguageClassification(
            file_path=f"src/module_{index}.ts",
            language=LANGUAGE_TYPESCRIPT,
            support_level=SUPPORT_FULL,
            file_size_bytes=1,
            line_count=1,
            skip_reason=None,
            coverage_limitation=False,
        )
        for index in range(665)
    ]

    dispatch = AnalyzerRouter().route(classifications)

    assert len(dispatch.ts_js_files) == 665
    assert dispatch.skipped_files == []
    assert not any(
        item["reason"].startswith("ts_js_file_limit_exceeded")
        for item in dispatch.coverage_limitations
    )


@pytest.mark.p0
def test_t07_binary_png_is_marked_skip_binary(workspace_dir: Path) -> None:
    (workspace_dir / "assets").mkdir()
    (workspace_dir / "assets" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, "assets/logo.png")

    assert target.language == LANGUAGE_BINARY
    assert target.support_level == SUPPORT_SKIP


@pytest.mark.p0
def test_t08_pycache_is_excluded_before_classification(workspace_dir: Path) -> None:
    (workspace_dir / "__pycache__").mkdir()
    (workspace_dir / "__pycache__" / "main.cpython-311.pyc").write_bytes(b"\x00\x01")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)

    assert classifications == []


@pytest.mark.p0
def test_t09_env_file_is_manifest_only(workspace_dir: Path) -> None:
    (workspace_dir / ".env").write_text("OPENAI_API_KEY=abc\n", encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, ".env")

    assert target.support_level == SUPPORT_MANIFEST_ONLY


@pytest.mark.p0
def test_t10_large_package_json_is_manifest_only(workspace_dir: Path) -> None:
    payload = "{\n\"data\": \"" + ("x" * 200000) + "\"\n}\n"
    (workspace_dir / "package.json").write_text(payload, encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, "package.json")

    assert target.support_level == SUPPORT_MANIFEST_ONLY
    assert target.coverage_limitation is True


@pytest.mark.p0
@pytest.mark.parametrize(
    ("file_name", "expected_language"),
    [
        ("Service.java", LANGUAGE_JAVA),
        ("Service.kt", LANGUAGE_KOTLIN),
        ("main.go", LANGUAGE_GO),
        ("Service.cs", LANGUAGE_CSHARP),
        ("main.rs", LANGUAGE_RUST),
    ],
)
def test_basic_signal_languages_are_classified_and_routed(
    workspace_dir: Path,
    file_name: str,
    expected_language: str,
) -> None:
    (workspace_dir / file_name).write_text("class Service {}\n", encoding="utf-8")

    classifications = LanguageClassifier().classify_workspace(workspace_dir)
    target = _find_classification(classifications, file_name)
    dispatch = AnalyzerRouter().route(classifications)

    assert target.language == expected_language
    assert target.support_level == SUPPORT_BASIC
    assert file_name in dispatch.basic_files

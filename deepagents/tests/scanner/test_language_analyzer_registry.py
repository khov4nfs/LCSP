from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.protocol import (
    ANALYZER_FAILED,
    ANALYZER_SUCCESS,
    AnalyzerCapability,
    CanonicalAnalyzerResult,
)
from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
from tools.common.capabilities.evidence.scanner.inventory.language.analyzer_router import AnalyzerRouter
from tools.common.capabilities.evidence.scanner.inventory.language.language_types import (
    LANGUAGE_CSHARP,
    LANGUAGE_PYTHON,
    SUPPORT_BASIC,
    SUPPORT_FULL,
    LanguageClassification,
)
from tools.common.capabilities.agentic_evidence.entrypoints.scanner_tool_entrypoints import (
    run_python_semantic_analysis,
    run_ts_js_semantic_analysis,
)


class _Adapter:
    def __init__(self, language: str):
        self.language = language

    def supports(self, language: str) -> bool:
        return language == self.language

    def capabilities(self) -> AnalyzerCapability:
        return AnalyzerCapability(symbols=True)

    def analyze(self, workspace: Path, include_files):
        return CanonicalAnalyzerResult(
            language=self.language,
            status=ANALYZER_SUCCESS,
            capabilities=self.capabilities(),
        )


class _ProductionAdapter(_Adapter):
    def __init__(self, language: str, native_result):
        super().__init__(language)
        self.native_result = native_result

    def analyze(self, workspace: Path, include_files):
        return CanonicalAnalyzerResult(
            language=self.language,
            status=ANALYZER_SUCCESS,
            capabilities=self.capabilities(),
            native_result=self.native_result,
        )


class _FailingAdapter(_Adapter):
    def analyze(self, workspace: Path, include_files):
        raise RuntimeError("tool unavailable")


class _Context:
    ts_js_bridge_factory = staticmethod(lambda _workspace: None)

    def __init__(self, registry):
        self.language_analyzer_registry = registry


class _Registry:
    def __init__(self, adapters):
        self.adapters = adapters

    def resolve(self, language):
        return self.adapters.get(language)


def test_registry_resolves_registered_languages_deterministically() -> None:
    registry = LanguageAnalyzerRegistry((_Adapter("typescript"), _Adapter("python")))

    assert registry.languages() == ("python", "typescript")
    assert registry.resolve("python").language == "python"
    assert registry.resolve("typescript").language == "typescript"
    assert registry.resolve("javascript") is None


def test_default_registry_resolves_ruby_adapter() -> None:
    registry = LanguageAnalyzerRegistry.default()

    assert registry.resolve("ruby").language == "ruby"


def test_registry_rejects_duplicate_adapter_language() -> None:
    registry = LanguageAnalyzerRegistry((_Adapter("python"),))

    try:
        registry.register(_Adapter("python"))
    except ValueError as exc:
        assert "already registered" in str(exc)
    else:
        raise AssertionError("duplicate adapter registration must fail")


def test_unregistered_language_is_explicitly_unsupported() -> None:
    result = LanguageAnalyzerRegistry().analyze("ruby", Path("."), [])

    assert result.status == "UNSUPPORTED"
    assert result.capabilities == AnalyzerCapability()
    assert result.coverage_limitations


def test_recoverable_adapter_failure_is_distinct_from_success_with_zero_findings() -> None:
    failed = LanguageAnalyzerRegistry((_FailingAdapter("python"),)).analyze(
        "python", Path("."), []
    )
    successful = LanguageAnalyzerRegistry((_Adapter("python"),)).analyze(
        "python", Path("."), []
    )

    assert failed.status == ANALYZER_FAILED
    assert failed.coverage_limitations
    assert successful.status == ANALYZER_SUCCESS
    assert failed.status != successful.status


def test_router_uses_registry_for_semantic_files_and_preserves_basic_fallback() -> None:
    registry = LanguageAnalyzerRegistry((_Adapter("python"), _Adapter("ts_js")))
    classifications = [
        LanguageClassification("app.py", LANGUAGE_PYTHON, SUPPORT_FULL, 10, 1, None, False),
        LanguageClassification("api.cs", LANGUAGE_CSHARP, SUPPORT_BASIC, 10, 1, None, False),
    ]

    dispatch = AnalyzerRouter(semantic_registry=registry).route(classifications)

    assert dispatch.semantic_files == {"python": ["app.py"]}
    assert dispatch.python_files == ["app.py"]
    assert dispatch.basic_files == ["api.cs"]


def test_production_python_entrypoint_returns_registry_adapter_native_result(tmp_path: Path) -> None:
    native = object()
    context = _Context(_Registry({"python": _ProductionAdapter("python", native)}))

    assert run_python_semantic_analysis(
        {"workspace_path": str(tmp_path), "include_files": []}, context
    ) is native


def test_production_tsjs_entrypoint_returns_registry_adapter_native_result(tmp_path: Path) -> None:
    native = object()
    context = _Context(_Registry({"typescript": _ProductionAdapter("ts_js", native)}))

    assert run_ts_js_semantic_analysis(
        {"workspace_path": str(tmp_path), "include_files": []}, context
    ) is native

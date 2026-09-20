import json
from pathlib import Path

from tools.common.capabilities.evidence.scanner.inventory.project import (
    ProjectDescriptor,
    ProjectDiscovery,
    ProjectDetectorRegistry,
    ProjectLanguageResult,
    aggregate_project_results,
    ProjectExecutionPlanner,
)
from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_SUCCESS
from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
from tools.common.capabilities.evidence.scanner.inventory.language.language_types import (
    LANGUAGE_PYTHON,
    LANGUAGE_TYPESCRIPT,
    SUPPORT_FULL,
    LanguageClassification,
)
from tools.common.capabilities.evidence.scanner.inventory.language.language_classifier import (
    is_excluded_source_path,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_polyglot_projects_have_stable_ids_and_specific_file_ownership(tmp_path: Path) -> None:
    _write(tmp_path / "web/package.json", json.dumps({"name": "web"}))
    _write(tmp_path / "web/src/page.ts", "export const page = 1;\n")
    _write(tmp_path / "worker/pyproject.toml", "[project]\nname = 'worker'\n")
    _write(tmp_path / "worker/main.py", "print('ok')\n")
    _write(tmp_path / "README.md", "repository\n")

    first = ProjectDiscovery().discover(tmp_path)
    second = ProjectDiscovery().discover(tmp_path)

    assert [(p.relative_root, p.project_id) for p in first.projects] == [
        (p.relative_root, p.project_id) for p in second.projects
    ]
    projects = {p.relative_root: p for p in first.projects}
    assert projects["web"].project_kind == "javascript"
    assert projects["worker"].project_kind == "python"
    assert "typescript" in projects["web"].detected_languages
    assert "python" in projects["worker"].detected_languages
    assert first.file_ownership["web/src/page.ts"] == projects["web"].project_id
    assert first.file_ownership["worker/main.py"] == projects["worker"].project_id
    assert "README.md" in first.unowned_files


def test_related_python_manifests_deduplicate_to_one_project(tmp_path: Path) -> None:
    _write(tmp_path / "pyproject.toml", "[project]\nname = 'service'\n")
    _write(tmp_path / "requirements.txt", "httpx\n")

    result = ProjectDiscovery().discover(tmp_path)

    assert len(result.projects) == 1
    assert set(result.projects[0].manifest_paths) == {"pyproject.toml", "requirements.txt"}


def test_nested_projects_have_parent_and_malformed_detector_isolated(tmp_path: Path) -> None:
    _write(tmp_path / "package.json", json.dumps({"name": "root"}))
    _write(tmp_path / "apps/web/package.json", json.dumps({"name": "web"}))
    _write(tmp_path / "apps/web/page.ts", "export const page = 1;\n")

    result = ProjectDiscovery().discover(tmp_path)
    projects = {p.relative_root: p for p in result.projects}

    assert projects["apps/web"].parent_project_id == projects[""].project_id
    assert result.file_ownership["apps/web/page.ts"] == projects["apps/web"].project_id


def test_detector_failure_does_not_discard_successful_detectors(tmp_path: Path) -> None:
    class GoodDetector:
        name = "a-good"

        def detect(self, workspace):
            return (ProjectDescriptor("p", workspace, "", manifest_paths=("x",)),)

    class BadDetector:
        name = "b-bad"

        def detect(self, workspace):
            raise RuntimeError("bad manifest")

    result = ProjectDetectorRegistry((GoodDetector(), BadDetector())).discover(tmp_path)

    assert [project.project_id for project in result.projects] == ["p"]
    assert result.limitations == ("project_detector_failed:b-bad:RuntimeError",)


def test_malformed_manifest_is_explicit_limitation(tmp_path: Path) -> None:
    _write(tmp_path / "package.json", "{not-json")

    result = ProjectDiscovery().discover(tmp_path)

    assert result.projects[0].limitations == ("manifest_parse_failed:package.json",)
    assert "manifest_parse_failed:package.json" in result.limitations


def test_project_results_preserve_success_and_unsupported_outcomes() -> None:
    projects = (ProjectDescriptor("p1", Path("."), "one"), ProjectDescriptor("p2", Path("."), "two"))
    results = aggregate_project_results(
        projects,
        (
            ProjectLanguageResult("p1", "python", "python", ANALYZER_SUCCESS),
            ProjectLanguageResult("p2", "csharp", None, "UNSUPPORTED"),
        ),
    )

    assert results[0].language_results[0].status == ANALYZER_SUCCESS
    assert results[1].language_results[0].status == "UNSUPPORTED"


def test_execution_plan_partitions_same_language_projects_without_leakage(tmp_path: Path) -> None:
    _write(tmp_path / "a/pyproject.toml", "[project]\nname = 'a'\n")
    _write(tmp_path / "a/app.py", "print('a')\n")
    _write(tmp_path / "b/pyproject.toml", "[project]\nname = 'b'\n")
    _write(tmp_path / "b/app.py", "print('b')\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    classifications = [
        LanguageClassification("a/app.py", LANGUAGE_PYTHON, SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("b/app.py", LANGUAGE_PYTHON, SUPPORT_FULL, 1, 1, None, False),
    ]
    class Adapter:
        language = LANGUAGE_PYTHON

        def supports(self, language):
            return language == LANGUAGE_PYTHON

        def capabilities(self):
            return None

    plan = ProjectExecutionPlanner().build(
        tmp_path, discovery, classifications, LanguageAnalyzerRegistry((Adapter(),))
    )

    assert len(plan.units) == 2
    assert {unit.files for unit in plan.units} == {("a/app.py",), ("b/app.py",)}


def test_execution_plan_coalesces_ts_and_js_and_keeps_unowned_file(tmp_path: Path) -> None:
    _write(tmp_path / "web/package.json", json.dumps({"name": "web"}))
    _write(tmp_path / "web/a.ts", "export const a = 1;\n")
    _write(tmp_path / "web/b.js", "export const b = 1;\n")
    _write(tmp_path / "tools.py", "print('tool')\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    classifications = [
        LanguageClassification("web/a.ts", LANGUAGE_TYPESCRIPT, SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("web/b.js", "javascript", SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("tools.py", LANGUAGE_PYTHON, SUPPORT_FULL, 1, 1, None, False),
    ]
    class Adapter:
        def __init__(self, language):
            self.language = language

        def supports(self, language):
            return language == self.language or (
                self.language == "ts_js" and language in {"javascript", "typescript"}
            )

        def capabilities(self):
            return None

    plan = ProjectExecutionPlanner().build(
        tmp_path,
        discovery,
        classifications,
        LanguageAnalyzerRegistry((Adapter(LANGUAGE_PYTHON), Adapter("ts_js"))),
    )
    assert len(plan.units) == 2
    assert any(unit.analyzer == "ts_js" and unit.files == ("web/a.ts", "web/b.js") for unit in plan.units)
    assert any(unit.project_id == "repository-unowned" and unit.files == ("tools.py",) for unit in plan.units)


def test_execution_plan_keeps_basic_code_projects_explicitly_unsupported(tmp_path: Path) -> None:
    _write(tmp_path / "backend/backend.csproj", "<Project />\n")
    _write(tmp_path / "backend/Program.cs", "class Program {}\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    classifications = [
        LanguageClassification("backend/Program.cs", "csharp", SUPPORT_FULL, 1, 1, None, False),
    ]

    plan = ProjectExecutionPlanner().build(
        tmp_path, discovery, classifications, LanguageAnalyzerRegistry.default()
    )

    assert len(plan.units) == 1
    assert plan.units[0].language == "csharp"
    assert plan.units[0].project_id == discovery.projects[0].project_id


def test_execution_plan_routes_ruby_per_project_and_unowned_file(tmp_path: Path) -> None:
    _write(tmp_path / "service/Gemfile", 'gem "ruby-openai"\n')
    _write(tmp_path / "service/app.rb", "class App; end\n")
    _write(tmp_path / "script.rb", "puts :ok\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    classifications = [
        LanguageClassification("service/app.rb", "ruby", SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("script.rb", "ruby", SUPPORT_FULL, 1, 1, None, False),
    ]

    class Adapter:
        language = "ruby"

        def supports(self, language):
            return language == "ruby"

        def capabilities(self):
            return None

    plan = ProjectExecutionPlanner().build(
        tmp_path, discovery, classifications, LanguageAnalyzerRegistry((Adapter(),))
    )

    assert len(plan.units) == 2
    assert any(unit.project_id == "repository-unowned" and unit.files == ("script.rb",) for unit in plan.units)
    assert any(unit.project_id != "repository-unowned" and unit.files == ("service/app.rb",) for unit in plan.units)


def test_execution_plan_keeps_two_ruby_projects_independent(tmp_path: Path) -> None:
    _write(tmp_path / "a/Gemfile", 'gem "ruby-openai"\n')
    _write(tmp_path / "a/app.rb", "class A; end\n")
    _write(tmp_path / "b/Gemfile", 'gem "anthropic"\n')
    _write(tmp_path / "b/app.rb", "class B; end\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    classifications = [
        LanguageClassification("a/app.rb", "ruby", SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("b/app.rb", "ruby", SUPPORT_FULL, 1, 1, None, False),
    ]

    class Adapter:
        language = "ruby"

        def supports(self, language):
            return language == "ruby"

        def capabilities(self):
            return None

    plan = ProjectExecutionPlanner().build(
        tmp_path, discovery, classifications, LanguageAnalyzerRegistry((Adapter(),))
    )

    assert len(plan.units) == 2
    assert {unit.files for unit in plan.units} == {("a/app.rb",), ("b/app.rb",)}


def test_execution_plan_supports_ruby_python_and_tsjs_together(tmp_path: Path) -> None:
    _write(tmp_path / "web/package.json", "{\"name\": \"web\"}\n")
    _write(tmp_path / "web/app.ts", "export const app = 1;\n")
    _write(tmp_path / "worker/pyproject.toml", "[project]\nname = 'worker'\n")
    _write(tmp_path / "worker/main.py", "print('ok')\n")
    _write(tmp_path / "billing/Gemfile", 'gem "ruby-openai"\n')
    _write(tmp_path / "billing/billing.rb", "class Billing; end\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    classifications = [
        LanguageClassification("web/app.ts", "typescript", SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("worker/main.py", "python", SUPPORT_FULL, 1, 1, None, False),
        LanguageClassification("billing/billing.rb", "ruby", SUPPORT_FULL, 1, 1, None, False),
    ]

    class Adapter:
        def __init__(self, language):
            self.language = language

        def supports(self, language):
            return language == self.language or (
                self.language == "ts_js" and language in {"typescript", "javascript"}
            )

        def capabilities(self):
            return None

    plan = ProjectExecutionPlanner().build(
        tmp_path,
        discovery,
        classifications,
        LanguageAnalyzerRegistry((Adapter("python"), Adapter("ts_js"), Adapter("ruby"))),
    )

    assert {(unit.analyzer, unit.files[0]) for unit in plan.units} == {
        ("ts_js", "web/app.ts"),
        ("python", "worker/main.py"),
        ("ruby", "billing/billing.rb"),
    }


def test_vendor_source_is_excluded_before_project_execution_planning(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "rails"\n')
    _write(tmp_path / "app.rb", "class FirstParty; end\n")
    _write(tmp_path / "vendor/acme/lib/client.rb", "class VendorSecretClient; end\n")

    discovery = ProjectDiscovery().discover(tmp_path)
    classified = {item.file_path for item in discovery.classifications}
    assert "app.rb" in classified
    assert "vendor/acme/lib/client.rb" not in classified

    plan = ProjectExecutionPlanner().build(
        tmp_path,
        discovery,
        discovery.classifications,
        LanguageAnalyzerRegistry.default(),
    )
    assert all("vendor/" not in file for unit in plan.units for file in unit.files)


def test_first_party_artifacts_feature_is_classified_and_planned(tmp_path: Path) -> None:
    _write(tmp_path / "apps/web/package.json", json.dumps({"name": "web"}))
    _write(
        tmp_path / "apps/web/src/features/artifacts/components/artifact-list.tsx",
        "export function ArtifactList() { return null; }\n",
    )
    _write(
        tmp_path / "apps/web/src/features/artifacts/utils/artifact-routes.ts",
        "export const artifactRoutes = [];\n",
    )

    artifact_files = {
        "apps/web/src/features/artifacts/components/artifact-list.tsx",
        "apps/web/src/features/artifacts/utils/artifact-routes.ts",
    }
    assert all(not is_excluded_source_path(path) for path in artifact_files)

    discovery = ProjectDiscovery().discover(tmp_path)
    classified = {
        item.file_path: item
        for item in discovery.classifications
        if item.file_path in artifact_files
    }
    assert set(classified) == artifact_files
    assert classified["apps/web/src/features/artifacts/components/artifact-list.tsx"].language == LANGUAGE_TYPESCRIPT
    assert classified["apps/web/src/features/artifacts/utils/artifact-routes.ts"].language == LANGUAGE_TYPESCRIPT

    plan = ProjectExecutionPlanner().build(
        tmp_path,
        discovery,
        discovery.classifications,
        LanguageAnalyzerRegistry.default(),
    )
    planned_files = {file for unit in plan.units for file in unit.files}
    assert artifact_files <= planned_files
    web_project = next(project for project in discovery.projects if project.relative_root == "apps/web")
    assert all(discovery.file_ownership[path] == web_project.project_id for path in artifact_files)


def test_first_party_cache_feature_is_not_excluded_by_directory_name(tmp_path: Path) -> None:
    _write(tmp_path / "package.json", json.dumps({"name": "web"}))
    path = "src/cache/service.ts"
    _write(tmp_path / path, "export const cacheService = {};\n")

    assert not is_excluded_source_path(path)
    discovery = ProjectDiscovery().discover(tmp_path)
    assert path in {item.file_path for item in discovery.classifications}
    plan = ProjectExecutionPlanner().build(
        tmp_path,
        discovery,
        discovery.classifications,
        LanguageAnalyzerRegistry.default(),
    )
    assert any(path in unit.files for unit in plan.units)


def test_unambiguous_tool_output_remains_excluded_before_planning(tmp_path: Path) -> None:
    _write(tmp_path / "package.json", json.dumps({"name": "web"}))
    _write(tmp_path / "node_modules/acme/index.js", "export const generated = true;\n")
    _write(tmp_path / ".dart_tool/package_config.json", "{}\n")

    discovery = ProjectDiscovery().discover(tmp_path)
    classified = {item.file_path for item in discovery.classifications}
    assert "node_modules/acme/index.js" not in classified
    assert ".dart_tool/package_config.json" not in classified

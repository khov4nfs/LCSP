from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.common.capabilities.platform.repository_scanner import (
    DISCOVERY_VERSION,
    REPOSITORY_DISCOVERY_PATH,
    SCANNER_VERSION,
    RepositoryScanner,
    _enrich_repository_discovery_from_graph,
    compute_discovery_digest,
    compute_profile_digest,
    ensure_repository_discovery,
    ensure_repository_profile,
    scan_repository_discovery,
    scan_repository_workspace,
    validate_repository_discovery_error,
    validate_repository_profile_error,
)


def test_small_python_fixture(tmp_path: Path) -> None:
    req_file = tmp_path / "requirements.txt"
    req_file.write_text(
        "# Core service dependencies\n"
        "fastapi>=0.100.0\n"
        "psycopg2>=2.9.0\n"
        "\n"
        "# Testing\n"
        "pytest>=7.0.0\n",
        encoding="utf-8",
    )
    main_py = tmp_path / "main.py"
    main_py.write_text("import fastapi\n", encoding="utf-8")

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-py-1",
        commit_sha="132b5d796b32bf2f4454990b64df7d0435e28161",
    )

    assert profile["repositoryId"] == "repo-py-1"
    assert profile["commitSha"] == "132b5d796b32bf2f4454990b64df7d0435e28161"
    assert profile["scannerVersion"] == SCANNER_VERSION
    assert profile["contentDigest"].startswith("sha256:")

    # Languages
    langs = {item["language"]: item["fileCount"] for item in profile["languages"]}
    assert langs.get("Python") == 1

    # Manifests
    manifest_paths = [m["path"] for m in profile["manifests"]]
    assert "requirements.txt" in manifest_paths
    req_manifest = next(m for m in profile["manifests"] if m["path"] == "requirements.txt")
    dep_names = {d["name"]: d["line"] for d in req_manifest["dependencies"]}
    assert dep_names["fastapi"] == 2
    assert dep_names["psycopg2"] == 3
    assert dep_names["pytest"] == 6

    # Frameworks
    fw_names = {f["name"]: f["category"] for f in profile["frameworks"]}
    assert fw_names.get("FastAPI") == "WEB_FRAMEWORK"
    assert fw_names.get("PostgreSQL Client (psycopg2)") == "DATABASE_CLIENT"
    assert fw_names.get("Pytest") == "TESTING"

    # Candidate facts
    facts = profile["candidateFacts"]
    assert len(facts) >= 2
    for fact in facts:
        assert fact["kind"] == "FACT"
        assert fact["authority"] == "EVIDENCE_CITED"
        assert fact["evidence"]["path"] == "requirements.txt"
        assert fact["evidence"]["excerptSha256"].startswith("sha256:")
        # Invariant: Never infer operator or jurisdiction
        assert "operator" not in fact["statement"].lower()
        assert "jurisdiction" not in fact["statement"].lower()


def test_package_json_classifies_ai_dependencies_without_runtime_overclaim(
    tmp_path: Path,
) -> None:
    package_json = tmp_path / "package.json"
    package_json.write_text(
        json.dumps(
            {
                "name": "ai-web-app",
                "dependencies": {
                    "openai": "^4.0.0",
                    "@anthropic-ai/sdk": "^0.30.0",
                    "@google/genai": "^1.0.0",
                    "@ai-sdk/openai": "^1.0.0",
                    "ai": "^4.0.0",
                    "langchain": "^0.3.0",
                    "@tensorflow/tfjs": "^4.0.0",
                    "@huggingface/transformers": "^3.0.0",
                    "unlisted-ai-helper": "^1.0.0",
                    "torch": "^1.0.0",
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-ai-js-1",
        commit_sha="1" * 40,
    )

    frameworks = {item["name"]: item for item in profile["frameworks"]}
    assert frameworks["OpenAI SDK"]["category"] == "AI_PROVIDER_SDK"
    assert frameworks["Anthropic SDK"]["category"] == "AI_PROVIDER_SDK"
    assert frameworks["Google Gen AI SDK"]["category"] == "AI_PROVIDER_SDK"
    assert frameworks["Vercel AI SDK OpenAI Provider"]["category"] == "AI_PROVIDER_SDK"
    assert frameworks["Vercel AI SDK"]["category"] == "AI_ORCHESTRATION"
    assert frameworks["LangChain"]["category"] == "AI_ORCHESTRATION"
    assert frameworks["TensorFlow.js"]["category"] == "ML_FRAMEWORK"
    assert frameworks["Transformers.js"]["category"] == "ML_FRAMEWORK"
    assert all(item["name"] != "unlisted-ai-helper" for item in profile["frameworks"])
    assert all(item["name"] != "PyTorch" for item in profile["frameworks"])

    manifest = profile["manifests"][0]
    dependency_lines = {item["name"]: item["line"] for item in manifest["dependencies"]}
    assert frameworks["OpenAI SDK"]["line"] == dependency_lines["openai"]
    assert frameworks["Anthropic SDK"]["line"] == dependency_lines["@anthropic-ai/sdk"]

    ai_facts = [
        fact
        for fact in profile["candidateFacts"]
        if "AI_" in fact["statement"] or "ML_FRAMEWORK" in fact["statement"]
    ]
    assert len(ai_facts) == 8
    for fact in ai_facts:
        statement = fact["statement"].lower()
        assert "manifest declares" in statement
        assert "does not establish runtime ai use" in statement
        assert "uses ai in production" not in statement
        assert "reachable" not in statement
        assert fact["evidence"]["path"] == "package.json"
        assert fact["evidence"]["startLine"] == fact["evidence"]["endLine"]


def test_python_manifests_classify_ai_and_ml_dependencies(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text(
        "openai[realtime] >= 1.0.0\n"
        "anthropic @ https://example.invalid/anthropic.whl\n"
        "langchain>=0.3.0\n"
        "torch>=2.0.0\n"
        "tensorflow>=2.0.0\n"
        "scikit_learn>=1.0.0\n"
        "ai>=1.0.0\n"
        "unknown-model-client>=1.0.0\n",
        encoding="utf-8",
    )
    (tmp_path / "pyproject.toml").write_text(
        "[tool.poetry.dependencies]\n"
        'python = "^3.11"\n'
        'google-genai = "^1.0"\n'
        'transformers = "^4.0"\n',
        encoding="utf-8",
    )

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-ai-python-1",
        commit_sha="2" * 40,
    )

    categories = {item["name"]: item["category"] for item in profile["frameworks"]}
    assert categories["OpenAI SDK"] == "AI_PROVIDER_SDK"
    assert categories["Anthropic SDK"] == "AI_PROVIDER_SDK"
    assert categories["LangChain"] == "AI_ORCHESTRATION"
    assert categories["PyTorch"] == "ML_FRAMEWORK"
    assert categories["TensorFlow"] == "ML_FRAMEWORK"
    assert categories["scikit-learn"] == "ML_FRAMEWORK"
    assert categories["Google Gen AI SDK"] == "AI_PROVIDER_SDK"
    assert categories["Hugging Face Transformers"] == "ML_FRAMEWORK"
    assert all(item["name"] != "unknown-model-client" for item in profile["frameworks"])
    assert all(item["name"] != "Vercel AI SDK" for item in profile["frameworks"])

    facts_by_path: dict[str, list[dict[str, object]]] = {}
    for fact in profile["candidateFacts"]:
        facts_by_path.setdefault(fact["evidence"]["path"], []).append(fact)

    assert len(facts_by_path["requirements.txt"]) == 6
    assert len(facts_by_path["pyproject.toml"]) == 2
    for facts in facts_by_path.values():
        for fact in facts:
            assert "does not establish runtime AI use" in fact["statement"]
            assert fact["evidence"]["startLine"] == fact["evidence"]["endLine"]
            assert fact["evidence"]["excerptSha256"].startswith("sha256:")


def test_pyproject_pep621_arrays_do_not_classify_optional_group_names(
    tmp_path: Path,
) -> None:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\n"
        'dependencies = ["openai>=1", "torch>=2"]\n'
        "\n"
        "[project.optional-dependencies]\n"
        "ai = [\n"
        '  "anthropic>=0.30",\n'
        "]\n",
        encoding="utf-8",
    )

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-pep621-1",
        commit_sha="3" * 40,
    )

    frameworks = profile["frameworks"]
    assert {(item["name"], item["category"]) for item in frameworks} == {
        ("OpenAI SDK", "AI_PROVIDER_SDK"),
        ("PyTorch", "ML_FRAMEWORK"),
        ("Anthropic SDK", "AI_PROVIDER_SDK"),
    }
    assert all(item["name"] != "Vercel AI SDK" for item in frameworks)
    facts = profile["candidateFacts"]
    assert len(facts) == 3
    assert {fact["evidence"]["startLine"] for fact in facts} == {2, 6}


def test_package_json_framework_provenance_is_scoped_to_dependency_section(
    tmp_path: Path,
) -> None:
    (tmp_path / "package.json").write_text(
        "{\n"
        '  "keywords": ["openai"],\n'
        '  "dependencies": {\n'
        '    "openai": "^4.0.0"\n'
        "  },\n"
        '  "devDependencies": {\n'
        '    "openai": "^4.1.0"\n'
        "  }\n"
        "}\n",
        encoding="utf-8",
    )

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-json-provenance-1",
        commit_sha="4" * 40,
    )

    observations = [item for item in profile["frameworks"] if item["name"] == "OpenAI SDK"]
    assert [item["line"] for item in observations] == [4, 7]
    facts = [fact for fact in profile["candidateFacts"] if "OpenAI SDK" in fact["statement"]]
    assert [fact["evidence"]["startLine"] for fact in facts] == [4, 7]


def test_monorepo_fixture_with_prefix_scoping(tmp_path: Path) -> None:
    (tmp_path / "pnpm-workspace.yaml").write_text("packages:\n  - 'apps/*'\n", encoding="utf-8")

    # apps/web
    web_dir = tmp_path / "apps/web"
    web_dir.mkdir(parents=True)
    (web_dir / "package.json").write_text(
        json.dumps({
            "name": "@lcsp/web",
            "version": "1.0.0",
            "dependencies": {
                "next": "^14.0.0",
                "react": "^18.2.0"
            }
        }, indent=2),
        encoding="utf-8"
    )

    # apps/api
    api_dir = tmp_path / "apps/api"
    api_dir.mkdir(parents=True)
    (api_dir / "package.json").write_text(
        json.dumps({
            "name": "@lcsp/api",
            "version": "1.0.0",
            "dependencies": {
                "@nestjs/core": "^10.0.0",
                "@prisma/client": "^5.0.0",
                "ioredis": "^5.3.0"
            }
        }, indent=2),
        encoding="utf-8"
    )

    # Dockerfile & CI
    (tmp_path / "Dockerfile").write_text("FROM node:20-alpine\nEXPOSE 3000\n", encoding="utf-8")
    ci_dir = tmp_path / ".github/workflows"
    ci_dir.mkdir(parents=True)
    (ci_dir / "ci.yml").write_text("name: CI\non: [push]\n", encoding="utf-8")

    # Unscoped scan: sees all packages
    full_profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-mono-1",
        commit_sha="a" * 40,
        source_path_prefix=None,
    )
    manifest_paths = [m["path"] for m in full_profile["manifests"]]
    assert "apps/web/package.json" in manifest_paths
    assert "apps/api/package.json" in manifest_paths
    build_sys_names = [b["name"] for b in full_profile["buildSystems"]]
    assert "pnpm workspace" in build_sys_names
    containers = [c["kind"] for c in full_profile["containerization"]]
    assert "DOCKERFILE" in containers

    # Scoped scan: strictly apps/api
    scoped_profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-mono-1",
        commit_sha="a" * 40,
        source_path_prefix="apps/api",
    )
    scoped_manifest_paths = [m["path"] for m in scoped_profile["manifests"]]
    assert "apps/api/package.json" in scoped_manifest_paths
    assert "apps/web/package.json" not in scoped_manifest_paths


def test_malicious_and_oversized_file_protection(tmp_path: Path) -> None:
    # Oversize manifest
    large_pkg = tmp_path / "package.json"
    large_pkg.write_text(" " * (100 * 1024), encoding="utf-8")

    # Scanner with 50KB limit
    scanner = RepositoryScanner(
        tmp_path,
        repository_id="repo-guard-1",
        commit_sha="b" * 40,
        max_manifest_size_bytes=50 * 1024,
    )
    profile = scanner.scan()

    gaps = profile["knownGaps"]
    assert any(g["reason"] == "FILE_SIZE_LIMIT_EXCEEDED" for g in gaps)


def test_profile_bounds_large_observation_collections_with_explicit_gaps(
    tmp_path: Path,
) -> None:
    package = json.dumps({"dependencies": {"openai": "^4.0.0"}})
    for index in range(501):
        package_dir = tmp_path / f"package-{index:03d}"
        package_dir.mkdir()
        (package_dir / "package.json").write_text(package, encoding="utf-8")

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-bounded-profile",
        commit_sha="d" * 40,
    )

    assert len(profile["manifests"]) == 500
    assert len(profile["frameworks"]) == 500
    assert len(profile["candidateFacts"]) == 500
    limit_details = {
        gap.get("detail", "")
        for gap in profile["knownGaps"]
        if gap["reason"] == "COLLECTION_LIMIT_REACHED"
    }
    assert any("collection manifests contained 501" in detail for detail in limit_details)
    assert any("collection frameworks contained 501" in detail for detail in limit_details)
    assert any("collection candidateFacts contained 501" in detail for detail in limit_details)
    assert validate_repository_profile_error(
        profile,
        repository_id="repo-bounded-profile",
        commit_sha="d" * 40,
        source_path_prefix=None,
    ) is None


def test_profile_bounds_manifest_dependencies_and_gap_ledger(tmp_path: Path) -> None:
    dependencies = {f"package-{index:04d}": "1.0.0" for index in range(5_001)}
    (tmp_path / "package.json").write_text(
        json.dumps({"dependencies": dependencies}),
        encoding="utf-8",
    )

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-bounded-dependencies",
        commit_sha="e" * 40,
    )

    assert len(profile["manifests"][0]["dependencies"]) == 5_000
    assert any(
        gap["reason"] == "COLLECTION_LIMIT_REACHED"
        and gap["path"] == "package.json"
        and "dependencies contained 5001" in gap.get("detail", "")
        for gap in profile["knownGaps"]
    )

    scanner = RepositoryScanner(
        tmp_path / "empty",
        repository_id="repo-bounded-gaps",
        commit_sha="f" * 40,
    )
    scanner.workspace_path.mkdir()
    scanner.known_gaps = [
        {"path": f"file-{index}", "reason": "UNSUPPORTED_SYNTAX"}
        for index in range(1_001)
    ]
    gap_profile = scanner.scan()
    assert len(gap_profile["knownGaps"]) == 1_000
    assert gap_profile["knownGaps"][-1]["reason"] == "COLLECTION_LIMIT_REACHED"
    assert "omitted 2 additional gap records" in gap_profile["knownGaps"][-1]["detail"]


def test_secret_redaction_in_excerpts(tmp_path: Path) -> None:
    pkg = tmp_path / "package.json"
    pkg.write_text(
        json.dumps({
            "name": "secret-app",
            "dependencies": {
                "express": "^4.18.2"
            },
            "customConfig": {
                "apiKey": "sk-1234567890abcdef1234567890abcdef"
            }
        }, indent=2),
        encoding="utf-8"
    )

    profile = scan_repository_workspace(
        tmp_path,
        repository_id="repo-secret-1",
        commit_sha="c" * 40,
    )

    # Verify no raw API key appears in framework excerpts or facts
    for fw in profile["frameworks"]:
        assert "sk-1234567890" not in fw["evidenceExcerpt"]
    for fact in profile["candidateFacts"]:
        assert "sk-1234567890" not in fact["statement"]


class FakeSandboxBackend:
    def __init__(self, workspace_path: Path):
        self.workspace_path = workspace_path
        self.storage: dict[str, str] = {}

    def read(self, path: str):
        if path in self.storage:
            return self.storage[path]
        return SimpleNamespace(error="NOT_FOUND")

    def write(self, path: str, content: str):
        self.storage[path] = content
        return SimpleNamespace(error=None)


def test_discovery_finds_direct_sdk_raw_http_and_nearby_controls(tmp_path: Path) -> None:
    (tmp_path / "openai.ts").write_text(
        "import OpenAI from 'openai';\n"
        "export async function summarize(userInput: string) {\n"
        "  const sanitized = redact(userInput);\n"
        "  audit.log('model request');\n"
        "  return client.responses.create({ input: sanitized });\n"
        "}\n",
        encoding="utf-8",
    )
    (tmp_path / "anthropic.py").write_text(
        "import requests\n"
        "def call_model(prompt):\n"
        "    return requests.post('https://api.anthropic.com/v1/messages', json={'prompt': prompt})\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-discovery",
        commit_sha="a" * 40,
        graph_index_version="sha256:" + "1" * 64,
    )

    signal_types = {item["signalType"] for item in discovery["sourceRanges"]}
    assert {"AI_SDK_CALL", "RAW_AI_HTTP_CALL", "CONTROL", "DATA_FLOW"} <= signal_types
    assert len(discovery["aiUseCases"]) == 2
    assert discovery["ruleCandidates"] == []
    assert discovery["graphIndexVersion"] == "sha256:" + "1" * 64
    assert discovery["contentDigest"] == compute_discovery_digest(discovery)
    assert discovery["discoveryId"] == discovery["contentDigest"]
    assert discovery["resourceLedger"]["expansionHistory"] == []
    assert all(item["ruleRelevance"] == [] for item in discovery["sourceRanges"])
    assert all(item["reachability"] == "NOT_ESTABLISHED" for item in discovery["sourceRanges"])


def test_discovery_finds_custom_ai_gateway_http_without_sdk(tmp_path: Path) -> None:
    (tmp_path / "gateway.ts").write_text(
        "export async function complete(prompt: string) {\n"
        "  return fetch(process.env.AI_GATEWAY_URL + '/v1/chat/completions', {\n"
        "    method: 'POST', body: JSON.stringify({ prompt })\n"
        "  });\n"
        "}\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-custom-ai-gateway",
        commit_sha="a" * 40,
    )

    invocation = next(
        item
        for item in discovery["sourceRanges"]
        if item["signalType"] == "RAW_AI_HTTP_CALL"
    )
    assert invocation["path"] == "gateway.ts"
    assert invocation["reachability"] == "NOT_ESTABLISHED"
    assert invocation["evidenceStrength"] == "DIRECT_SOURCE"
    assert len(discovery["aiUseCases"]) == 1
    assert discovery["aiUseCases"][0]["providerOrFramework"] is None
    assert discovery["unresolvedCalls"]
    assert all("gateway.ts" in item for item in discovery["unresolvedCalls"])


def test_discovery_does_not_treat_generic_http_post_as_ai_use(tmp_path: Path) -> None:
    (tmp_path / "billing.ts").write_text(
        "export async function charge(payload) {\n"
        "  return fetch('/v1/payments', { method: 'POST', body: JSON.stringify(payload) });\n"
        "}\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-generic-http",
        commit_sha="b" * 40,
    )

    assert discovery["aiUseCases"] == []
    assert all(
        item["signalType"] != "RAW_AI_HTTP_CALL"
        for item in discovery["sourceRanges"]
    )


def test_discovery_keeps_independent_rule_controls_without_ai_overclaim(
    tmp_path: Path,
) -> None:
    (tmp_path / "retention.ts").write_text(
        "export const purgeExpired = (records) => records.filter(byRetentionDeadline);\n",
        encoding="utf-8",
    )
    (tmp_path / "access.ts").write_text(
        "export const allowed = (actor, resource) => rbac.authorize(actor, resource);\n",
        encoding="utf-8",
    )
    (tmp_path / "audit.ts").write_text(
        "export const recordEvent = (event) => audit.log(event);\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-independent-controls",
        commit_sha="c" * 40,
    )

    controls = [
        item for item in discovery["sourceRanges"] if item["signalType"] == "CONTROL"
    ]
    assert {item["path"] for item in controls} == {
        "access.ts",
        "audit.ts",
        "retention.ts",
    }
    assert discovery["aiUseCases"] == []
    assert all(item["technologyRelevance"] == ["RELATED_LOGIC"] for item in controls)
    assert all(item["evidenceStrength"] == "HEURISTIC" for item in controls)
    assert all(item["observationStatus"] == "CANDIDATE_FINDING" for item in controls)
    assert all("not proof of AI use or compliance" in item["explanation"] for item in controls)


def test_discovery_reuses_codebase_memory_call_edges_without_claiming_reachability(
    tmp_path: Path,
) -> None:
    (tmp_path / "model.py").write_text(
        "def summarize(prompt):\n"
        "    return client.responses.create(input=prompt)\n",
        encoding="utf-8",
    )
    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-graph-enrichment",
        commit_sha="1" * 40,
        graph_index_version="sha256:" + "2" * 64,
    )
    commands: list[str] = []

    def execute(command: str, timeout: int | None = None):
        commands.append(command)
        assert timeout == 30
        return SimpleNamespace(
            exit_code=0,
            output=json.dumps(
                {
                    "function": "summarize",
                    "direction": "both",
                    "callers_total": 1,
                    "callers": {
                        "cols": ["name", "hop"],
                        "groups": [
                            {"qn_prefix": "app.routes", "rows": [["run_summary", 1]]}
                        ],
                    },
                    "callees_total": 1,
                    "callees": {
                        "cols": ["name", "hop"],
                        "groups": [
                            {"qn_prefix": "openai.responses", "rows": [["create", 1]]}
                        ],
                    },
                }
            ),
        )

    enriched = _enrich_repository_discovery_from_graph(discovery, execute=execute)

    invocation = next(
        item for item in enriched["sourceRanges"] if item["signalType"] == "AI_SDK_CALL"
    )
    assert invocation["callers"] == ["app.routes.run_summary"]
    assert invocation["callees"] == ["openai.responses.create"]
    assert invocation["reachability"] == "NOT_ESTABLISHED"
    assert "production-runtime reachability" in invocation["unresolvedEdges"][0]
    assert enriched["contentDigest"] == compute_discovery_digest(enriched)
    assert enriched["cacheIdentity"] == discovery["cacheIdentity"]
    assert len(commands) == 1
    assert "codebase-memory-graph cli --quiet trace_path" in commands[0]
    assert '\"file_path\":\"model.py\"' in commands[0]
    assert '\"depth\":3' in commands[0]
    assert '\"limit\":100' in commands[0]
    assert '\"max_output_tokens\":4000' in commands[0]


def test_discovery_records_graph_query_failure_as_unresolved_coverage(
    tmp_path: Path,
) -> None:
    (tmp_path / "model.py").write_text(
        "def summarize(prompt):\n"
        "    return client.responses.create(input=prompt)\n",
        encoding="utf-8",
    )
    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-graph-failure",
        commit_sha="2" * 40,
        graph_index_version="sha256:" + "3" * 64,
    )

    def execute(_command: str, timeout: int | None = None):
        assert timeout == 30
        return SimpleNamespace(exit_code=1, output="ambiguous symbol")

    enriched = _enrich_repository_discovery_from_graph(discovery, execute=execute)

    invocation = next(
        item for item in enriched["sourceRanges"] if item["signalType"] == "AI_SDK_CALL"
    )
    assert invocation["callers"] == []
    assert invocation["callees"] == []
    assert any("runtime reachability remains unresolved" in gap for gap in invocation["coverageGaps"])
    assert any(
        gap["reason"] == "UNRESOLVED_REACHABILITY" and gap["path"] == "model.py"
        for gap in enriched["knownGaps"]
    )
    assert enriched["resourceLedger"]["coverageImpact"]["knownGapCount"] >= 1
    assert enriched["resourceLedger"]["coverageImpact"]["truncated"] is False


def test_discovery_records_bounded_graph_trace_budget(tmp_path: Path) -> None:
    for index in range(2):
        (tmp_path / f"model_{index}.py").write_text(
            f"def summarize_{index}(prompt):\n"
            "    return client.responses.create(input=prompt)\n",
            encoding="utf-8",
        )
    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-graph-budget",
        commit_sha="3" * 40,
        graph_index_version="sha256:" + "4" * 64,
    )
    commands: list[str] = []

    def execute(command: str, timeout: int | None = None):
        commands.append(command)
        return SimpleNamespace(
            exit_code=0,
            output=json.dumps(
                {
                    "callers_total": 101,
                    "callers_total_relation": "eq",
                    "callers": {
                        "cols": ["name", "hop"],
                        "groups": [{"qn_prefix": "app", "rows": [["entry", 1]]}],
                    },
                    "callees": {"cols": ["name", "hop"], "groups": []},
                }
            ),
        )

    enriched = _enrich_repository_discovery_from_graph(
        discovery,
        execute=execute,
        max_traces=1,
    )

    assert len(commands) == 1
    assert any(
        gap["reason"] == "INCOMPLETE_COVERAGE" and "trace budget 1" in gap["detail"]
        for gap in enriched["knownGaps"]
    )
    assert sum(
        any("trace budget 1" in gap for gap in item["coverageGaps"])
        for item in enriched["sourceRanges"]
    ) == 1
    assert any(
        gap["reason"] == "INCOMPLETE_COVERAGE"
        and "caller/callee results" in gap["detail"]
        for gap in enriched["knownGaps"]
    )


def test_discovery_marks_wrapper_as_indirect_candidate_without_confirming_reachability(
    tmp_path: Path,
) -> None:
    (tmp_path / "model_gateway.ts").write_text(
        "export async function runThroughGateway(modelGateway, messages) {\n"
        "  return modelGateway.invoke(messages);\n"
        "}\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-wrapper",
        commit_sha="b" * 40,
    )

    use_case = discovery["aiUseCases"][0]
    assert use_case["providerOrFramework"] is None
    assert "runtime entry point" in discovery["unresolvedCalls"][0]
    invocation = next(
        item for item in discovery["sourceRanges"] if item["signalType"] == "AI_WRAPPER"
    )
    assert invocation["reachability"] == "NOT_ESTABLISHED"
    assert invocation["sourceClassification"] == "PRODUCTION_CANDIDATE"
    assert invocation["observationStatus"] == "INFERRED_HYPOTHESIS"
    assert invocation["evidenceStrength"] == "HEURISTIC"
    assert use_case["observationStatus"] == "INFERRED_HYPOTHESIS"


def test_discovery_ignores_generic_invoke_without_ai_or_model_context(tmp_path: Path) -> None:
    (tmp_path / "cache.ts").write_text(
        "export function lookup(cache, key) {\n  return cache.invoke(key);\n}\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-generic-invoke",
        commit_sha="3" * 40,
    )

    assert discovery["aiUseCases"] == []
    assert discovery["sourceRanges"] == []


def test_discovery_records_configuration_signal_without_retaining_secret_value(
    tmp_path: Path,
) -> None:
    secret = "sk-sensitive-value-that-must-not-be-retained"
    (tmp_path / "model-config.yaml").write_text(
        f"model_provider: openai\napi_key: {secret}\nmodel_id: gpt-private\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-config",
        commit_sha="4" * 40,
    )

    config_ranges = [
        item for item in discovery["sourceRanges"] if item["signalType"] == "CONFIGURATION"
    ]
    assert config_ranges
    assert all(item["sourceClassification"] == "CONFIGURATION" for item in config_ranges)
    assert secret not in json.dumps(discovery)
    assert discovery["aiUseCases"] == []


def test_discovery_ranks_direct_source_before_configuration_and_hypotheses(
    tmp_path: Path,
) -> None:
    (tmp_path / "model-config.yaml").write_text(
        "model_provider: openai\n",
        encoding="utf-8",
    )
    (tmp_path / "wrapper.ts").write_text(
        "export const invoke = (modelGateway, input) => modelGateway.invoke(input);\n",
        encoding="utf-8",
    )
    (tmp_path / "provider.ts").write_text(
        "import OpenAI from 'openai';\nclient.responses.create({ input: prompt });\n",
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-ranked",
        commit_sha="5" * 40,
    )

    ranked = discovery["sourceRanges"]
    assert ranked[0]["signalType"] == "AI_SDK_CALL"
    assert ranked[0]["evidenceStrength"] == "DIRECT_SOURCE"
    assert next(
        index for index, item in enumerate(ranked) if item["signalType"] == "AI_WRAPPER"
    ) < next(
        index for index, item in enumerate(ranked) if item["signalType"] == "CONFIGURATION"
    )


def test_discovery_does_not_turn_unused_dependency_into_use_case(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        json.dumps({"dependencies": {"openai": "^4.0.0"}}),
        encoding="utf-8",
    )
    (tmp_path / "index.ts").write_text("export const healthy = true;\n", encoding="utf-8")

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-unused",
        commit_sha="c" * 40,
    )

    assert discovery["aiUseCases"] == []
    assert discovery["sourceRanges"] == []


def test_discovery_distinguishes_test_only_source_and_ai_free_repository(tmp_path: Path) -> None:
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "model.test.ts").write_text(
        "import OpenAI from 'openai';\nclient.responses.create({ input: 'fixture' });\n",
        encoding="utf-8",
    )
    (tmp_path / "service.py").write_text("def add(left, right):\n    return left + right\n", encoding="utf-8")

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-test-only",
        commit_sha="d" * 40,
    )
    assert discovery["aiUseCases"]
    assert {
        item["sourceClassification"] for item in discovery["sourceRanges"]
    } == {"TEST_ONLY"}

    (tests_dir / "model.test.ts").unlink()
    ai_free = scan_repository_discovery(
        tmp_path,
        repository_id="repo-ai-free",
        commit_sha="e" * 40,
    )
    assert ai_free["aiUseCases"] == []
    assert ai_free["sourceRanges"] == []
    assert ai_free["knownGaps"] == []


def test_discovery_records_truncation_unsupported_languages_and_resource_budget(
    tmp_path: Path,
) -> None:
    (tmp_path / "a.ts").write_text("client.responses.create({ input: prompt });\n", encoding="utf-8")
    (tmp_path / "b.ts").write_text("client.responses.create({ input: prompt });\n", encoding="utf-8")
    (tmp_path / "handler.go").write_text("package handler\n", encoding="utf-8")

    truncated = scan_repository_discovery(
        tmp_path,
        repository_id="repo-truncated",
        commit_sha="f" * 40,
        max_scanned_files=1,
    )
    assert any(gap["reason"] == "FILE_COUNT_LIMIT_REACHED" for gap in truncated["knownGaps"])
    assert truncated["resourceLedger"]["coverageImpact"]["truncated"] is True
    assert truncated["resourceLedger"]["remaining"]["files"] == 0

    complete = scan_repository_discovery(
        tmp_path,
        repository_id="repo-unsupported",
        commit_sha="1" * 40,
    )
    assert "Go" in complete["unsupportedLanguages"]
    assert complete["resourceLedger"]["coverageImpact"]["unsupportedLanguageCount"] == 1


def test_discovery_stops_at_total_byte_budget_and_reports_remaining_budget(tmp_path: Path) -> None:
    first = "client.responses.create({ input: prompt });\n"
    second = "client.responses.create({ input: anotherPrompt });\n"
    (tmp_path / "a.ts").write_text(first, encoding="utf-8")
    (tmp_path / "b.ts").write_text(second, encoding="utf-8")

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-byte-budget",
        commit_sha="5" * 40,
        max_total_source_bytes=len(first.encode("utf-8")),
    )

    assert discovery["resourceLedger"]["budget"]["maxBytes"] == len(first.encode("utf-8"))
    assert discovery["resourceLedger"]["usage"]["bytesInspected"] == len(first.encode("utf-8"))
    assert discovery["resourceLedger"]["remaining"]["bytes"] == 0
    assert any(
        gap["reason"] == "TOTAL_BYTE_BUDGET_REACHED" for gap in discovery["knownGaps"]
    )
    assert discovery["resourceLedger"]["coverageImpact"]["truncated"] is True
    assert {item["path"] for item in discovery["sourceRanges"]} == {"a.ts"}


def test_discovery_honors_configurable_range_limit_with_explicit_gap(tmp_path: Path) -> None:
    (tmp_path / "many.ts").write_text(
        "\n".join(
            f"client.responses.create({{ input: prompt{index} }});" for index in range(5)
        ),
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-range-budget",
        commit_sha="6" * 40,
        max_ranges=2,
    )

    assert len(discovery["sourceRanges"]) == 2
    assert discovery["resourceLedger"]["budget"]["maxRanges"] == 2
    assert discovery["resourceLedger"]["remaining"]["ranges"] == 0
    assert any("range limit 2" in gap["detail"] for gap in discovery["knownGaps"])


def test_discovery_bounds_nested_use_case_range_collections(tmp_path: Path) -> None:
    (tmp_path / "many-calls.ts").write_text(
        "\n".join(
            f"client.responses.create({{ input: prompt{index} }});" for index in range(501)
        ),
        encoding="utf-8",
    )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-nested-bounds",
        commit_sha="9" * 40,
        max_ranges=1_000,
    )

    assert len(discovery["sourceRanges"]) == 501
    assert len(discovery["aiUseCases"][0]["invocationRangeIds"]) == 500
    assert any(
        "invocationRangeIds collection" in gap["detail"]
        for gap in discovery["knownGaps"]
    )


def test_discovery_bounds_use_cases_unresolved_calls_and_known_gaps(tmp_path: Path) -> None:
    for index in range(2_001):
        (tmp_path / f"call-{index:04d}.ts").write_text(
            "client.responses.create({ input: prompt });\n",
            encoding="utf-8",
        )

    discovery = scan_repository_discovery(
        tmp_path,
        repository_id="repo-collection-bounds",
        commit_sha="7" * 40,
        max_ranges=3_000,
    )

    assert len(discovery["aiUseCases"]) == 2_000
    assert len(discovery["unresolvedCalls"]) == 2_000
    assert len(discovery["sourceRanges"]) == 2_001
    assert any("AI use-case collection" in gap["detail"] for gap in discovery["knownGaps"])
    assert any("Unresolved-call collection" in gap["detail"] for gap in discovery["knownGaps"])

    gaps_dir = tmp_path / "gaps"
    gaps_dir.mkdir()
    for index in range(2_001):
        (gaps_dir / f"oversized-{index:04d}.py").write_text("xx", encoding="utf-8")
    gap_discovery = scan_repository_discovery(
        gaps_dir,
        repository_id="repo-gap-bounds",
        commit_sha="8" * 40,
        max_source_size_bytes=1,
    )
    assert len(gap_discovery["knownGaps"]) == 2_000
    assert "additional gaps were omitted" in gap_discovery["knownGaps"][-1]["detail"]


def test_ensure_repository_discovery_cache_binds_scanner_graph_and_pins(tmp_path: Path) -> None:
    (tmp_path / "model.py").write_text(
        "from openai import OpenAI\nclient.responses.create(input=prompt)\n",
        encoding="utf-8",
    )
    backend = FakeSandboxBackend(tmp_path)

    first = ensure_repository_discovery(
        backend,
        repository_id="repo-cache-discovery",
        commit_sha="2" * 40,
        workspace_path=tmp_path,
        graph_index_version="graph-one",
    )
    assert REPOSITORY_DISCOVERY_PATH in backend.storage
    second = ensure_repository_discovery(
        backend,
        repository_id="repo-cache-discovery",
        commit_sha="2" * 40,
        workspace_path=tmp_path,
        graph_index_version="graph-one",
    )
    assert second == first

    changed_graph = ensure_repository_discovery(
        backend,
        repository_id="repo-cache-discovery",
        commit_sha="2" * 40,
        workspace_path=tmp_path,
        graph_index_version="graph-two",
    )
    assert changed_graph["cacheIdentity"] != first["cacheIdentity"]
    assert changed_graph["graphIndexVersion"] == "graph-two"
    assert validate_repository_discovery_error(
        first,
        repository_id="repo-cache-discovery",
        commit_sha="2" * 40,
        source_path_prefix=None,
        graph_index_version="graph-two",
    ) == "graphIndexVersion mismatch"
    assert changed_graph["discoveryVersion"] == DISCOVERY_VERSION


def test_ensure_repository_discovery_persists_graph_enrichment_for_exact_cache_pins(
    tmp_path: Path,
) -> None:
    (tmp_path / "model.py").write_text(
        "def summarize(prompt):\n"
        "    return client.responses.create(input=prompt)\n",
        encoding="utf-8",
    )
    graph_version = "sha256:" + "5" * 64
    scanner_result = scan_repository_discovery(
        tmp_path,
        repository_id="repo-sandbox-graph",
        commit_sha="4" * 40,
        graph_index_version=graph_version,
    )

    class ExecutingDiscoveryBackend:
        def __init__(self):
            self.storage: dict[str, str] = {}
            self.commands: list[str] = []

        def read(self, path: str):
            if path in self.storage:
                return self.storage[path]
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, path: str, content: str):
            self.storage[path] = content
            return SimpleNamespace(error=None)

        def execute(self, command: str, timeout: int | None = None):
            self.commands.append(command)
            if "python3 -I" in command:
                assert timeout == 300
                return SimpleNamespace(exit_code=0, output=json.dumps(scanner_result))
            assert "codebase-memory-graph cli --quiet trace_path" in command
            assert timeout == 30
            return SimpleNamespace(
                exit_code=0,
                output=json.dumps(
                    {
                        "callers": {
                            "cols": ["name", "hop"],
                            "groups": [
                                {"qn_prefix": "app.jobs", "rows": [["summarize_job", 1]]}
                            ],
                        },
                        "callees": {"cols": ["name", "hop"], "groups": []},
                    }
                ),
            )

    backend = ExecutingDiscoveryBackend()
    first = ensure_repository_discovery(
        backend,
        repository_id="repo-sandbox-graph",
        commit_sha="4" * 40,
        workspace_path="/workspace/repository",
        graph_index_version=graph_version,
    )
    command_count = len(backend.commands)
    second = ensure_repository_discovery(
        backend,
        repository_id="repo-sandbox-graph",
        commit_sha="4" * 40,
        workspace_path="/workspace/repository",
        graph_index_version=graph_version,
    )

    invocation = next(
        item for item in first["sourceRanges"] if item["signalType"] == "AI_SDK_CALL"
    )
    assert invocation["callers"] == ["app.jobs.summarize_job"]
    assert first == second
    assert len(backend.commands) == command_count
    assert json.loads(backend.storage[REPOSITORY_DISCOVERY_PATH]) == first


def test_ensure_repository_profile_cache_reuse_and_invalidation(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(
        json.dumps({"name": "app", "dependencies": {"express": "^4.18.2"}}),
        encoding="utf-8"
    )
    backend = FakeSandboxBackend(tmp_path)

    # Initial scan: writes cache
    profile1 = ensure_repository_profile(
        backend,
        repository_id="repo-cache-1",
        commit_sha="d" * 40,
        source_path_prefix=None,
        workspace_path=tmp_path,
    )
    assert "/workspace/runtime/repository_profile.json" in backend.storage

    # Second call with same pins: reuses cache
    profile2 = ensure_repository_profile(
        backend,
        repository_id="repo-cache-1",
        commit_sha="d" * 40,
        source_path_prefix=None,
        workspace_path=tmp_path,
    )
    assert profile1["contentDigest"] == profile2["contentDigest"]

    # Call with changed commitSha: re-scans
    profile3 = ensure_repository_profile(
        backend,
        repository_id="repo-cache-1",
        commit_sha="e" * 40,
        source_path_prefix=None,
        workspace_path=tmp_path,
    )
    assert profile3["commitSha"] == "e" * 40


def test_missing_workspace_records_explicit_known_gap(tmp_path: Path) -> None:
    non_existent = tmp_path / "does-not-exist"
    scanner = RepositoryScanner(
        non_existent,
        repository_id="repo-missing-1",
        commit_sha="f" * 40,
    )
    profile = scanner.scan()
    assert profile["scannedFileCount"] == 0
    assert len(profile["knownGaps"]) >= 1
    gap = next((g for g in profile["knownGaps"] if g["reason"] == "WORKSPACE_NOT_FOUND"), None)
    assert gap is not None
    assert str(non_existent) in gap["detail"]

    # When workspace path is a file, not a directory
    file_path = tmp_path / "regular_file.txt"
    file_path.write_text("hello", encoding="utf-8")
    scanner_file = RepositoryScanner(
        file_path,
        repository_id="repo-file-1",
        commit_sha="f" * 40,
    )
    file_profile = scanner_file.scan()
    assert file_profile["scannedFileCount"] == 0
    assert any(g["reason"] == "WORKSPACE_NOT_DIRECTORY" for g in file_profile["knownGaps"])


def test_zero_file_scan_produces_valid_profile(tmp_path: Path) -> None:
    empty_workspace = tmp_path / "empty_repo"
    empty_workspace.mkdir(parents=True)
    profile = scan_repository_workspace(
        empty_workspace,
        repository_id="repo-zero-1",
        commit_sha="0" * 40,
    )
    assert profile["scannedFileCount"] == 0
    assert profile["languages"] == []
    assert profile["manifests"] == []
    assert profile["knownGaps"] == []
    assert profile["contentDigest"].startswith("sha256:")


def test_ensure_repository_profile_executes_in_sandbox_when_supported(tmp_path: Path) -> None:
    class SandboxExecutionBackend:
        def __init__(self):
            self.storage: dict[str, str] = {}
            self.commands: list[str] = []

        def read(self, path: str):
            if path in self.storage:
                return self.storage[path]
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, path: str, content: str):
            self.storage[path] = content
            return SimpleNamespace(error=None)

        def execute(self, cmd: str, timeout: int | None = None):
            self.commands.append(cmd)
            # Simulate running scanner inside sandbox returning a valid profile JSON
            mock_profile = {
                "repositoryId": "repo-sandbox-1",
                "commitSha": "1" * 40,
                "scannerVersion": SCANNER_VERSION,
                "sourcePathPrefix": None,
                "scannedFileCount": 3,
                "languages": [{"language": "Python", "fileCount": 3, "estimatedLines": 100}],
                "manifests": [],
                "frameworks": [],
                "buildSystems": [],
                "ciWorkflows": [],
                "containerization": [],
                "candidateFacts": [],
                "knownGaps": [],
            }
            mock_profile["contentDigest"] = compute_profile_digest(mock_profile)
            return SimpleNamespace(exit_code=0, output=json.dumps(mock_profile))

    backend = SandboxExecutionBackend()
    profile = ensure_repository_profile(
        backend,
        repository_id="repo-sandbox-1",
        commit_sha="1" * 40,
        source_path_prefix=None,
        workspace_path="/workspace/repository",
    )

    assert len(backend.commands) == 1
    assert "python3 -I" in backend.commands[0]
    assert "/tmp/.lcsp_scanner_" in backend.commands[0]
    assert profile["scannedFileCount"] == 3
    assert profile["contentDigest"].startswith("sha256:")
    assert "/workspace/runtime/repository_profile.json" in backend.storage

    # Second call with same pins reuses cache without calling execute again
    profile2 = ensure_repository_profile(
        backend,
        repository_id="repo-sandbox-1",
        commit_sha="1" * 40,
        source_path_prefix=None,
        workspace_path="/workspace/repository",
    )
    assert len(backend.commands) == 1
    assert profile2["contentDigest"] == profile["contentDigest"]


def test_ensure_repository_profile_fails_closed_without_host_fallback() -> None:
    class FailingSandboxBackend:
        def __init__(self):
            self.executed = False

        def read(self, _path: str):
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, _path: str, _content: str):
            return SimpleNamespace(error=None)

        def execute(self, _cmd: str, timeout: int | None = None):
            self.executed = True
            return SimpleNamespace(exit_code=1, output="sandbox crashed", stderr="segmentation fault")

    backend = FailingSandboxBackend()
    with pytest.raises(RuntimeError) as exc_info:
        ensure_repository_profile(
            backend,
            repository_id="repo-fail-1",
            commit_sha="2" * 40,
            source_path_prefix=None,
            workspace_path="/workspace/repository",
        )
    assert backend.executed is True
    assert "Docker sandbox repository pre-scan failed with exit code 1" in str(exc_info.value)


def test_ensure_repository_profile_rejects_corrupted_digest() -> None:
    class CorruptedDigestBackend:
        def __init__(self):
            self.commands: list[str] = []

        def read(self, _path: str):
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, _path: str, _content: str):
            return SimpleNamespace(error=None)

        def execute(self, cmd: str, timeout: int | None = None):
            self.commands.append(cmd)
            mock_profile = {
                "repositoryId": "repo-corrupt-1",
                "commitSha": "3" * 40,
                "scannerVersion": SCANNER_VERSION,
                "sourcePathPrefix": None,
                "scannedFileCount": 1,
                "languages": [],
                "manifests": [],
                "frameworks": [],
                "buildSystems": [],
                "ciWorkflows": [],
                "containerization": [],
                "candidateFacts": [],
                "knownGaps": [],
                "contentDigest": "sha256:" + "f" * 64,  # Intentionally fraudulent digest
            }
            return SimpleNamespace(exit_code=0, output=json.dumps(mock_profile))

    backend = CorruptedDigestBackend()
    with pytest.raises(RuntimeError) as exc_info:
        ensure_repository_profile(
            backend,
            repository_id="repo-corrupt-1",
            commit_sha="3" * 40,
            source_path_prefix=None,
            workspace_path="/workspace/repository",
        )
    assert "contentDigest mismatch" in str(exc_info.value)


def test_ensure_repository_profile_invalidates_corrupted_cache(tmp_path: Path) -> None:
    (tmp_path / "index.js").write_text("console.log('hello');\n", encoding="utf-8")
    backend = FakeSandboxBackend(tmp_path)
    # Put corrupted cache marker
    corrupted_cached = {
        "repositoryId": "repo-cache-inv",
        "commitSha": "4" * 40,
        "scannerVersion": SCANNER_VERSION,
        "sourcePathPrefix": None,
        "scannedFileCount": 1,
        "languages": [],
        "manifests": [],
        "frameworks": [],
        "buildSystems": [],
        "ciWorkflows": [],
        "containerization": [],
        "candidateFacts": [],
        "knownGaps": [],
        "contentDigest": "sha256:corrupted",
    }
    backend.write(
        "/workspace/runtime/repository_profile.json",
        json.dumps(corrupted_cached),
    )

    # Calling ensure_repository_profile should detect invalid cached digest, ignore cache, and re-scan
    profile = ensure_repository_profile(
        backend,
        repository_id="repo-cache-inv",
        commit_sha="4" * 40,
        source_path_prefix=None,
        workspace_path=tmp_path,
    )
    assert profile["contentDigest"] != "sha256:corrupted"
    assert profile["contentDigest"].startswith("sha256:")
    assert profile["scannedFileCount"] == 1


def test_ensure_repository_profile_fails_closed_on_write_staging_failure() -> None:
    class FailingWriteBackend:
        def __init__(self):
            self.execute_called = False

        def read(self, _path: str):
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, _path: str, _content: str):
            return SimpleNamespace(error="Permission denied writing /tmp staged file")

        def execute(self, _cmd: str, timeout: int | None = None):
            self.execute_called = True
            return SimpleNamespace(exit_code=0, output="{}")

    backend = FailingWriteBackend()
    with pytest.raises(RuntimeError) as exc_info:
        ensure_repository_profile(
            backend,
            repository_id="repo-write-fail-1",
            commit_sha="5" * 40,
            source_path_prefix=None,
            workspace_path="/workspace/repository",
        )
    assert "Failed to stage pre-scan tool into sandbox" in str(exc_info.value)
    assert "Permission denied writing /tmp staged file" in str(exc_info.value)
    assert backend.execute_called is False, "Execution must not be attempted if staging write failed"


def test_ensure_repository_profile_binds_execution_to_versioned_digest_and_prevents_stale_script() -> None:
    executed_commands = []
    written_paths = []

    class CapturingBackend:
        def read(self, _path: str):
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, path: str, _content: str):
            written_paths.append(path)
            return SimpleNamespace(error=None)

        def execute(self, cmd: str, timeout: int | None = None):
            executed_commands.append(cmd)
            mock_profile = {
                "repositoryId": "repo-digest-bind-1",
                "commitSha": "6" * 40,
                "scannerVersion": SCANNER_VERSION,
                "sourcePathPrefix": None,
                "scannedFileCount": 0,
                "languages": [],
                "manifests": [],
                "frameworks": [],
                "buildSystems": [],
                "ciWorkflows": [],
                "containerization": [],
                "candidateFacts": [],
                "knownGaps": [],
            }
            mock_profile["contentDigest"] = compute_profile_digest(mock_profile)
            return SimpleNamespace(exit_code=0, output=json.dumps(mock_profile))

    backend = CapturingBackend()
    profile = ensure_repository_profile(
        backend,
        repository_id="repo-digest-bind-1",
        commit_sha="6" * 40,
        source_path_prefix=None,
        workspace_path="/workspace/repository",
    )
    assert profile["repositoryId"] == "repo-digest-bind-1"
    assert len(written_paths) >= 1
    staged_path = written_paths[0]
    assert staged_path.startswith("/tmp/.lcsp_scanner_")
    assert staged_path.endswith(".py")
    assert any(staged_path in cmd for cmd in executed_commands)
    # Ensure execution called isolated python with the exact staged path
    assert any(f"python3 -I {staged_path}" in cmd for cmd in executed_commands)


def test_ensure_repository_profile_fails_on_invalid_profile_schema() -> None:
    class MalformedSchemaBackend:
        def read(self, _path: str):
            return SimpleNamespace(error="NOT_FOUND")

        def write(self, _path: str, _content: str):
            return SimpleNamespace(error=None)

        def execute(self, _cmd: str, timeout: int | None = None):
            # Missing required fields like languages, manifests, frameworks
            bad_profile = {
                "repositoryId": "repo-bad-schema-1",
                "commitSha": "7" * 40,
                "scannerVersion": SCANNER_VERSION,
            }
            return SimpleNamespace(exit_code=0, output=json.dumps(bad_profile))

    backend = MalformedSchemaBackend()
    with pytest.raises(RuntimeError) as exc_info:
        ensure_repository_profile(
            backend,
            repository_id="repo-bad-schema-1",
            commit_sha="7" * 40,
            source_path_prefix=None,
            workspace_path="/workspace/repository",
        )
    assert "Docker sandbox repository pre-scan produced invalid profile" in str(exc_info.value)





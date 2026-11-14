from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.common.capabilities.platform.repository_scanner import (
    SCANNER_VERSION,
    RepositoryScanner,
    compute_profile_digest,
    ensure_repository_profile,
    scan_repository_workspace,
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
                "ciSystems": [],
                "containerization": [],
                "candidateFacts": [],
                "knownGaps": [],
                "contentDigest": "sha256:mockdigest",
            }
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
    assert "scan_repository_workspace" in backend.commands[0]
    assert profile["scannedFileCount"] == 3
    assert profile["contentDigest"] == "sha256:mockdigest"
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



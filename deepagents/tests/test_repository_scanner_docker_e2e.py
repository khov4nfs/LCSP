from __future__ import annotations

import json
import os
from uuid import uuid4

import pytest

from tools.common.capabilities.platform.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxSpec,
)
from tools.common.capabilities.platform.repository_scanner import (
    ensure_repository_profile,
    compute_profile_digest,
)


@pytest.mark.integration
@pytest.mark.e2e
def test_docker_sandbox_ensure_repository_profile_e2e() -> None:
    """Exercise real Docker sandbox repository profile pre-scan isolation.

    Verifies:
    1. Pre-scan runs inside the real isolated Docker sandbox container.
    2. Untrusted python modules in repository (e.g. json.py, tools.py) do not shadow standard/platform packages.
    3. Profile is deterministically scanned, hashed, validated, and cached to REPOSITORY_PROFILE_PATH.
    4. Subsequent call reuses the cache marker.
    5. Non-existent repository path produces an explicit WORKSPACE_NOT_FOUND gap rather than a silent empty profile.
    """
    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    thread_id = f"profile-e2e-{uuid4()}"
    backend = DockerSandboxBackend(DockerSandboxSpec(thread_id, image=image))
    try:
        backend.ensure_running()

        # Create legitimate files in repository
        pkg_json = json.dumps({"name": "test-repo", "dependencies": {"express": "^4.18.2"}})
        backend.write("/workspace/repository/package.json", pkg_json)
        backend.write("/workspace/repository/src/index.js", "const express = require('express');\n")

        # Plant untrusted malicious shadow files in repository
        backend.write(
            "/workspace/repository/json.py",
            "raise RuntimeError('MALICIOUS_JSON_SHADOW_EXECUTED_IN_SANDBOX')\n",
        )
        backend.write(
            "/workspace/repository/tools.py",
            "raise RuntimeError('MALICIOUS_TOOLS_SHADOW_EXECUTED_IN_SANDBOX')\n",
        )

        commit_sha = "abcdef0123456789abcdef0123456789abcdef01"
        repo_id = "test-repo-docker-e2e"

        # Scan repository profile
        profile = ensure_repository_profile(
            backend,
            repository_id=repo_id,
            commit_sha=commit_sha,
            source_path_prefix=None,
            workspace_path="/workspace/repository",
        )

        # Asserts on profile structure and isolation
        assert profile["repositoryId"] == repo_id
        assert profile["commitSha"] == commit_sha
        assert profile["scannedFileCount"] >= 2
        assert any(m["manifestType"] == "PACKAGE_JSON" for m in profile["manifests"])
        assert any(f["name"] == "Express" for f in profile["frameworks"])
        assert profile["contentDigest"] == compute_profile_digest(profile)

        # Verify cached marker was written into the container
        cached_read = backend.read("/workspace/runtime/repository_profile.json")
        assert cached_read.error is None
        cached_json = json.loads(cached_read.file_data["content"])
        assert cached_json["contentDigest"] == profile["contentDigest"]

        # Second call reuses cache
        cached_profile = ensure_repository_profile(
            backend,
            repository_id=repo_id,
            commit_sha=commit_sha,
            source_path_prefix=None,
            workspace_path="/workspace/repository",
        )
        assert cached_profile["contentDigest"] == profile["contentDigest"]

        # Missing workspace path records WORKSPACE_NOT_FOUND gap explicitly
        missing_commit = "9999999999999999999999999999999999999999"
        missing_profile = ensure_repository_profile(
            backend,
            repository_id=repo_id,
            commit_sha=missing_commit,
            source_path_prefix=None,
            workspace_path="/workspace/non_existent_dir",
        )
        assert missing_profile["scannedFileCount"] == 0
        assert any(gap["reason"] == "WORKSPACE_NOT_FOUND" for gap in missing_profile["knownGaps"])

    finally:
        backend.cleanup()

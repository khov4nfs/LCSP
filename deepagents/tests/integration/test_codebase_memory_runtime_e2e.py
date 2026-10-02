from __future__ import annotations

import json
import os
import shlex
from uuid import uuid4

import pytest

from tools.common.capabilities.platform.docker_sandbox import (
    DockerSandboxBackend,
    DockerSandboxSpec,
)
from tools.common.capabilities.platform.repository_sandbox import (
    repository_database_backend,
)


EXPECTED_CODEBASE_MEMORY_VERSION = "0.11.0"


def _run_json(repository, command: str) -> dict:
    result = repository.execute(command, timeout=90)
    assert result.exit_code == 0, result.output
    output = result.output.strip()
    assert output, f"Codebase Memory returned no output for {command}"
    return json.loads(output.splitlines()[-1])


@pytest.mark.integration
@pytest.mark.e2e
def test_codebase_memory_indexes_searches_and_reports_coverage_for_repository() -> None:
    """Exercise the exact Codebase Memory runtime baked into the repository sandbox."""

    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    project = f"lcsp-agent-runtime-cbm-e2e-{uuid4().hex[:12]}"
    backend = DockerSandboxBackend(
        DockerSandboxSpec(f"codebase-memory-e2e-{uuid4()}", image=image)
    )

    try:
        backend.ensure_running()
        repository = repository_database_backend(backend)
        repository.write(
            "app.py",
            "def greet(name: str) -> str:\n"
            "    return f\"hello {name}\"\n\n"
            "def main() -> None:\n"
            "    print(greet(\"LCSP\"))\n",
        )

        version = repository.execute("codebase-memory-graph --version", timeout=20)
        assert version.exit_code == 0, version.output
        assert (
            f"codebase-memory-mcp {EXPECTED_CODEBASE_MEMORY_VERSION}" in version.output
        )

        indexed = _run_json(
            repository,
            " ".join(
                [
                    "codebase-memory-graph cli --quiet index_repository",
                    "--repo-path /workspace/repository",
                    f"--name {shlex.quote(project)}",
                    "--mode fast",
                ]
            ),
        )
        assert indexed["status"] == "indexed"
        assert indexed["not_indexed_files_count"] == 0
        assert indexed["skipped_count"] == 0

        architecture_args = shlex.quote(
            json.dumps({"project": project, "format": "json"})
        )
        architecture = _run_json(
            repository,
            f"codebase-memory-graph cli --quiet get_architecture {architecture_args}",
        )
        assert architecture["project"] == project

        search_args = shlex.quote(
            json.dumps({"project": project, "query": "greet", "format": "json"})
        )
        search = _run_json(
            repository,
            f"codebase-memory-graph cli --quiet search_graph {search_args}",
        )
        assert search["total"] >= 1
        assert any(row[0].endswith(".greet") for row in search["rows"])

        coverage_args = shlex.quote(
            json.dumps(
                {
                    "project": project,
                    "paths": ["app.py"],
                    "diagnostics": "full",
                    "format": "json",
                }
            )
        )
        coverage = _run_json(
            repository,
            f"codebase-memory-graph cli --quiet check_index_coverage {coverage_args}",
        )
        assert coverage["project"] == project
        assert coverage["paths"][0]["path"] == "app.py"
        assert coverage["paths"][0]["status"] == "no_recorded_issue"
        assert coverage["paths"][0]["freshness"] == "metadata_match"
    finally:
        backend.cleanup()

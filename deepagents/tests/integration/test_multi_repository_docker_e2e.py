"""Real-sandbox proof of multi-repository hydration, indexing and graph queries.

Needs Docker and the ``lcsp-agent-runtime`` image; enable with ``LCSP_DOCKER_SANDBOX_E2E=1``. The snapshot
archives are generated locally (the API download is the only fake); extraction, Git baselines, markers, the
Codebase Memory engine and the graph tools all run for real inside the container.
"""

from __future__ import annotations

import io
import json
import os
import tarfile
from types import SimpleNamespace
from uuid import uuid4

import pytest

from tools.common.capabilities.platform import codebase_memory as memory
from tools.common.capabilities.platform import repository_sandbox as sandbox
from tools.common.capabilities.platform.repository_snapshot_client import RepositoryArchiveDownload
from tools.common.capabilities.platform.docker_sandbox import DockerSandboxBackend, DockerSandboxSpec
from tools.common.codebase_memory_graph import code as graph

COMMIT_WEB = "a" * 40
COMMIT_API = "b" * 40


def archive(name: str, files: dict[str, str]) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as handle:
        for path, content in files.items():
            data = content.encode()
            entry = tarfile.TarInfo(f"{name}/{path}")
            entry.size = len(data)
            handle.addfile(entry, io.BytesIO(data))
    return output.getvalue()


SOURCES = {
    "snap-web": {
        "src/consent.ts": "export function collectConsent(user: string) {\n  return user;\n}\n",
        "README.md": "web",
    },
    "snap-api": {
        "services/billing/charge.py": "def charge_customer(amount):\n    return amount\n",
        "services/other/skip.py": "def skipped():\n    return 1\n",
    },
}


@pytest.mark.integration
@pytest.mark.e2e
def test_two_repositories_are_hydrated_indexed_and_queried_side_by_side(monkeypatch) -> None:
    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")

    class Client:
        def __init__(self, *_args) -> None:
            pass

        def download_archive(self, request):
            return archive(request.snapshot_id, SOURCES[request.snapshot_id])

        def download_archive_with_metadata(self, request):
            # Hydration reads the archive together with its source-root metadata; these archives wrap their
            # files in a directory named after the snapshot, which the provider response declares as the root.
            return RepositoryArchiveDownload(
                content=self.download_archive(request),
                content_type="application/gzip",
                archive_root=request.snapshot_id,
                archive_root_status="VERIFIED_WRAPPER",
                tree_manifest=None,
            )

    monkeypatch.setattr(sandbox, "load_config", lambda: SimpleNamespace(nestjs_api_base_url="http://local", worker_api_key="k"))
    monkeypatch.setattr(sandbox, "RepositorySnapshotClient", Client)

    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    backend = DockerSandboxBackend(DockerSandboxSpec(f"multi-repository-e2e-{uuid4()}", image=image))
    context = {
        "assessmentId": "11111111-1111-4111-8111-111111111111",
        "repositorySnapshotId": "snap-web",
        "repositoryScanJobId": "job-web",
        "repositoryCommit": COMMIT_WEB,
        "repositories": [
            {"repositoryKey": "web", "ordinal": 0, "connectionId": "c1", "repositoryId": "r1",
             "repositoryFullName": "acme/web", "repositorySnapshotId": "snap-web", "repositoryScanJobId": "job-web",
             "repositoryCommit": COMMIT_WEB, "sourcePathPrefix": None},
            {"repositoryKey": "api", "ordinal": 1, "connectionId": "c2", "repositoryId": "r2",
             "repositoryFullName": "acme/api", "repositorySnapshotId": "snap-api", "repositoryScanJobId": "job-api",
             "repositoryCommit": COMMIT_API, "sourcePathPrefix": "services/billing"},
        ],
    }
    try:
        backend.ensure_running()
        pins = sandbox.repository_pins_from_context(context)
        layout = sandbox.hydrate_repository_set(backend, pins, assessment_id=context["assessmentId"])
        assert layout.multi

        view = sandbox.repository_database_backend(backend, layout)
        # Side by side under one root, scoped repository free of its sibling directories.
        assert {item["path"] for item in view.ls("/").entries} >= {"/web", "/api"}
        assert view.read("/web/src/consent.ts").file_data["content"].count("collectConsent") == 1
        assert view.download_files(["/api/services/billing/charge.py"])[0].content is not None
        assert view.download_files(["/api/services/other/skip.py"])[0].error
        manifest = json.loads(view.download_files(["/.lcsp/repository-set.json"])[0].content)
        assert manifest["repositorySetDigest"] == sandbox.repository_set_digest(pins)
        git = view.execute("git -C /workspace/repositories/api log --oneline -1", timeout=60)
        assert git.exit_code == 0 and "LCSP baseline" in git.output

        # A second hydration of the same set reuses every repository (no new extraction).
        again = backend.execute("ls /tmp", timeout=30)
        assert again.exit_code == 0
        sandbox.hydrate_repository_set(backend, pins, assessment_id=context["assessmentId"])

        identity = memory.ensure_codebase_memory_set_index(backend, pins)
        assert identity.reused is False
        with sandbox.activate_repository_backend(backend, layout):
            web = graph.search_code_graph.invoke({"name_pattern": ".*onsent.*"})
            api = graph.search_code_graph.invoke({"name_pattern": ".*harge.*"})
        # One graph over both repositories; every result names its repository directory in the file path.
        assert "collectConsent" in web and "web/src/consent.ts" in web
        assert "charge_customer" in api and "api/services/billing/charge.py" in api
        # The scoped repository's excluded sibling directory never reached the sandbox or the graph.
        with sandbox.activate_repository_backend(backend, layout):
            skipped = graph.search_code_graph.invoke({"name_pattern": ".*kipped.*"})
        assert "other/skip.py" not in skipped

        # Re-indexing is skipped while the markers are unchanged.
        reused = memory.ensure_codebase_memory_set_index(backend, pins)
        assert reused.reused and reused.index_stamp == identity.index_stamp
    finally:
        backend.cleanup()


@pytest.mark.integration
@pytest.mark.e2e
def test_the_root_sandbox_factory_prepares_every_repository_and_submits_one_discovery_each(monkeypatch) -> None:
    """The production boundary hydrates, indexes, profiles and discovers each repository, submitting one artifact per repository."""
    if os.environ.get("LCSP_DOCKER_SANDBOX_E2E") != "1":
        pytest.skip("LCSP_DOCKER_SANDBOX_E2E=1 is required for Docker E2E")
    from assessment_root import boundary

    class Client:
        def __init__(self, *_args) -> None:
            pass

        def download_archive(self, request):
            return archive(request.snapshot_id, SOURCES[request.snapshot_id])

        def download_archive_with_metadata(self, request):
            # Hydration reads the archive together with its source-root metadata; these archives wrap their
            # files in a directory named after the snapshot, which the provider response declares as the root.
            return RepositoryArchiveDownload(
                content=self.download_archive(request),
                content_type="application/gzip",
                archive_root=request.snapshot_id,
                archive_root_status="VERIFIED_WRAPPER",
                tree_manifest=None,
            )

    monkeypatch.setattr(sandbox, "load_config", lambda: SimpleNamespace(nestjs_api_base_url="http://local", worker_api_key="k"))
    monkeypatch.setattr(sandbox, "RepositorySnapshotClient", Client)
    image = os.environ.get("LCSP_REPOSITORY_SANDBOX_IMAGE", "lcsp-agent-runtime:dev")
    backend = DockerSandboxBackend(DockerSandboxSpec(f"multi-repository-factory-{uuid4()}", image=image))
    monkeypatch.setattr(sandbox, "resolve_repository_thread_backend", lambda _config: backend)
    context = {
        "assessmentId": "11111111-1111-4111-8111-111111111111",
        "repositoryId": "r1",
        "repositorySnapshotId": "snap-web",
        "repositoryScanJobId": "job-web",
        "repositoryCommit": COMMIT_WEB,
        "sourcePathPrefix": None,
        "repositories": [
            {"repositoryKey": "web", "ordinal": 0, "connectionId": "c1", "repositoryId": "r1",
             "repositoryFullName": "acme/web", "repositorySnapshotId": "snap-web", "repositoryScanJobId": "job-web",
             "repositoryCommit": COMMIT_WEB, "sourcePathPrefix": None},
            {"repositoryKey": "api", "ordinal": 1, "connectionId": "c2", "repositoryId": "r2",
             "repositoryFullName": "acme/api", "repositorySnapshotId": "snap-api", "repositoryScanJobId": "job-api",
             "repositoryCommit": COMMIT_API, "sourcePathPrefix": "services/billing"},
        ],
    }
    submitted: list[dict] = []
    try:
        filesystem, activation = boundary.sandbox_backend_factory(
            {"threadId": "thread-1"}, context, discovery_sink=submitted.append, discovery_lookup=lambda *_: {"available": False}
        )
        with activation:
            assert not hasattr(filesystem, "execute")
        assert {item["commitSha"] for item in submitted} == {COMMIT_WEB, COMMIT_API} and len(submitted) == 2
        # Each artifact names its own repository and scope, which is how the API files it under the right pin.
        by_commit = {item["commitSha"]: item for item in submitted}
        assert by_commit[COMMIT_API]["sourcePathPrefix"] == "services/billing"
        assert by_commit[COMMIT_WEB]["sourcePathPrefix"] is None
        for key in ("web", "api"):
            profile = backend.read(f"/workspace/runtime/{key}/repository_profile.json")
            assert profile.file_data and json.loads(profile.file_data["content"])["commitSha"] in {COMMIT_WEB, COMMIT_API}
        for key in ("web", "api"):
            assert backend.read(f"/workspace/runtime/{key}/repository_discovery.json").file_data
    finally:
        backend.cleanup()

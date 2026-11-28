"""Offline proof of the worker's multi-repository support.

Several repositories are pinned to one assessment, mounted side by side (one directory per repository key),
indexed once each, addressed as ``/<repositoryKey>/<path>`` and cited with their own commit. One pinned
repository keeps the original layout and is covered by the existing single-repository tests.
"""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from deepagents.backends import FilesystemBackend

from assessment_root.tools import RootRun, build_root_tools
from test_assessment_root_agent import ASSESSMENT, COMMIT, EXECUTION, PINS, THREAD, FakeClient
from tools.common.capabilities.platform import codebase_memory as memory
from tools.common.capabilities.platform import repository_sandbox as sandbox
from tools.common.capabilities.platform.repository_snapshot_client import RepositoryArchiveDownload
from tools.common.codebase_memory_graph import code as graph

REPO_ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads(
    (REPO_ROOT / "packages/contracts/test/fixtures/repository-set-digest.json").read_text(encoding="utf-8")
)
COMMIT_API = "b" * 40


def pin_payload(key: str, ordinal: int, commit: str, prefix: str | None = None) -> dict[str, Any]:
    return {
        "repositoryKey": key,
        "ordinal": ordinal,
        "connectionId": f"conn-{key}",
        "repositoryId": f"repo-{key}",
        "repositoryFullName": f"acme/{key}",
        "repositorySnapshotId": f"snap-{key}",
        "repositoryScanJobId": f"job-{key}",
        "repositoryCommit": commit,
        "sourcePathPrefix": prefix,
    }


def two_repository_context(**overrides: Any) -> dict[str, Any]:
    pins = [pin_payload("web", 0, COMMIT), pin_payload("api", 1, COMMIT_API, "services/billing")]
    context: dict[str, Any] = {
        "assessmentId": ASSESSMENT,
        "repositorySnapshotId": "snap-web",
        "repositoryScanJobId": "job-web",
        "repositoryCommit": COMMIT,
        "repositories": pins,
    }
    context.update(overrides)
    return context


# ---------------------------------------------------------------------------------- pins and digest


@pytest.mark.parametrize("vector", VECTORS["digestVectors"], ids=lambda item: item["name"])
def test_digest_matches_the_typescript_contract_vectors(vector) -> None:
    pins = [
        sandbox.RepositoryPin(
            key=item["repositoryKey"],
            ordinal=item["ordinal"],
            snapshot_id=item["repositorySnapshotId"],
            scan_job_id="job",
            commit_sha=item["repositoryCommit"],
            source_path_prefix=item["sourcePathPrefix"],
        )
        for item in vector["pins"]
    ]
    assert sandbox.repository_set_digest(pins) == vector["digest"]


def test_a_context_without_a_repository_list_is_a_set_of_one_with_the_original_layout() -> None:
    pins = sandbox.repository_pins_from_context(
        {"repositorySnapshotId": "s", "repositoryScanJobId": "j", "repositoryCommit": COMMIT, "sourcePathPrefix": "apps/web"}
    )
    assert len(pins) == 1 and pins[0].source_path_prefix == "apps/web"
    layout = sandbox.repository_layout_for(pins)
    assert layout.multi is False and layout.root == sandbox.REPOSITORY_ROOT


def test_several_pins_use_the_side_by_side_layout_in_pin_order() -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    assert [pin.key for pin in pins] == ["web", "api"]
    assert sandbox.repository_layout_for(pins) == sandbox.MULTI_REPOSITORY_LAYOUT
    assert pins[1].root == "/workspace/repositories/api"


@pytest.mark.parametrize(
    "mutation",
    [
        lambda c: c["repositories"][0].update(repositoryKey="Bad Key"),
        lambda c: c["repositories"][0].update(repositoryKey="../escape"),
        lambda c: c["repositories"][1].update(repositoryKey="web"),
        lambda c: c["repositories"][1].update(repositoryCommit="not-a-commit"),
        lambda c: c["repositories"][1].update(ordinal=5),
        lambda c: c["repositories"][1].update(sourcePathPrefix="../outside"),
        lambda c: c.update(repositorySnapshotId="another-snapshot"),
    ],
)
def test_malformed_or_inconsistent_pins_are_rejected_before_any_sandbox_access(mutation) -> None:
    context = two_repository_context()
    mutation(context)
    with pytest.raises(ValueError):
        sandbox.repository_pins_from_context(context)


# ------------------------------------------------------------------------------------ the sandbox view


def test_agent_paths_map_into_the_repository_directories_and_back() -> None:
    raw = SimpleNamespace(ls=lambda path: SimpleNamespace(entries=[{"path": path + "/src"}], error=None))
    backend = sandbox.AssessmentRepositoryBackend(raw, sandbox.MULTI_REPOSITORY_LAYOUT)
    assert backend._real("/web/src/app.ts") == "/workspace/repositories/web/src/app.ts"
    assert backend._real("/") == "/workspace/repositories"
    assert backend._virtual("/workspace/repositories/api/x.py") == "/api/x.py"
    assert backend._virtual("/workspace/repositories") == "/"
    assert backend.ls("/web").entries == [{"path": "/web/src"}]
    with pytest.raises(ValueError):
        backend._real("/web/../../etc/passwd")


def test_shell_commands_start_in_the_shared_root_not_in_one_repository() -> None:
    commands: list[str] = []
    raw = SimpleNamespace(execute=lambda command, **_kw: commands.append(command))
    sandbox.AssessmentRepositoryBackend(raw, sandbox.MULTI_REPOSITORY_LAYOUT).execute("ls")
    assert commands == ["cd /workspace/repositories && ls"]


@pytest.mark.parametrize(
    "path,allowed",
    [
        ("/.lcsp/agent/note.md", True),
        ("/web/src/app.ts", False),
        ("/web/.lcsp/repository.json", False),
        ("/.lcsp/repository-set.json", False),
        ("/.lcsp/agent/../repository-set.json", False),
    ],
)
def test_only_the_shared_agent_state_is_writable_in_the_multi_repository_layout(path, allowed) -> None:
    raw = SimpleNamespace(write=lambda *_a, **_k: SimpleNamespace(error=None, path="/workspace/repositories/.lcsp/agent/note.md"))
    with sandbox.activate_repository_backend(raw, sandbox.MULTI_REPOSITORY_LAYOUT):
        backend = sandbox.RuntimeRepositoryFilesystemBackend(read_only_repository=True)
        assert (backend.write(path, "x").error is None) is allowed


# -------------------------------------------------------------------------------------- hydration


class FakeSandbox:
    """A stateful sandbox that records commands and keeps written files."""

    def __init__(self, files: dict[str, str] | None = None) -> None:
        self.files = dict(files or {})
        self.commands: list[str] = []
        self.uploads: list[str] = []

    def read(self, path: str, offset: int = 0, limit: int = 2000):
        if path not in self.files:
            return SimpleNamespace(error="not found", file_data=None)
        return SimpleNamespace(error=None, file_data={"content": self.files[path]})

    def write(self, path: str, content: str):
        self.files[path] = content
        return SimpleNamespace(error=None, path=path)

    def upload_files(self, files):
        self.uploads.extend(path for path, _ in files)
        return [SimpleNamespace(error=None) for _ in files]

    def execute(self, command: str, **_kwargs):
        self.commands.append(command)
        return SimpleNamespace(exit_code=0, output="")


def source_archive(name: str) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as handle:
        for entry_name, content in [
            (f"{name}/main.py", f"print({name!r})".encode()),
            (f"{name}/services/billing/charge.py", b"charge()"),
        ]:
            entry = tarfile.TarInfo(entry_name)
            entry.size = len(content)
            handle.addfile(entry, io.BytesIO(content))
    return output.getvalue()


@pytest.fixture()
def downloads(monkeypatch):
    requested: list[str] = []

    class Client:
        def __init__(self, *_args) -> None:
            pass

        def download_archive(self, request):
            requested.append(request.snapshot_id)
            return source_archive(request.snapshot_id)

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
    return requested


def test_every_pinned_repository_is_hydrated_into_its_own_directory_with_a_manifest(downloads) -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    box = FakeSandbox()

    layout = sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)

    assert layout.multi and downloads == ["snap-web", "snap-api"]
    assert box.uploads == [
        "/tmp/lcsp-assessment-repository-web.tar.gz",
        "/tmp/lcsp-assessment-repository-api.tar.gz",
    ]
    extractions = [c for c in box.commands if "tar -xzf" in c]
    assert "-C /workspace/repositories/web" in extractions[0] and "-C /workspace/repositories/api" in extractions[1]
    # Only each repository's own directory is ever emptied, never the shared root.
    assert all("find /workspace/repositories -mindepth" not in c for c in extractions)
    web_marker = json.loads(box.files["/workspace/repositories/web/.lcsp/repository.json"])
    api_marker = json.loads(box.files["/workspace/repositories/api/.lcsp/repository.json"])
    assert (web_marker["repositoryKey"], web_marker["commitSha"]) == ("web", COMMIT)
    assert api_marker["sourcePathPrefix"] == "services/billing"
    assert api_marker["sourceCoverage"]["includedFiles"] == 1
    manifest = json.loads(box.files[sandbox.REPOSITORY_SET_META])
    assert manifest["repositorySetDigest"] == sandbox.repository_set_digest(pins)
    assert [item["repositoryKey"] for item in manifest["repositories"]] == ["web", "api"]
    assert any(command == f"mkdir -p {sandbox.REPOSITORIES_AGENT_STATE}" for command in box.commands)


def test_each_repository_hydration_is_logged_under_its_key_and_a_resumed_one_is_reported_reused(downloads) -> None:
    from structlog.testing import capture_logs

    pins = sandbox.repository_pins_from_context(two_repository_context())
    box = FakeSandbox()
    with capture_logs() as first:
        sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)
    with capture_logs() as second:
        sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)

    hydrated = [event for event in first if event["event"] == "ASSESSMENT_REPOSITORY_HYDRATED"]
    assert [(event["repository_key"], event["reused"]) for event in hydrated] == [("web", False), ("api", False)]
    assert all(event["duration_ms"] >= 0 and event["assessment_id"] == ASSESSMENT for event in hydrated)
    assert [event["reused"] for event in second if event["event"] == "ASSESSMENT_REPOSITORY_HYDRATED"] == [True, True]


def test_a_failed_repository_hydration_is_logged_with_its_key_and_still_stops_the_set(downloads, monkeypatch) -> None:
    from structlog.testing import capture_logs

    pins = sandbox.repository_pins_from_context(two_repository_context())

    def broken(*_args, **_kwargs):
        raise RuntimeError("download refused")

    monkeypatch.setattr(sandbox, "_hydrate_one_repository", broken)
    with capture_logs() as logs, pytest.raises(RuntimeError, match="download refused"):
        sandbox.hydrate_repository_set(FakeSandbox(), pins, assessment_id=ASSESSMENT)

    failed = [event for event in logs if event["event"] == "ASSESSMENT_REPOSITORY_HYDRATION_FAILED"]
    assert [(event["repository_key"], event["error_type"]) for event in failed] == [("web", "RuntimeError")]


def test_a_resumed_sandbox_reuses_matching_repositories_without_downloading(downloads) -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    box = FakeSandbox()
    sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)
    downloads.clear()
    box.commands.clear()

    sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)

    assert downloads == [] and not any("tar -xzf" in c for c in box.commands)


def test_a_manifest_for_another_repository_set_is_refused_before_any_download(downloads) -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    box = FakeSandbox({sandbox.REPOSITORY_SET_META: json.dumps({"repositorySetDigest": "sha256:" + "0" * 64})})
    with pytest.raises(RuntimeError, match="repository set"):
        sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)
    assert downloads == []


def test_a_cached_repository_with_a_different_commit_is_refused(downloads) -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    box = FakeSandbox()
    sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)
    marker = json.loads(box.files["/workspace/repositories/api/.lcsp/repository.json"])
    marker["commitSha"] = "c" * 40
    box.files["/workspace/repositories/api/.lcsp/repository.json"] = json.dumps(marker)
    with pytest.raises(RuntimeError, match="pins"):
        sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)


def test_one_pinned_repository_still_hydrates_through_the_original_layout(downloads) -> None:
    pins = sandbox.repository_pins_from_context(
        {"repositorySnapshotId": "snap-only", "repositoryScanJobId": "job", "repositoryCommit": COMMIT}
    )
    box = FakeSandbox()
    layout = sandbox.hydrate_repository_set(box, pins, assessment_id=ASSESSMENT)
    assert layout.multi is False
    assert sandbox.REPOSITORY_META in box.files and sandbox.REPOSITORY_SET_META not in box.files
    assert box.uploads == ["/tmp/lcsp-assessment-repository.tar.gz"]


# -------------------------------------------------------------------------- Codebase Memory index


class FakeEngine:
    """Records Codebase Memory commands and keeps a project listing like the real engine."""

    def __init__(self, markers: dict[str, str]) -> None:
        self.markers = markers
        self.files: dict[str, str] = {}
        self.projects: dict[str, str] = {}
        self.indexed: list[str] = []

    def execute(self, command: str, **_kwargs):
        def out(text: str, code: int = 0):
            return SimpleNamespace(exit_code=code, output=text)

        for path, marker in self.markers.items():
            if command == f"cat {path} 2>/dev/null":
                return out(marker)
        if command.startswith("cat /workspace/runtime/codebase-memory/"):
            return out(self.files.get(command.split()[1], ""))
        if "list_projects" in command:
            return out("\n".join(f"  {name} {path} -" for path, name in self.projects.items()))
        if "index_repository" in command:
            payload = json.loads(command.split("index_repository ", 1)[1].strip("'"))
            path = payload["repo_path"]
            self.indexed.append(path)
            self.projects[path] = path.strip("/").replace("/", "-")
            return out('{"status":"indexed"}')
        if command.startswith("printf %s"):
            marker = command.split("printf %s ", 1)[1].split(" > ")[0].strip("'")
            stamp = command.split("> ", 1)[1].strip().strip("'")
            self.files[stamp] = marker
            return out("")
        return out("")


def test_the_shared_repositories_root_is_indexed_as_one_graph_named_by_the_engine() -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    engine = FakeEngine({pin.marker_path: f"marker-{pin.key}" for pin in pins})

    identity = memory.ensure_codebase_memory_set_index(engine, pins)

    assert engine.indexed == ["/workspace/repositories"]
    assert identity.project_id == "workspace-repositories" and identity.reused is False
    assert memory.active_codebase_memory_index() == identity


def test_a_current_index_is_reused_and_a_changed_repository_marker_reindexes_the_set() -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    engine = FakeEngine({pin.marker_path: f"marker-{pin.key}" for pin in pins})
    first = memory.ensure_codebase_memory_set_index(engine, pins)
    engine.indexed.clear()

    reused = memory.ensure_codebase_memory_set_index(engine, pins)
    assert engine.indexed == [] and reused.reused and reused.index_stamp == first.index_stamp

    engine.markers[pins[1].marker_path] = "marker-api-changed"
    changed = memory.ensure_codebase_memory_set_index(engine, pins)
    assert engine.indexed == ["/workspace/repositories"] and changed.index_stamp != first.index_stamp


def test_an_unhydrated_repository_stops_indexing() -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    engine = FakeEngine({pins[0].marker_path: "marker-web"})
    with pytest.raises(memory.CodebaseMemoryIndexError, match="api"):
        memory.ensure_codebase_memory_set_index(engine, pins)


def test_graph_tools_query_the_project_the_engine_registered_for_the_shared_root() -> None:
    pins = sandbox.repository_pins_from_context(two_repository_context())
    engine = FakeEngine({pin.marker_path: f"marker-{pin.key}" for pin in pins})
    memory.ensure_codebase_memory_set_index(engine, pins)
    seen: list[str] = []

    def spy(command: str, **_kwargs):
        seen.append(command)
        return SimpleNamespace(exit_code=0, output='{"results":[]}')

    with sandbox.activate_repository_backend(SimpleNamespace(execute=spy), sandbox.MULTI_REPOSITORY_LAYOUT):
        graph.search_code_graph.invoke({"name_pattern": ".*Consent.*"})
    assert '"project":"workspace-repositories"' in seen[-1].replace(" ", "")


# ----------------------------------------------------------------------------- Root tools and paths


DISCOVERY_RECORDS = {"web": "aaaaaaaa-0000-4000-8000-000000000001", "api": "aaaaaaaa-0000-4000-8000-000000000002"}


class MultiClient(FakeClient):
    def __init__(self) -> None:
        super().__init__()
        self.evidence: list[dict[str, Any]] = []

    def context(self) -> dict[str, Any]:
        base = super().context()
        base.update(two_repository_context())
        base.update(PINS)
        base["repositorySnapshotId"] = "snap-web"
        return base

    def repository_discovery_summary(self, repository_key: str | None = None) -> dict[str, Any]:
        self.calls.append(("discovery_summary", repository_key))
        record = DISCOVERY_RECORDS.get(repository_key or "web")
        return {"available": True, "discovery": {"recordId": record, "repositoryKey": repository_key or "web"}}

    def post_evidence(self, body: dict[str, Any]) -> dict[str, Any]:
        self.evidence.append(body)
        return {"evidenceId": f"00000000-0000-4000-8000-{len(self.evidence):012d}", "state": "ACCEPTED", "replayed": False}


def multi_run(tmp_path: Path) -> tuple[RootRun, MultiClient]:
    root = tmp_path / "repositories"
    for key, prefix, commit in (("web", None, COMMIT), ("api", "services/billing", COMMIT_API)):
        (root / key / ".lcsp").mkdir(parents=True)
        (root / key / "src").mkdir()
        (root / key / "src" / "consent.ts").write_text("one\ntwo\nconsent()\n", encoding="utf-8")
        (root / key / "services" / "billing").mkdir(parents=True)
        (root / key / "services" / "billing" / "charge.py").write_text("a\nb\ncharge()\n", encoding="utf-8")
        (root / key / ".lcsp" / "repository.json").write_text(
            json.dumps({
                "assessmentId": ASSESSMENT, "snapshotId": f"snap-{key}", "commitSha": commit,
                "sourcePathPrefix": prefix, "repositoryKey": key,
                "sourceCoverage": {"sourcePathPrefix": prefix, "coverageLimited": False, "includedFiles": 2, "skippedEntries": []},
            }),
            encoding="utf-8",
        )
    client = MultiClient()
    backend = FilesystemBackend(root_dir=root, virtual_mode=True)
    run = RootRun(client=client, assessment_id=ASSESSMENT, thread_id=THREAD, execution_id=EXECUTION, backend=backend)
    run.adopt_context(client.context())
    return run, client


class JsonTool:
    """Governed tools return their packet as a JSON string; tests read it as data."""

    def __init__(self, tool: Any) -> None:
        self._tool = tool

    def invoke(self, arguments: dict[str, Any]) -> Any:
        return json.loads(self._tool.invoke(arguments))


def tools_of(run: RootRun) -> dict[str, Any]:
    return {tool.name: JsonTool(tool) for tool in build_root_tools(run)}


def test_the_root_adopts_the_pinned_set_and_exposes_it_with_guidance(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    context = tools_of(run)["get_assessment_context"].invoke({})
    assert run.multi and run.pins["repositorySetDigest"] == run.repository_set_digest
    assert [item["repositoryKey"] for item in context["repositories"]] == ["web", "api"]
    assert context["repositories"][1]["sourcePathPrefix"] == "services/billing"
    assert "/<repositoryKey>/<path>" in context["repositoryGuidance"]
    assert set(context["repositoryView"]) == {"web", "api"}


def test_the_pinned_set_cannot_change_within_one_execution(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    changed = client.context()
    changed["repositories"][0]["repositoryCommit"] = "d" * 40
    changed["repositorySetDigest"] = None
    with pytest.raises(RuntimeError, match="repository set changed"):
        run.adopt_context(changed)
    wrong_digest = client.context()
    wrong_digest["repositorySetDigest"] = "sha256:" + "0" * 64
    with pytest.raises(RuntimeError, match="digest"):
        MultiRunProbe.adopt(wrong_digest)


class MultiRunProbe:
    @staticmethod
    def adopt(context: dict[str, Any]) -> None:
        RootRun(client=MultiClient(), assessment_id=ASSESSMENT, thread_id=THREAD, execution_id=EXECUTION, backend=None).adopt_context(context)


def test_a_citation_names_its_repository_and_uses_that_repository_commit(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    cite = tools_of(run)["cite_repository_source"]

    web = cite.invoke({"path": "/web/src/consent.ts", "start_line": 3, "end_line": 3})
    api = cite.invoke({"path": "/api/services/billing/charge.py", "start_line": 3, "end_line": 3})

    assert web["ok"] and api["ok"]
    assert client.evidence[0] == {
        "type": "REPOSITORY_SOURCE", "repositoryKey": "web", "repositoryCommit": COMMIT, "path": "src/consent.ts",
        "startLine": 3, "endLine": 3, "excerptSha256": "sha256:" + hashlib.sha256(b"consent()").hexdigest(),
    }
    assert (client.evidence[1]["repositoryKey"], client.evidence[1]["repositoryCommit"]) == ("api", COMMIT_API)
    assert client.evidence[1]["path"] == "services/billing/charge.py"


@pytest.mark.parametrize(
    "path",
    [
        "src/consent.ts",            # no repository key
        "/unknown/src/consent.ts",   # not a pinned repository
        "/web",                      # a directory root, not a file
        "/api/src/consent.ts",       # outside the repository's source prefix
        "/api/services/billing-other/x.py",  # similarly named sibling directory
        "/web/../api/services/billing/charge.py",
        "/",
    ],
)
def test_a_citation_outside_the_pinned_repositories_or_their_prefix_creates_no_evidence(tmp_path, path) -> None:
    run, client = multi_run(tmp_path)
    result = tools_of(run)["cite_repository_source"].invoke({"path": path, "start_line": 1, "end_line": 1})
    assert result["ok"] is False and result["code"] in {"SOURCE_PATH_OUTSIDE_SCOPE", "INVALID_RANGE", "FILE_NOT_FOUND"}
    assert client.evidence == []


def trace(run: RootRun, tool: str, args: dict[str, Any], count: int = 3) -> None:
    run.trace.record({"tool": tool, "args": args, "resultCount": count, "truncated": False})


def test_coverage_is_recorded_per_repository_from_the_executed_trace(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "grep", {"pattern": "consent", "path": "/web/src"})
    trace(run, "read_file", {"file_path": "/web/src/consent.ts"}, 3)
    trace(run, "glob", {"pattern": "*.py", "path": "/api/services/billing"})
    trace(run, "search_code_graph", {"name_pattern": ".*"})

    result = tools_of(run)["record_search_coverage"].invoke({"inspected_entry_points": ["/web/src/consent.ts"]})

    assert result["ok"] and len(result["evidenceIds"]) == 2
    by_key = {body["repositoryKey"]: body for body in client.evidence}
    assert by_key["web"]["repositoryCommit"] == COMMIT and by_key["api"]["repositoryCommit"] == COMMIT_API
    assert {"kind": "SOURCE_DIRECTORY", "path": "src"} in by_key["web"]["scopes"]
    assert {"kind": "SOURCE_FILE", "path": "src/consent.ts"} in by_key["web"]["scopes"]
    assert by_key["web"]["inspectedEntryPoints"] == ["src/consent.ts"]
    assert {"kind": "SOURCE_DIRECTORY", "path": "services/billing"} in by_key["api"]["scopes"]
    # The graph spans the shared root, so a graph query covers every pinned repository inside its source prefix.
    assert {"kind": "GRAPH_INDEX", "path": "services/billing"} in by_key["api"]["scopes"]
    assert {"kind": "GRAPH_INDEX", "path": "."} in by_key["web"]["scopes"]
    assert by_key["api"]["inspectedEntryPoints"] == []


def test_a_search_from_the_filesystem_root_covers_every_pinned_repository(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "grep", {"pattern": "consent"})

    result = tools_of(run)["record_search_coverage"].invoke({})

    assert result["ok"] and {body["repositoryKey"] for body in client.evidence} == {"web", "api"}
    api = next(body for body in client.evidence if body["repositoryKey"] == "api")
    assert api["scopes"] == [{"kind": "SOURCE_DIRECTORY", "path": "services/billing"}]


def test_coverage_with_an_out_of_scope_trace_is_rejected_and_the_trace_is_kept(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "read_file", {"file_path": "/api/src/consent.ts"})

    result = tools_of(run)["record_search_coverage"].invoke({})

    assert result["ok"] is False and result["code"] == "SOURCE_PATH_OUTSIDE_SCOPE"
    assert client.evidence == [] and len(run.trace.snapshot()[0]) == 1


def test_coverage_ignores_entry_points_that_were_not_read_in_that_repository(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "grep", {"pattern": "x", "path": "/web/src"})

    tools_of(run)["record_search_coverage"].invoke({"inspected_entry_points": ["/web/src/consent.ts"]})

    assert client.evidence[0]["inspectedEntryPoints"] == []


def test_coverage_without_any_activity_is_refused(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    result = tools_of(run)["record_search_coverage"].invoke({})
    assert result["code"] == "NO_SEARCH_ACTIVITY" and client.evidence == []


def test_the_single_repository_context_keeps_the_original_paths(tmp_path) -> None:
    client = FakeClient()
    root = tmp_path / "repo"
    (root / "src").mkdir(parents=True)
    (root / "src" / "retention.py").write_text("a\nb\nkeep_days = 7\n", encoding="utf-8")
    run = RootRun(client=client, assessment_id=ASSESSMENT, thread_id=THREAD, execution_id=EXECUTION,
                  backend=FilesystemBackend(root_dir=root, virtual_mode=True))
    run.adopt_context(client.context())
    assert run.multi is False and "repositorySetDigest" not in run.pins
    result = tools_of(run)["cite_repository_source"].invoke({"path": "/src/retention.py", "start_line": 3, "end_line": 3})
    assert result["ok"] and "repositoryKey" not in client.calls[-1][1]


def test_the_root_context_lists_each_repository_discovery_and_remembers_its_records(tmp_path) -> None:
    run, client = multi_run(tmp_path)

    context = tools_of(run)["get_assessment_context"].invoke({})

    assert set(context["repositoryDiscoveries"]) == {"web", "api"}
    assert context["repositoryDiscoveries"]["api"]["discovery"]["recordId"] == DISCOVERY_RECORDS["api"]
    # The primary overview is loaded once without a key and stays the legacy top-level field.
    assert context["repositoryDiscovery"]["discovery"]["repositoryKey"] == "web"
    assert ("discovery_summary", "api") in client.calls and ("discovery_summary", "web") not in client.calls
    assert run.discovery_record_keys == {record: key for key, record in DISCOVERY_RECORDS.items()}


def test_the_single_repository_context_has_no_per_repository_discovery_list(tmp_path) -> None:
    client = FakeClient()
    run = RootRun(client=client, assessment_id=ASSESSMENT, thread_id=THREAD, execution_id=EXECUTION,
                  backend=FilesystemBackend(root_dir=tmp_path, virtual_mode=True))
    run.adopt_context(client.context())
    assert "repositoryDiscoveries" not in tools_of(run)["get_assessment_context"].invoke({})


def expansion_args(record: str) -> dict[str, Any]:
    return {
        "record_id": record,
        "content_digest": "sha256:" + "1" * 64,
        "reason_code": "SCANNER_COVERAGE_GAP",
        "reason": "The ranked priorities did not cover this directory.",
    }


def test_an_expansion_audit_contains_only_the_operations_of_its_records_repository(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "grep", {"pattern": "consent", "path": "/web/src"})
    trace(run, "glob", {"pattern": "*.py", "path": "/api/services/billing"})

    result = tools_of(run)["record_repository_discovery_expansion"].invoke(expansion_args(DISCOVERY_RECORDS["api"]))

    assert result["ok"]
    body = next(payload for name, payload in client.calls if name == "discovery_expansion")
    assert body["recordId"] == DISCOVERY_RECORDS["api"]
    assert body["trace"]["inspectedPaths"] == ["services/billing"]


def test_an_expansion_audit_for_the_primary_record_ignores_other_repositories(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "grep", {"pattern": "consent", "path": "/web/src"})
    trace(run, "glob", {"pattern": "*.py", "path": "/api/services/billing"})

    tools_of(run)["record_repository_discovery_expansion"].invoke(expansion_args(DISCOVERY_RECORDS["web"]))

    body = next(payload for name, payload in client.calls if name == "discovery_expansion")
    assert body["trace"]["inspectedPaths"] == ["src"]


def test_an_expansion_audit_for_an_unknown_record_is_refused_without_a_call(tmp_path) -> None:
    run, client = multi_run(tmp_path)
    trace(run, "grep", {"pattern": "consent", "path": "/web/src"})

    result = tools_of(run)["record_repository_discovery_expansion"].invoke(
        expansion_args("bbbbbbbb-0000-4000-8000-000000000009")
    )

    assert result["ok"] is False and result["code"] == "DISCOVERY_RECORD_UNKNOWN"
    assert not any(name == "discovery_expansion" for name, _ in client.calls)

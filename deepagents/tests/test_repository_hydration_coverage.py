import hashlib
import io
import json
import tarfile
from types import SimpleNamespace

import pytest

from tools.common.capabilities.platform import repository_sandbox as sandbox
from tools.common.capabilities.platform.repository_workspace import RepositoryWorkspace


def archive():
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as handle:
        for name, content in [("repo/main.py", b"x"), ("repo/models/model.pt", b"abcd")]:
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            handle.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def test_sanitized_view_keeps_omitted_file_provenance(monkeypatch):
    monkeypatch.setattr(sandbox, "RepositoryWorkspace", lambda root: RepositoryWorkspace(root, max_file_size_bytes=3))
    content, coverage = sandbox._sanitize_archive(archive(), snapshot_id="snapshot")
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as handle:
        assert handle.getnames() == ["main.py"]
    assert coverage == {"sourcePathPrefix": None, "sourceScopeExcludedEntryCount": 0, "sourceScopeExcludedEntries": [],
                        "sourceScopeExclusionsTruncated": False, "coverageLimited": True, "includedFiles": 1, "skippedEntries": [{
        "path": "models/model.pt", "reason": "FILE_SIZE_LIMIT", "sizeBytes": 4, "limitBytes": 3,
        "sha256": hashlib.sha256(b"abcd").hexdigest(),
    }]}


def test_legacy_marker_upgrade_preserves_working_source_and_agent_state(monkeypatch):
    marker = {"assessmentId": "assessment", "snapshotId": "snapshot", "scanJobId": "job", "commitSha": "a" * 40}
    writes = []
    monkeypatch.setattr(sandbox, "load_config", lambda: SimpleNamespace(nestjs_api_base_url="http://local", worker_api_key="test"))
    monkeypatch.setattr(sandbox, "RepositorySnapshotClient", lambda *_: SimpleNamespace(download_archive=lambda _: archive()))
    backend = SimpleNamespace(
        read=lambda *_args, **_kwargs: SimpleNamespace(file_data={"content": json.dumps(marker)}),
        write=lambda path, body: writes.append((path, json.loads(body))),
        upload_files=lambda _: pytest.fail("metadata upgrade must not upload or replace source"),
        execute=lambda *_args, **_kwargs: pytest.fail("metadata upgrade must preserve source and agent WIP"),
    )
    sandbox.hydrate_repository(backend, snapshot_id="snapshot", scan_job_id="job", commit_sha="a" * 40, assessment_id="assessment")
    assert len(writes) == 1 and writes[0][0] == sandbox.REPOSITORY_META
    assert writes[0][1]["sourceCoverage"] == {"sourcePathPrefix": None, "sourceScopeExcludedEntryCount": 0, "sourceScopeExcludedEntries": [],
                        "sourceScopeExclusionsTruncated": False, "coverageLimited": False, "includedFiles": 2, "skippedEntries": []}


@pytest.mark.parametrize("field", ["commitSha", "assessmentId"])
def test_cached_source_with_conflicting_pins_is_rejected_before_download(monkeypatch, field):
    marker = {"assessmentId": "assessment", "snapshotId": "snapshot", "scanJobId": "job", "commitSha": "a" * 40,
              "sourceCoverage": {"coverageLimited": False, "includedFiles": 2, "skippedEntries": []}}
    marker[field] = "another-value"
    backend = SimpleNamespace(read=lambda *_args, **_kwargs: SimpleNamespace(file_data={"content": json.dumps(marker)}))
    monkeypatch.setattr(sandbox, "load_config", lambda: pytest.fail("conflicting pins must fail before download"))
    with pytest.raises(RuntimeError, match="repository view pins"):
        sandbox.hydrate_repository(backend, snapshot_id="snapshot", scan_job_id="job", commit_sha="a" * 40, assessment_id="assessment")


def source_archive(entries, links=()):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as handle:
        for name, content in entries:
            entry = tarfile.TarInfo("repo/" + name)
            entry.size = len(content)
            handle.addfile(entry, io.BytesIO(content))
        for name, target, kind in links:
            entry = tarfile.TarInfo("repo/" + name)
            entry.type = kind
            entry.linkname = target
            handle.addfile(entry)
    return output.getvalue()


@pytest.mark.parametrize("prefix", [
    "", "/", "/app", "app/", "app//nested", ".", "..", "app/../other", "app/./nested",
    "app\\\\nested", "C:app", "app%2fother", " app", "app ", "app\n", "app\x00x",
    "app\x7fx", "\ufeffapp", 1, True, [], "x" * 1025, "\U0001f4bb" * 513,
])
def test_source_prefix_rejects_ambiguous_or_noncanonical_selection(prefix):
    with pytest.raises(ValueError, match="sourcePathPrefix"):
        sandbox.validate_source_path_prefix(prefix)


def test_source_prefix_preserves_literal_unicode_and_segment_boundaries():
    prefix = "khách hàng/ứng dụng AI"
    assert sandbox.validate_source_path_prefix(None) is None
    assert sandbox.validate_source_path_prefix(prefix) == prefix
    assert sandbox.validate_source_path_prefix("e\u0301") == "e\u0301"
    assert sandbox.validate_source_path_prefix("\U0001f4bb" * 512) == "\U0001f4bb" * 512
    assert sandbox.source_path_in_scope(prefix + "/app.py", prefix)
    assert not sandbox.source_path_in_scope(prefix + "-other/app.py", prefix)
    assert not sandbox.source_path_in_scope(".", prefix)
    assert sandbox.source_path_in_scope(".", None)


def test_scoped_archive_keeps_original_paths_without_sibling_or_runtime_source():
    original = source_archive([
        ("projects/chatbot/app.py", b"chatbot"),
        ("projects/chatbot/README.md", b"readme"),
        ("projects/chatbot-other/app.py", b"sibling"),
        ("projects/game/main.py", b"foreign"),
        (".lcsp/repository.json", b"forged marker"),
        (".git/config", b"forged git"),
    ])
    content, coverage = sandbox._sanitize_archive(
        original, snapshot_id="snapshot", source_path_prefix="projects/chatbot",
    )
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as handle:
        assert handle.getnames() == ["projects/chatbot/README.md", "projects/chatbot/app.py"]
        assert handle.extractfile("projects/chatbot/app.py").read() == b"chatbot"
    assert coverage["sourcePathPrefix"] == "projects/chatbot"
    assert coverage["coverageLimited"] is False
    assert coverage["includedFiles"] == 2 and coverage["skippedEntries"] == []
    assert {entry["path"] for entry in coverage["sourceScopeExcludedEntries"]} == {
        "projects/chatbot-other/app.py", "projects/game/main.py", ".lcsp/repository.json", ".git/config",
    }
    assert {entry["reason"] for entry in coverage["sourceScopeExcludedEntries"]} == {"SOURCE_SCOPE_EXCLUDED"}


def test_safety_omission_only_limits_coverage_when_it_is_inside_selected_scope(monkeypatch):
    monkeypatch.setattr(sandbox, "RepositoryWorkspace", lambda root: RepositoryWorkspace(root, max_file_size_bytes=3))
    original = source_archive([("app/main.py", b"x"), ("other/model.bin", b"abcd")])
    _, coverage = sandbox._sanitize_archive(original, snapshot_id="snapshot", source_path_prefix="app")
    assert coverage["coverageLimited"] is False and coverage["skippedEntries"] == []
    assert coverage["sourceScopeExcludedEntries"] == [{
        "path": "other/model.bin", "reason": "SOURCE_SCOPE_EXCLUDED", "guardReason": "FILE_SIZE_LIMIT",
        "sizeBytes": 4, "limitBytes": 3, "sha256": hashlib.sha256(b"abcd").hexdigest(),
    }]
    _, inside = sandbox._sanitize_archive(
        source_archive([("app/main.py", b"x"), ("app/model.bin", b"abcd")]),
        snapshot_id="snapshot", source_path_prefix="app",
    )
    assert inside["coverageLimited"] is True
    assert inside["skippedEntries"][0]["path"] == "app/model.bin"


def test_scoped_archive_never_follows_symlink_or_hardlink_to_foreign_source():
    original = source_archive(
        [("app/main.py", b"allowed"), ("other/secret.py", b"outside")],
        [("app/link.py", "../other/secret.py", tarfile.SYMTYPE),
         ("app/hard.py", "repo/other/secret.py", tarfile.LNKTYPE)],
    )
    content, coverage = sandbox._sanitize_archive(original, snapshot_id="snapshot", source_path_prefix="app")
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as handle:
        assert handle.getnames() == ["app/main.py"]
    assert coverage["coverageLimited"] is True
    assert {entry["path"] for entry in coverage["skippedEntries"]} == {"app/link.py", "app/hard.py"}
    assert all(entry["reason"] == "UNSUPPORTED_ENTRY_TYPE" for entry in coverage["skippedEntries"])


@pytest.mark.parametrize("unsafe", ["../../escape.py", "/tmp/lcsp-source-scope-escape.py"])
def test_scope_filter_does_not_bypass_archive_traversal_guards(unsafe):
    from tools.common.capabilities.platform.repository_workspace import ArchiveMaterializationError
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as handle:
        for name in ["repo/app/main.py", unsafe]:
            entry = tarfile.TarInfo(name)
            entry.size = 1
            handle.addfile(entry, io.BytesIO(b"x"))
    with pytest.raises(ArchiveMaterializationError, match="escapes workspace"):
        sandbox._sanitize_archive(output.getvalue(), snapshot_id="snapshot", source_path_prefix="app")


@pytest.mark.parametrize("prefix,entries,links", [
    ("missing", [("other/main.py", b"x")], []),
    ("app", [("app-other/main.py", b"x")], []),
    (".lcsp", [(".lcsp/repository.json", b"forged")], []),
    (".git", [(".git/config", b"forged")], []),
    ("app", [("other/main.py", b"x")], [("app/link", "../other/main.py", tarfile.SYMTYPE)]),
])
def test_missing_or_non_source_selection_fails_closed(prefix, entries, links):
    with pytest.raises(RuntimeError, match="no retained source"):
        sandbox._sanitize_archive(source_archive(entries, links), snapshot_id="snapshot", source_path_prefix=prefix)


@pytest.mark.parametrize("marker_scope,coverage_scope,requested", [
    (None, None, "app"), ("app", "app", None), ("other", "other", "app"), ("app", None, "app"),
])
def test_cached_scope_or_coverage_mismatch_fails_before_download(monkeypatch, marker_scope, coverage_scope, requested):
    marker = {"assessmentId": "assessment", "snapshotId": "snapshot", "scanJobId": "job", "commitSha": "a" * 40,
              "sourceCoverage": {"coverageLimited": False, "includedFiles": 1, "skippedEntries": []}}
    if marker_scope is not None:
        marker["sourcePathPrefix"] = marker_scope
    if coverage_scope is not None:
        marker["sourceCoverage"]["sourcePathPrefix"] = coverage_scope
    backend = SimpleNamespace(read=lambda *_args, **_kwargs: SimpleNamespace(file_data={"content": json.dumps(marker)}))
    monkeypatch.setattr(sandbox, "load_config", lambda: pytest.fail("mismatched scope must fail before source download"))
    with pytest.raises(RuntimeError, match="scope"):
        sandbox.hydrate_repository(backend, snapshot_id="snapshot", scan_job_id="job", commit_sha="a" * 40,
                                   assessment_id="assessment", source_path_prefix=requested)


def test_matching_scoped_marker_reuses_view_without_redownloading(monkeypatch):
    marker = {"assessmentId": "assessment", "snapshotId": "snapshot", "scanJobId": "job", "commitSha": "a" * 40,
              "sourcePathPrefix": "app", "sourceCoverage": {"sourcePathPrefix": "app", "coverageLimited": False,
              "includedFiles": 1, "skippedEntries": [], "sourceScopeExcludedEntries": []}}
    backend = SimpleNamespace(read=lambda *_args, **_kwargs: SimpleNamespace(file_data={"content": json.dumps(marker)}))
    monkeypatch.setattr(sandbox, "load_config", lambda: pytest.fail("valid cached source must be reused"))
    sandbox.hydrate_repository(backend, snapshot_id="snapshot", scan_job_id="job", commit_sha="a" * 40,
                               assessment_id="assessment", source_path_prefix="app")



def test_scope_exclusion_samples_are_bounded_without_losing_total_count():
    original = source_archive([("app/main.py", b"x")] + [(f"other/file-{index}.py", b"x") for index in range(150)])
    _, coverage = sandbox._sanitize_archive(original, snapshot_id="snapshot", source_path_prefix="app")
    assert coverage["sourceScopeExcludedEntryCount"] == 150
    assert len(coverage["sourceScopeExcludedEntries"]) == 100
    assert coverage["sourceScopeExclusionsTruncated"] is True
    assert coverage["coverageLimited"] is False

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
    assert coverage == {"coverageLimited": True, "includedFiles": 1, "skippedEntries": [{
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
    assert writes[0][1]["sourceCoverage"] == {"coverageLimited": False, "includedFiles": 2, "skippedEntries": []}


@pytest.mark.parametrize("field", ["commitSha", "assessmentId"])
def test_cached_source_with_conflicting_pins_is_rejected_before_download(monkeypatch, field):
    marker = {"assessmentId": "assessment", "snapshotId": "snapshot", "scanJobId": "job", "commitSha": "a" * 40,
              "sourceCoverage": {"coverageLimited": False, "includedFiles": 2, "skippedEntries": []}}
    marker[field] = "another-value"
    backend = SimpleNamespace(read=lambda *_args, **_kwargs: SimpleNamespace(file_data={"content": json.dumps(marker)}))
    monkeypatch.setattr(sandbox, "load_config", lambda: pytest.fail("conflicting pins must fail before download"))
    with pytest.raises(RuntimeError, match="repository view pins"):
        sandbox.hydrate_repository(backend, snapshot_id="snapshot", scan_job_id="job", commit_sha="a" * 40, assessment_id="assessment")

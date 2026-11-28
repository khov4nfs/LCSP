from __future__ import annotations

import hashlib
import io
import stat
import tarfile
import zipfile

import pytest
from tests.integration.test_docker_sandbox_e2e import _fixture_archive
from tools.common.capabilities.platform import repository_sandbox
from tools.common.capabilities.platform.repository_snapshot_client import (
    RepositoryTreePathManifest,
)
from tools.common.capabilities.platform.repository_workspace import (
    ArchiveMaterializationError,
    RepositoryWorkspace,
)


def _tar_archive(entries: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, content in entries.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    return output.getvalue()


def _zip_archive(entries: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return output.getvalue()


def _sanitized_files(archive_bytes: bytes, **kwargs) -> tuple[dict[str, bytes], dict]:
    sanitized, coverage = repository_sandbox._sanitize_archive(
        archive_bytes, snapshot_id="snapshot", **kwargs,
    )
    with tarfile.open(fileobj=io.BytesIO(sanitized), mode="r:gz") as archive:
        files = {
            member.name: archive.extractfile(member).read()
            for member in archive.getmembers()
            if member.isfile()
        }
    return files, coverage


def _tree_manifest(paths: list[str]) -> RepositoryTreePathManifest:
    digest = hashlib.sha256()
    for encoded in sorted(path.encode("utf-8") for path in paths):
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
    return RepositoryTreePathManifest(
        version=1,
        commit_sha="a" * 40,
        tree_id="b" * 40,
        file_count=len(paths),
        path_sha256=digest.hexdigest(),
    )


@pytest.mark.parametrize(
    ("entries", "tree_paths", "expected_root"),
    [
        ({"src/main.py": b"source"}, ["src/main.py"], None),
        (
            {"generated/src/main.py": b"source"},
            ["src/main.py"],
            "generated",
        ),
        (
            {"src/main.py": b"source", "src/lib.py": b"library"},
            ["src/main.py", "src/lib.py"],
            None,
        ),
    ],
)
def test_pinned_tree_manifest_resolves_only_the_exact_root_mapping(
    tmp_path, entries, tree_paths, expected_root,
):
    result = RepositoryWorkspace(root_path=tmp_path).materialize(
        "tree-verified",
        _zip_archive(entries),
        tree_manifest=_tree_manifest(tree_paths),
    )

    assert result.verified_archive_root == expected_root
    if expected_root is None:
        assert (result.workspace_path / "src/main.py").read_bytes() == b"source"
    else:
        assert (result.workspace_path / "generated/src/main.py").read_bytes() == b"source"


@pytest.mark.parametrize(
    "entries",
    [
        {"src/main.py": b"source", "extra.py": b"extra"},
        {"src/main.py": b"source"},
        {"generated/src/main.py": b"source", "generated/extra.py": b"extra"},
    ],
)
def test_missing_or_extra_pinned_tree_paths_fail_before_materialization(
    tmp_path, entries,
):
    workspace = RepositoryWorkspace(root_path=tmp_path)
    with pytest.raises(ArchiveMaterializationError, match="pinned tree|ZIP root"):
        workspace.materialize(
            "tree-mismatch",
            _zip_archive(entries),
            tree_manifest=_tree_manifest(["src/main.py", "src/lib.py"]),
        )
    assert not workspace.workspace_path("tree-mismatch").exists()


def test_pinned_tree_resolution_preserves_repository_source_scope():
    source = {
        "generated/app/main.py": b"print('ok')\n",
        "generated/other/private.py": b"not selected\n",
    }
    sanitized, coverage = _sanitized_files(
        _zip_archive(source),
        source_path_prefix="app",
        tree_manifest=_tree_manifest(["app/main.py", "other/private.py"]),
    )
    assert sanitized == {"app/main.py": b"print('ok')\n"}
    assert coverage["sourcePathPrefix"] == "app"
    assert coverage["sourceScopeExcludedEntryCount"] == 1


def test_tar_gz_and_zip_materialize_equivalent_scoped_source(tmp_path):
    source = {
        "app/main.py": b"print('ok')\n",
        "app/lib/module.py": b"VALUE = 42\n",
        "other/secret.py": b"outside scope\n",
    }
    tar_files, tar_coverage = _sanitized_files(_tar_archive(source), source_path_prefix="app")
    zip_files, zip_coverage = _sanitized_files(_zip_archive(source), source_path_prefix="app")

    assert zip_files == tar_files == {
        "app/main.py": b"print('ok')\n",
        "app/lib/module.py": b"VALUE = 42\n",
    }
    assert {name: hashlib.sha256(body).hexdigest() for name, body in zip_files.items()} == {
        name: hashlib.sha256(body).hexdigest() for name, body in tar_files.items()
    }
    assert zip_coverage == tar_coverage
    assert zip_coverage["sourcePathPrefix"] == "app"
    assert zip_coverage["sourceScopeExcludedEntryCount"] == 1

    for archive_bytes in (_tar_archive(source), _zip_archive(source)):
        result = RepositoryWorkspace(root_path=tmp_path).materialize(
            "direct-" + str(len(list(tmp_path.iterdir()))), archive_bytes,
        )
        assert (result.workspace_path / "app/main.py").read_bytes() == source["app/main.py"]


@pytest.mark.parametrize("archive_builder", [_tar_archive, _zip_archive])
@pytest.mark.parametrize(
    "unsafe_path",
    ["../escape.py", "/tmp/escape.py", "C:/escape.py", "dir\\..\\escape.py", "a//b.py", "a/./b.py"],
)
def test_unsafe_paths_fail_before_materialization_and_remove_workspace(
    tmp_path, archive_builder, unsafe_path,
):
    archive_bytes = archive_builder({"safe.py": b"safe", unsafe_path: b"escape"})
    workspace = RepositoryWorkspace(root_path=tmp_path)

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("unsafe", archive_bytes)

    assert not workspace.workspace_path("unsafe").exists()
    assert not (tmp_path / "escape.py").exists()


@pytest.mark.parametrize("entries", [
    {"duplicate.py": b"one", "DUPLICATE.py": b"two"},
    {"node": b"file", "node/child.py": b"child"},
])
def test_zip_duplicate_and_conflicting_paths_are_rejected(tmp_path, entries):
    workspace = RepositoryWorkspace(root_path=tmp_path)
    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("collision", _zip_archive(entries))
    assert not workspace.workspace_path("collision").exists()


def test_zip_exact_duplicate_member_is_rejected(tmp_path):
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w") as archive:
        with pytest.warns(UserWarning, match="Duplicate name"):
            archive.writestr("same.py", b"one")
            archive.writestr("same.py", b"two")
    workspace = RepositoryWorkspace(root_path=tmp_path)
    with pytest.raises(ArchiveMaterializationError, match="duplicate"):
        workspace.materialize("duplicate", output.getvalue())
    assert not workspace.workspace_path("duplicate").exists()


def test_encrypted_and_unsupported_zip_entries_are_rejected(tmp_path):
    encrypted = bytearray(_zip_archive({"secret.txt": b"source"}))
    local_header = encrypted.find(b"PK\x03\x04")
    central_header = encrypted.find(b"PK\x01\x02")
    encrypted[local_header + 6] |= 0x01
    encrypted[central_header + 8] |= 0x01
    workspace = RepositoryWorkspace(root_path=tmp_path)
    with pytest.raises(ArchiveMaterializationError, match="encrypted"):
        workspace.materialize("encrypted", bytes(encrypted))
    assert not workspace.workspace_path("encrypted").exists()

    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_BZIP2) as archive:
        archive.writestr("file.txt", b"source")
    with pytest.raises(ArchiveMaterializationError, match="compression method"):
        workspace.materialize("compression", output.getvalue())
    assert not workspace.workspace_path("compression").exists()


def test_zip_local_header_mismatch_is_rejected_before_source_delivery(tmp_path):
    corrupted = bytearray(_zip_archive({"source.py": b"source"}))
    local_header = corrupted.find(b"PK\x03\x04")
    corrupted[local_header + 22] ^= 0x01
    workspace = RepositoryWorkspace(root_path=tmp_path)

    with pytest.raises(ArchiveMaterializationError, match="contradict"):
        workspace.materialize("metadata-mismatch", bytes(corrupted))
    assert not workspace.workspace_path("metadata-mismatch").exists()


def test_valid_zip64_local_header_is_supported(tmp_path):
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w") as archive:
        with archive.open("source.py", mode="w", force_zip64=True) as member:
            member.write(b"source")

    result = RepositoryWorkspace(root_path=tmp_path).materialize("zip64", output.getvalue())
    assert (result.workspace_path / "source.py").read_bytes() == b"source"


def test_zip_symlink_is_skipped_and_never_created(tmp_path):
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("safe.py", b"safe")
        link = zipfile.ZipInfo("link.py")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, "../../outside.py")

    result = RepositoryWorkspace(root_path=tmp_path).materialize("links", output.getvalue())
    assert (result.workspace_path / "safe.py").read_bytes() == b"safe"
    assert not (result.workspace_path / "link.py").exists()
    assert result.coverage_limited is True
    assert result.skipped_entries[0].reason == "UNSUPPORTED_ENTRY_TYPE"


@pytest.mark.parametrize("case", ["ratio", "total", "members"])
def test_zip_resource_budgets_reject_expansion_before_returning_workspace(tmp_path, case):
    archive_bytes = _zip_archive({"large.bin": b"A" * 100_000})
    options = {"max_expansion_ratio": 5} if case == "ratio" else {}
    if case == "total":
        options["max_total_size_bytes"] = 100
    if case == "members":
        archive_bytes = _zip_archive({"one": b"1", "two": b"2"})
        options["max_member_count"] = 1
    workspace = RepositoryWorkspace(root_path=tmp_path, **options)

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("budget", archive_bytes)
    assert not workspace.workspace_path("budget").exists()


@pytest.mark.parametrize("archive_builder", [_tar_archive, _zip_archive])
def test_path_depth_budget_is_shared_by_tar_and_zip(tmp_path, archive_builder):
    workspace = RepositoryWorkspace(root_path=tmp_path, max_path_depth=2)

    with pytest.raises(ArchiveMaterializationError, match="path depth"):
        workspace.materialize("deep-path", archive_builder({"a/b/c.py": b"source"}))
    assert not workspace.workspace_path("deep-path").exists()


def test_zip_oversized_file_is_hashed_without_materializing(tmp_path):
    content = b"0123456789"
    result = RepositoryWorkspace(root_path=tmp_path, max_file_size_bytes=4).materialize(
        "large-file", _zip_archive({"model.bin": content}),
    )
    assert result.coverage_limited is True
    assert not (result.workspace_path / "model.bin").exists()
    assert result.skipped_entries[0].sha256 == hashlib.sha256(content).hexdigest()


def test_corrupt_zip_fails_and_cleans_partial_workspace(tmp_path):
    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("first.py", b"first")
        archive.writestr("second.py", b"second")
    corrupted = bytearray(output.getvalue())
    with zipfile.ZipFile(io.BytesIO(corrupted)) as archive:
        member = archive.getinfo("second.py")
        data_offset = member.header_offset + 30 + len(member.filename.encode()) + len(member.extra)
    corrupted[data_offset] ^= 0x01
    workspace = RepositoryWorkspace(root_path=tmp_path)

    with pytest.raises(ArchiveMaterializationError):
        workspace.materialize("corrupt", bytes(corrupted))
    assert not workspace.workspace_path("corrupt").exists()


@pytest.mark.parametrize("archive_builder", [_tar_archive, _zip_archive])
def test_archive_wrapper_is_preserved_unless_exact_root_is_supplied(archive_builder):
    wrapped = archive_builder({"provider-wrapper/main.py": b"source"})

    default_files, _ = _sanitized_files(wrapped)
    explicit_files, _ = _sanitized_files(wrapped, archive_root="provider-wrapper")

    assert default_files == {"provider-wrapper/main.py": b"source"}
    assert explicit_files == {"main.py": b"source"}


def test_shared_rootless_docker_fixture_materializes_repository_relative_source():
    # The fixture declares a verified rootless archive, so hydration must preserve
    # every path segment and deliver src/app.py directly at the repository root.
    sanitized, coverage = repository_sandbox._sanitize_archive(
        _fixture_archive(), snapshot_id="snapshot-1", archive_root=None,
    )
    with tarfile.open(fileobj=io.BytesIO(sanitized), mode="r:gz") as archive:
        files = {
            member.name: archive.extractfile(member).read()
            for member in archive.getmembers()
            if member.isfile()
        }

    assert files == {"src/app.py": b"print('hydrated')\n"}
    assert any(
        entry["path"] == ".lcsp/repository.json"
        and entry["reason"] == "RESERVED_RUNTIME_PATH"
        for entry in coverage["skippedEntries"]
    )

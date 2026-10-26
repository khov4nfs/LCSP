from __future__ import annotations

import io
import tarfile

from tools.common.capabilities.platform.repository_workspace import RepositoryWorkspace


def _archive_with_links() -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        body = b"# Agents\n"
        regular = tarfile.TarInfo("repo/AGENTS.md")
        regular.size = len(body)
        archive.addfile(regular, io.BytesIO(body))

        symlink = tarfile.TarInfo("repo/CLAUDE.md")
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = "AGENTS.md"
        archive.addfile(symlink)

        escaping = tarfile.TarInfo("repo/outside")
        escaping.type = tarfile.SYMTYPE
        escaping.linkname = "../../../../etc/passwd"
        archive.addfile(escaping)

        hardlink = tarfile.TarInfo("repo/hard.md")
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = "repo/AGENTS.md"
        archive.addfile(hardlink)
    return buffer.getvalue()


def test_symlinked_repository_files_are_skipped_not_fatal(tmp_path) -> None:
    # Regression: a repo whose CLAUDE.md is a symlink failed the whole scan with
    # "unsupported archive entry type".
    workspace = RepositoryWorkspace(root_path=tmp_path)

    result = workspace.materialize("scan-1", _archive_with_links(), snapshot_id="snap-1")

    root = result.workspace_path / "repo"
    assert (root / "AGENTS.md").read_text() == "# Agents\n"
    assert result.extracted_files == 1
    assert result.skipped_files == 3
    assert result.coverage_limited is True
    for name in ("CLAUDE.md", "outside", "hard.md"):
        assert not (root / name).exists()
        assert not (root / name).is_symlink()


def test_oversized_source_is_reported_with_its_pinned_hash_without_materializing_it(tmp_path):
    import hashlib
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path, content in [("repo/main.py", b"x"), ("repo/models/model.pt", b"abcd")]:
            member = tarfile.TarInfo(path)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    result = RepositoryWorkspace(root_path=tmp_path, max_file_size_bytes=3).materialize("source", buffer.getvalue(), snapshot_id="snap")
    assert result.coverage_limited is True
    assert not (result.workspace_path / "repo/models/model.pt").exists()
    skipped = result.skipped_entries[0]
    assert skipped.path == "repo/models/model.pt"
    assert skipped.reason == "FILE_SIZE_LIMIT"
    assert skipped.size_bytes == 4 and skipped.limit_bytes == 3
    assert skipped.sha256 == hashlib.sha256(b"abcd").hexdigest()

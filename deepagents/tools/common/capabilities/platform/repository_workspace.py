from __future__ import annotations

import hashlib
import io
import re
import shutil
import stat
import struct
import tarfile
import tempfile
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import BinaryIO

from tools.common.capabilities.platform.repository_snapshot_client import (
    RepositoryTreePathManifest,
)


DEFAULT_MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024
DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_MEMBER_COUNT = 20_000
DEFAULT_MAX_PATH_DEPTH = 20
DEFAULT_MAX_EXPANSION_RATIO = 100
FILE_SIZE_LIMIT = "FILE_SIZE_LIMIT"
UNSUPPORTED_ENTRY_TYPE = "UNSUPPORTED_ENTRY_TYPE"
_COPY_CHUNK_SIZE = 64 * 1024
_SUPPORTED_ZIP_METHODS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


class ArchiveMaterializationError(RuntimeError):
    """Raised when a repository snapshot archive cannot be materialized safely."""


@dataclass(frozen=True)
class SkippedArchiveEntry:
    """A source entry excluded from the runtime view by an archive safety guard."""

    path: str
    reason: str
    size_bytes: int
    sha256: str | None = None
    limit_bytes: int | None = None


@dataclass(frozen=True)
class MaterializationResult:
    """Summarizes the temporary workspace created for an immutable repository snapshot."""

    job_id: str
    snapshot_id: str | None
    workspace_path: Path
    total_size_bytes: int
    extracted_files: int
    skipped_files: int
    coverage_limited: bool
    skipped_entries: tuple[SkippedArchiveEntry, ...] = ()
    verified_archive_root: str | None = None


class RepositoryWorkspace:
    """Materialize repository archives into bounded, isolated temporary workspaces.

    TAR.GZ and ZIP inputs share the same path, member-count, file-size, total-size,
    and expansion-ratio budgets. Links and special files are never created; they
    are recorded as coverage limitations, as are files exceeding the file budget.
    """

    def __init__(
        self,
        root_path: str | Path | None = None,
        max_total_size_bytes: int = DEFAULT_MAX_TOTAL_SIZE_BYTES,
        max_file_size_bytes: int = DEFAULT_MAX_FILE_SIZE_BYTES,
        max_member_count: int = DEFAULT_MAX_MEMBER_COUNT,
        max_path_depth: int = DEFAULT_MAX_PATH_DEPTH,
        max_expansion_ratio: int = DEFAULT_MAX_EXPANSION_RATIO,
    ) -> None:
        """Configure the temporary workspace root and archive safety budgets."""
        self._root_path = Path(root_path) if root_path is not None else Path(
            tempfile.gettempdir()
        ) / "lcsp-repositories"
        self._max_total_size_bytes = max_total_size_bytes
        self._max_file_size_bytes = max_file_size_bytes
        self._max_member_count = max_member_count
        self._max_path_depth = max_path_depth
        self._max_expansion_ratio = max_expansion_ratio

    @property
    def root_path(self) -> Path:
        """Return the parent directory that contains per-analysis repository workspaces."""
        return self._root_path

    def workspace_path(self, job_id: str) -> Path:
        """Return the deterministic temporary path allocated to a scan job."""
        return self._root_path / job_id

    def create(self, job_id: str) -> Path:
        """Create and return the per-analysis workspace directory."""
        workspace_path = self.workspace_path(job_id)
        workspace_path.mkdir(parents=True, exist_ok=True)
        return workspace_path

    def cleanup(self, job_id: str) -> None:
        """Delete all materialized repository data for a scan job.

        Raises:
            ArchiveMaterializationError: If filesystem cleanup fails for a reason
                other than the workspace already being absent.
        """
        workspace_path = self.workspace_path(job_id)
        try:
            shutil.rmtree(workspace_path)
        except FileNotFoundError:
            return
        except OSError as error:
            raise ArchiveMaterializationError(
                f"workspace cleanup failed for job {job_id!r}: {error}"
            ) from error

    def materialize(
        self,
        job_id: str,
        archive_stream: BinaryIO | bytes,
        snapshot_id: str | None = None,
        *,
        archive_root: str | None = None,
        tree_manifest: RepositoryTreePathManifest | None = None,
    ) -> MaterializationResult:
        """Business purpose:
        Provide a bounded source view of an immutable customer snapshot and disclose every omitted entry.

        Business rules:
        - TAR.GZ and ZIP archives use the same path, expansion, size and member-count guards.
        - A pinned tree manifest is accepted only for ZIP and must resolve exactly one rootless or wrapped path set.
        - Links, devices and oversized files are excluded; exclusion never proves a control absent.
        - Oversized regular files retain their source hash without being written into the workspace.
        - A workspace created by this operation is fresh and cannot contain a prior symlink pivot.

        Execution flow:
        1. Detect and validate the archive container and all member paths before writing source files.
        2. Resolve a ZIP wrapper against the complete pinned file-path commitment before creating source files.
        3. Extract permitted files while hashing and recording entries excluded by safety policy.
        4. Return the workspace, verified root, extraction counts and explicit coverage limitations.

        Failure cases:
        - Malformed containers, unsafe members or over-budget resources remove the new workspace before failure returns.

        Side effects:
        - Creates isolated temporary source files; never follows archive links or modifies the source snapshot.
        """
        workspace_path = self.workspace_path(job_id)
        created_workspace = False
        archive_file: BinaryIO | None = None
        close_archive_file = False
        try:
            workspace_path.mkdir(parents=True, exist_ok=False)
            created_workspace = True
            archive_file = self._ensure_binary_stream(archive_stream)
            close_archive_file = isinstance(archive_stream, bytes) or archive_file is not archive_stream
            archive_size_bytes = self._archive_size_bytes(archive_file)
            self._seek_archive_start(archive_file)
            archive_format = self._detect_archive_format(archive_file)
            if archive_format == "tar.gz":
                if tree_manifest is not None:
                    raise ArchiveMaterializationError(
                        "pinned tree path verification requires a ZIP archive"
                    )
                result = self._materialize_tar(
                    archive_file, workspace_path, job_id, snapshot_id, archive_size_bytes,
                )
            else:
                result = self._materialize_zip(
                    archive_file,
                    workspace_path,
                    job_id,
                    snapshot_id,
                    archive_size_bytes,
                    archive_root,
                    tree_manifest,
                )
            return result
        except Exception:
            if created_workspace:
                self.cleanup(job_id)
            raise
        finally:
            if close_archive_file and archive_file is not None:
                archive_file.close()

    def _materialize_tar(
        self,
        archive_file: BinaryIO,
        workspace_path: Path,
        job_id: str,
        snapshot_id: str | None,
        archive_size_bytes: int,
    ) -> MaterializationResult:
        """Business purpose:
        Preserve existing TAR.GZ snapshot extraction through the common workspace policy.

        Business rules:
        - Only validated regular files are written; links and special entries remain omitted with coverage records.
        - Declared sizes and archive expansion must fit the shared configured budgets.

        Execution flow:
        1. Parse TAR.GZ members and validate their paths and aggregate resource use.
        2. Stream regular file content into the isolated workspace or hash oversized files.
        3. Return the same materialization summary used for ZIP inputs.

        Failure cases:
        - Invalid TAR headers, truncated files, unsafe paths or budget violations abort and clean the workspace.

        Side effects:
        - Writes only regular repository files beneath the newly allocated workspace directory.
        """
        try:
            with tarfile.open(fileobj=archive_file, mode="r:gz") as archive:
                members = archive.getmembers()
                descriptions = [
                    (member.name, member.isdir(), member.isfile(), member.size)
                    for member in members
                ]
                self._validate_members(workspace_path, descriptions)
                total_size_bytes = self._validate_resource_budgets(
                    (member.size for member in members if member.isfile()),
                    len(members), archive_size_bytes,
                )

                extracted_files = 0
                skipped_entries: list[SkippedArchiveEntry] = []
                for member in members:
                    target_path = self._safe_member_path(workspace_path, member.name, member.isdir())
                    if member.isdir():
                        target_path.mkdir(parents=True, exist_ok=True)
                        continue
                    if not member.isfile():
                        skipped_entries.append(SkippedArchiveEntry(
                            member.name, UNSUPPORTED_ENTRY_TYPE, member.size,
                        ))
                        continue
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise ArchiveMaterializationError(
                            f"unable to read archive entry: {member.name!r}"
                        )
                    with extracted:
                        digest = self._write_or_hash_entry(
                            extracted, target_path, member.size,
                        )
                    if member.size > self._max_file_size_bytes:
                        skipped_entries.append(SkippedArchiveEntry(
                            member.name, FILE_SIZE_LIMIT, member.size, digest,
                            self._max_file_size_bytes,
                        ))
                    else:
                        extracted_files += 1
                return self._result(
                    job_id, snapshot_id, workspace_path, total_size_bytes,
                    extracted_files, skipped_entries,
                )
        except ArchiveMaterializationError:
            raise
        except (tarfile.TarError, EOFError, OSError, ValueError, zlib.error) as error:
            raise ArchiveMaterializationError("TAR.GZ archive is malformed or unreadable") from error

    def _materialize_zip(
        self,
        archive_file: BinaryIO,
        workspace_path: Path,
        job_id: str,
        snapshot_id: str | None,
        archive_size_bytes: int,
        declared_archive_root: str | None,
        tree_manifest: RepositoryTreePathManifest | None,
    ) -> MaterializationResult:
        """Business purpose:
        Materialize provider ZIP snapshots under the same bounded source policy as TAR.GZ.

        Business rules:
        - Encrypted, unsupported or contradictory ZIP entries are rejected before file delivery.
        - Links and special files are omitted; regular file bytes must match declared sizes and CRC values.
        - When supplied, the pinned-tree path commitment determines rootless or one exact wrapper by full path-set equality.

        Execution flow:
        1. Validate central and local headers, member paths and resource budgets.
        2. Resolve the archive root against the pinned file-path commitment before extraction.
        3. Stream permitted file content in bounded chunks and hash oversized files without writing them.
        4. Return shared counts, explicit coverage omissions and the verified root.

        Failure cases:
        - Corrupt headers or payloads, unsafe names and budget violations abort and clean partial output.

        Side effects:
        - Writes validated regular repository files beneath the newly allocated workspace directory.
        """
        try:
            with zipfile.ZipFile(archive_file, mode="r") as archive:
                members = archive.infolist()
                descriptions = []
                for member in members:
                    is_directory = member.is_dir()
                    kind = self._zip_entry_kind(member)
                    is_regular_file = not is_directory and kind == "file"
                    if member.flag_bits & 0x41:
                        raise ArchiveMaterializationError("encrypted ZIP entries are not supported")
                    if member.compress_type not in _SUPPORTED_ZIP_METHODS:
                        raise ArchiveMaterializationError("ZIP compression method is not supported")
                    if member.file_size < 0 or member.compress_size < 0:
                        raise ArchiveMaterializationError("ZIP entry has invalid size metadata")
                    if is_directory and member.file_size != 0:
                        raise ArchiveMaterializationError("ZIP directory entry has invalid size metadata")
                    if is_regular_file and member.file_size > 0:
                        if member.compress_size == 0 or member.file_size > member.compress_size * self._max_expansion_ratio:
                            raise ArchiveMaterializationError(
                                "archive expansion ratio exceeds the allowed limit"
                            )
                    descriptions.append((member.filename, is_directory, is_regular_file, member.file_size))
                    self._validate_zip_local_metadata(archive, member)

                self._validate_members(workspace_path, descriptions)
                verified_archive_root = (
                    self._resolve_zip_archive_root(
                        descriptions,
                        declared_archive_root,
                        tree_manifest,
                    )
                    if tree_manifest is not None
                    else declared_archive_root
                )
                total_size_bytes = self._validate_resource_budgets(
                    (member.file_size for member, description in zip(members, descriptions)
                     if description[2]),
                    len(members), archive_size_bytes,
                )

                extracted_files = 0
                skipped_entries: list[SkippedArchiveEntry] = []
                for member, description in zip(members, descriptions):
                    _, is_directory, is_regular_file, _ = description
                    target_path = self._safe_member_path(workspace_path, member.filename, is_directory)
                    if is_directory:
                        target_path.mkdir(parents=True, exist_ok=True)
                        continue
                    if not is_regular_file:
                        skipped_entries.append(SkippedArchiveEntry(
                            member.filename, UNSUPPORTED_ENTRY_TYPE, member.file_size,
                        ))
                        continue
                    with archive.open(member, mode="r") as extracted:
                        digest = self._write_or_hash_entry(
                            extracted, target_path, member.file_size,
                        )
                    if member.file_size > self._max_file_size_bytes:
                        skipped_entries.append(SkippedArchiveEntry(
                            member.filename, FILE_SIZE_LIMIT, member.file_size, digest,
                            self._max_file_size_bytes,
                        ))
                    else:
                        extracted_files += 1
                return self._result(
                    job_id, snapshot_id, workspace_path, total_size_bytes,
                    extracted_files, skipped_entries, verified_archive_root,
                )
        except ArchiveMaterializationError:
            raise
        except (zipfile.BadZipFile, EOFError, OSError, RuntimeError, NotImplementedError, ValueError, zlib.error) as error:
            raise ArchiveMaterializationError("ZIP archive is malformed or unreadable") from error

    def _resolve_zip_archive_root(
        self,
        descriptions: list[tuple[str, bool, bool, int]],
        declared_archive_root: str | None,
        manifest: RepositoryTreePathManifest,
    ) -> str | None:
        """Business purpose:
        Select the unique ZIP path mapping that equals the complete Azure Git blob-path commitment.

        Business rules:
        - A rootless archive and one exact common wrapper are the only candidates.
        - File paths are compared byte-exactly, with no case folding, normalization, or subset allowance.
        - A declared wrapper must itself match the complete pinned path set.

        Execution flow:
        1. Validate manifest identity fields and collect every non-directory ZIP entry path.
        2. Hash the rootless set and, when every file shares a parent, the wrapper-stripped set.
        3. Require exactly one candidate to match the pinned commit tree digest.

        Failure cases:
        - Empty, duplicated, missing, extra, malformed, mismatched, or ambiguous paths reject before file extraction.

        Side effects:
        - Reads ZIP central-directory metadata only; it creates no extracted files and performs no decompression.
        """
        if (
            manifest.version != 1
            or not re.fullmatch(r"[0-9a-f]{40}", manifest.commit_sha)
            or not re.fullmatch(r"[0-9a-f]{40}", manifest.tree_id)
            or not re.fullmatch(r"[0-9a-f]{64}", manifest.path_sha256)
            or not 0 <= manifest.file_count <= self._max_member_count
        ):
            raise ArchiveMaterializationError("pinned tree manifest is invalid")
        file_paths = [
            self._normalize_member_name(name, is_directory)
            for name, is_directory, _is_regular_file, _size in descriptions
            if not is_directory
        ]
        if not file_paths or len(file_paths) != manifest.file_count:
            raise ArchiveMaterializationError("ZIP file paths do not match the pinned tree")

        candidates: list[tuple[str | None, list[str]]] = [(None, file_paths)]
        if file_paths and all("/" in path for path in file_paths):
            prefixes = {path.split("/", maxsplit=1)[0] for path in file_paths}
            if len(prefixes) == 1:
                prefix = next(iter(prefixes))
                candidates.append(
                    (
                        prefix,
                        [path[len(prefix) + 1 :] for path in file_paths],
                    )
                )
        if declared_archive_root is not None:
            candidates = [
                (root, paths)
                for root, paths in candidates
                if root == declared_archive_root
            ]
            if not candidates:
                raise ArchiveMaterializationError(
                    "declared ZIP root conflicts with pinned tree paths"
                )

        matches = [
            root
            for root, paths in candidates
            if len(paths) == manifest.file_count
            and _path_set_sha256(paths) == manifest.path_sha256
        ]
        if len(matches) != 1:
            raise ArchiveMaterializationError(
                "ZIP root is missing, ambiguous, or inconsistent with the pinned tree"
            )
        return matches[0]

    def _validate_members(
        self,
        workspace_path: Path,
        members: list[tuple[str, bool, bool, int]],
    ) -> None:
        """Business purpose:
        Reject archive member layouts that could escape or ambiguously overwrite repository paths.

        Business rules:
        - Every path must be portable, contained and unique under case-insensitive filesystem comparison.
        - A file or special entry cannot also serve as a directory parent.

        Execution flow:
        1. Validate every name, depth and declared size before any source file is written.
        2. Compare canonical paths and parent relationships for duplicate or conflicting entries.

        Failure cases:
        - Empty, unsafe, over-deep, duplicate or conflicting members reject the full archive.

        Side effects:
        - Read-only preflight; creates no workspace entries.
        """
        paths: dict[str, tuple[str, bool]] = {}
        if len(members) > self._max_member_count:
            raise ArchiveMaterializationError("archive exceeds the maximum member count")
        for name, is_directory, is_regular_file, size in members:
            if size < 0:
                raise ArchiveMaterializationError("archive entry has invalid size metadata")
            normalized_name = self._normalize_member_name(name, is_directory)
            self._validate_member_depth(normalized_name)
            self._safe_member_path(workspace_path, normalized_name, is_directory)
            key = normalized_name.casefold()
            previous = paths.get(key)
            if previous is not None:
                raise ArchiveMaterializationError("archive contains duplicate or case-colliding paths")
            paths[key] = (normalized_name, is_directory)

        for name, _is_directory in paths.values():
            segments = name.split("/")
            for index in range(1, len(segments)):
                parent = "/".join(segments[:index]).casefold()
                parent_entry = paths.get(parent)
                if parent_entry is not None and not parent_entry[1]:
                    raise ArchiveMaterializationError("archive contains conflicting file and directory paths")

    def _normalize_member_name(self, member_name: str, is_directory: bool = False) -> str:
        """Business purpose:
        Give each archive entry one portable repository-relative path before filesystem resolution.

        Business rules:
        - POSIX and Windows absolute, traversal, control, alternate-stream and reserved device paths are rejected.
        - Separators and dot segments are never normalized into a different repository identity.

        Execution flow:
        1. Validate the raw name and remove only a directory's final slash.
        2. Validate each remaining component and return its canonical POSIX spelling.

        Failure cases:
        - Ambiguous or unsafe names raise an archive materialization error.

        Side effects:
        - Pure path validation; performs no filesystem writes.
        """
        if not isinstance(member_name, str) or not member_name:
            raise ArchiveMaterializationError("archive entry name is empty")
        if any(ord(character) < 32 or ord(character) == 127 for character in member_name):
            raise ArchiveMaterializationError("archive entry contains a control character")
        if "\\" in member_name or member_name.startswith("/") or PureWindowsPath(member_name).drive:
            raise ArchiveMaterializationError(f"archive entry escapes workspace: {member_name!r}")
        value = member_name[:-1] if is_directory and member_name.endswith("/") else member_name
        segments = value.split("/")
        if not value or any(segment in {"", ".", ".."} for segment in segments):
            raise ArchiveMaterializationError(f"archive entry escapes workspace: {member_name!r}")
        if any(":" in segment for segment in segments):
            raise ArchiveMaterializationError(f"archive entry escapes workspace: {member_name!r}")
        reserved_windows_names = {"CON", "PRN", "AUX", "NUL"}
        reserved_windows_names.update(f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10))
        for segment in segments:
            if segment.endswith((".", " ")):
                raise ArchiveMaterializationError("archive entry is ambiguous on Windows")
            if segment.split(".", maxsplit=1)[0].upper() in reserved_windows_names:
                raise ArchiveMaterializationError("archive entry is reserved on Windows")
        return "/".join(segments)

    def _validate_member_depth(self, member_name: str) -> None:
        """Business purpose:
        Keep repository paths within the configured nesting limit for safe analysis.

        Business rules:
        - Path depth is counted using the already validated POSIX path components.

        Execution flow:
        1. Count path components and compare them with the configured maximum.

        Failure cases:
        - Paths deeper than the workspace budget reject the archive.

        Side effects:
        - Pure validation; performs no filesystem writes.
        """
        depth = len(member_name.split("/"))
        if depth > self._max_path_depth:
            raise ArchiveMaterializationError(
                f"archive entry exceeds maximum path depth: {member_name!r}"
            )

    def _safe_member_path(
        self, workspace_path: Path, member_name: str, is_directory: bool = False,
    ) -> Path:
        """Business purpose:
        Resolve an archive member only within the allocated repository workspace.

        Business rules:
        - The canonical candidate must remain beneath the resolved workspace boundary.

        Execution flow:
        1. Canonicalize the member name using the cross-platform path rules.
        2. Resolve the candidate and verify its containment relationship.

        Failure cases:
        - A path outside the workspace is rejected before it is opened.

        Side effects:
        - Read-only path resolution; does not create files or directories.
        """
        normalized = self._normalize_member_name(member_name, is_directory)
        workspace_resolved = workspace_path.resolve(strict=False)
        candidate = workspace_path.joinpath(*normalized.split("/")).resolve(strict=False)
        if candidate != workspace_resolved and workspace_resolved not in candidate.parents:
            raise ArchiveMaterializationError(
                f"archive entry escapes workspace: {member_name!r}"
            )
        return candidate

    def _validate_resource_budgets(
        self,
        file_sizes,
        member_count: int,
        archive_size_bytes: int,
    ) -> int:
        """Business purpose:
        Bound the total source data that an archive can add to the runtime workspace.

        Business rules:
        - Member count, aggregate regular-file bytes and compressed expansion ratio stay within configured limits.

        Execution flow:
        1. Reject an excessive member count.
        2. Sum declared regular-file bytes and enforce total-size and expansion limits.

        Failure cases:
        - Any exceeded budget rejects the archive before extraction begins.

        Side effects:
        - Pure accounting and validation; performs no filesystem writes.
        """
        if member_count > self._max_member_count:
            raise ArchiveMaterializationError("archive exceeds the maximum member count")
        total_size_bytes = sum(file_sizes)
        if total_size_bytes > self._max_total_size_bytes:
            raise ArchiveMaterializationError("archive exceeds the maximum total workspace size")
        if archive_size_bytes > 0 and total_size_bytes > archive_size_bytes * self._max_expansion_ratio:
            raise ArchiveMaterializationError("archive expansion ratio exceeds the allowed limit")
        return total_size_bytes

    def _write_or_hash_entry(
        self, extracted: BinaryIO, target_path: Path, declared_size: int,
    ) -> str | None:
        """Business purpose:
        Preserve exact source bytes or their hash without unbounded decompression into memory.

        Business rules:
        - Each entry is read in fixed-size chunks and must match its declared uncompressed length.
        - Oversized files are hashed but never materialized into the workspace.

        Execution flow:
        1. Open an exclusive workspace file when the entry is within the file limit.
        2. Stream bytes while checking actual size and updating a hash when required.
        3. Return the hash for an omitted oversized file.

        Failure cases:
        - Truncated, oversized or unreadable content aborts the complete workspace operation.

        Side effects:
        - Writes bounded source bytes to one new workspace file or reads them for hashing.
        """
        oversized = declared_size > self._max_file_size_bytes
        digest = hashlib.sha256() if oversized else None
        if not oversized:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            destination = target_path.open("xb")
        else:
            destination = None
        actual_size = 0
        try:
            while True:
                chunk = extracted.read(_COPY_CHUNK_SIZE)
                if not chunk:
                    break
                actual_size += len(chunk)
                if actual_size > declared_size or actual_size > self._max_total_size_bytes:
                    raise ArchiveMaterializationError("archive entry exceeded its declared size")
                if digest is not None:
                    digest.update(chunk)
                if destination is not None:
                    destination.write(chunk)
            if actual_size != declared_size:
                raise ArchiveMaterializationError("archive entry is truncated")
        finally:
            if destination is not None:
                destination.close()
        return digest.hexdigest() if digest is not None else None

    def _zip_entry_kind(self, member: zipfile.ZipInfo) -> str:
        """Business purpose:
        Classify ZIP file types so repository extraction never creates links or devices.

        Business rules:
        - Only regular files and directories are materialization candidates; all special types are omitted.
        - Directory names and Unix type bits must not contradict one another.

        Execution flow:
        1. Read the Unix file type from the ZIP external attributes.
        2. Return the safe category or reject contradictory directory metadata.

        Failure cases:
        - Contradictory ZIP type metadata rejects the complete archive.

        Side effects:
        - Read-only metadata classification; creates no filesystem entries.
        """
        mode = (member.external_attr >> 16) & 0xFFFF
        file_type = stat.S_IFMT(mode)
        if member.is_dir() and file_type not in {0, stat.S_IFDIR}:
            raise ArchiveMaterializationError("ZIP entry type metadata is contradictory")
        if member.is_dir() or file_type == stat.S_IFDIR:
            return "directory"
        if file_type in {0, stat.S_IFREG}:
            return "file"
        return "special"

    def _validate_zip_local_metadata(
        self, archive: zipfile.ZipFile, member: zipfile.ZipInfo,
    ) -> None:
        """Business purpose:
        Ensure ZIP local headers agree with the directory metadata used to authorize extraction.

        Business rules:
        - Member name, type, flags, sizes and CRC declarations must be internally consistent.
        - ZIP64 values and data-descriptor placeholders are accepted only in their defined positions.

        Execution flow:
        1. Read the local header and its bounded filename/extra metadata.
        2. Compare local declarations with the central-directory entry and restore the stream cursor.

        Failure cases:
        - Truncated or contradictory headers reject the archive before member bytes are written.

        Side effects:
        - Reads archive metadata only and restores the input stream position.
        """
        archive_file = archive.fp
        if archive_file is None:
            raise ArchiveMaterializationError("ZIP archive is closed")
        current = None
        try:
            current = archive_file.tell()
            archive_file.seek(member.header_offset)
            raw_header = archive_file.read(zipfile.sizeFileHeader)
            if len(raw_header) != zipfile.sizeFileHeader:
                raise ArchiveMaterializationError("ZIP local header is truncated")
            header = struct.unpack(zipfile.structFileHeader, raw_header)
            if header[0] != zipfile.stringFileHeader:
                raise ArchiveMaterializationError("ZIP local header signature is invalid")
            if header[3] != member.flag_bits or header[4] != member.compress_type:
                raise ArchiveMaterializationError("ZIP local header metadata is contradictory")
            filename_length = header[10]
            extra_length = header[11]
            raw_name = archive_file.read(filename_length)
            local_extra = archive_file.read(extra_length)
            if len(raw_name) != filename_length or len(local_extra) != extra_length:
                raise ArchiveMaterializationError("ZIP local header is truncated")
            encoding = "utf-8" if member.flag_bits & 0x800 else "cp437"
            try:
                local_name = raw_name.decode(encoding)
            except UnicodeDecodeError as error:
                raise ArchiveMaterializationError("ZIP local filename is invalid") from error
            if local_name != member.orig_filename:
                raise ArchiveMaterializationError("ZIP local filename is contradictory")

            local_crc = header[7]
            local_compressed, local_size = self._zip64_local_sizes(
                local_extra, header[8], header[9],
            )
            has_data_descriptor = bool(member.flag_bits & 0x08)
            expected = (member.CRC, member.compress_size, member.file_size)
            actual = (local_crc, local_compressed, local_size)
            if has_data_descriptor:
                if any(value not in {0, expected[index]} for index, value in enumerate(actual)):
                    raise ArchiveMaterializationError("ZIP data descriptor metadata is contradictory")
            elif actual != expected:
                raise ArchiveMaterializationError("ZIP local sizes contradict the central directory")
        except ArchiveMaterializationError:
            raise
        except (OSError, struct.error, ValueError) as error:
            raise ArchiveMaterializationError("ZIP local header is malformed") from error
        finally:
            if current is not None:
                try:
                    archive_file.seek(current)
                except (OSError, ValueError):
                    raise ArchiveMaterializationError("ZIP stream could not be restored after validation")

    def _zip64_local_sizes(
        self, extra: bytes, compressed_size: int, file_size: int,
    ) -> tuple[int, int]:
        """Business purpose:
        Resolve extended ZIP sizes without treating ZIP64 sentinels as real resource values.

        Business rules:
        - Extended size fields are read only from the ZIP64 extra record and only when a sentinel requires them.

        Execution flow:
        1. Parse bounded extra-field records until the ZIP64 size record is found.
        2. Read required 64-bit values and return compressed then uncompressed sizes.

        Failure cases:
        - Missing, malformed or truncated ZIP64 size metadata rejects the archive.

        Side effects:
        - Pure metadata parsing; performs no filesystem writes.
        """
        needs_file_size = file_size == 0xFFFFFFFF
        needs_compressed_size = compressed_size == 0xFFFFFFFF
        if not needs_file_size and not needs_compressed_size:
            return compressed_size, file_size

        offset = 0
        zip64_sizes: list[int] | None = None
        while offset < len(extra):
            if offset + 4 > len(extra):
                raise ArchiveMaterializationError("ZIP extra metadata is malformed")
            field_id, field_size = struct.unpack_from("<HH", extra, offset)
            offset += 4
            end = offset + field_size
            if end > len(extra):
                raise ArchiveMaterializationError("ZIP extra metadata is truncated")
            field_data = extra[offset:end]
            if field_id == 0x0001:
                values = []
                value_offset = 0
                if needs_file_size:
                    if value_offset + 8 > len(field_data):
                        raise ArchiveMaterializationError("ZIP64 file size metadata is missing")
                    values.append(struct.unpack_from("<Q", field_data, value_offset)[0])
                    value_offset += 8
                if needs_compressed_size:
                    if value_offset + 8 > len(field_data):
                        raise ArchiveMaterializationError("ZIP64 compressed size metadata is missing")
                    values.append(struct.unpack_from("<Q", field_data, value_offset)[0])
                zip64_sizes = values
                break
            offset = end
        if zip64_sizes is None:
            raise ArchiveMaterializationError("ZIP64 local size metadata is missing")

        value_index = 0
        if needs_file_size:
            file_size = zip64_sizes[value_index]
            value_index += 1
        if needs_compressed_size:
            compressed_size = zip64_sizes[value_index]
        return compressed_size, file_size

    def _detect_archive_format(self, archive_file: BinaryIO) -> str:
        """Business purpose:
        Select the supported parser from container bytes instead of trusting an extension.

        Business rules:
        - Only gzip-compressed TAR and ZIP signatures are accepted for repository source retrieval.

        Execution flow:
        1. Read a short signature from a seekable stream and restore its cursor.
        2. Return the matching format or reject the input.

        Failure cases:
        - Unreadable streams and unrecognized signatures reject the archive.

        Side effects:
        - Reads and restores a small prefix; does not alter archive content.
        """
        try:
            position = archive_file.tell()
            signature = archive_file.read(4)
            archive_file.seek(position)
        except (AttributeError, OSError, ValueError) as error:
            raise ArchiveMaterializationError("archive stream must be seekable") from error
        if signature.startswith(b"\x1f\x8b"):
            return "tar.gz"
        if signature.startswith((b"PK\x03\x04", b"PK\x05\x06")):
            return "zip"
        raise ArchiveMaterializationError("archive format is not supported")

    def _ensure_binary_stream(self, archive_stream: BinaryIO | bytes) -> BinaryIO:
        """Business purpose:
        Give both archive parsers a seekable source without loading decompressed content into memory.

        Business rules:
        - Byte inputs use an in-memory compressed stream; non-seekable inputs are spooled with a memory threshold.

        Execution flow:
        1. Wrap immutable bytes directly.
        2. Reuse seekable streams or copy non-seekable compressed input to a spooled temporary file.

        Failure cases:
        - Source read or spool errors abort materialization before archive extraction.

        Side effects:
        - May allocate a temporary compressed-input spool that the caller closes after parsing.
        """
        if isinstance(archive_stream, bytes):
            return io.BytesIO(archive_stream)
        try:
            position = archive_stream.tell()
            archive_stream.seek(position)
            return archive_stream
        except (AttributeError, OSError, ValueError):
            spool = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
            shutil.copyfileobj(archive_stream, spool, length=_COPY_CHUNK_SIZE)
            spool.seek(0)
            return spool


    def _archive_size_bytes(self, archive_file: BinaryIO) -> int:
        """Business purpose:
        Measure compressed input so decompression expansion can be bounded consistently.

        Business rules:
        - The archive size is measured without changing the caller's current stream position.

        Execution flow:
        1. Save the cursor, seek to the end, capture the byte count and restore the cursor.

        Failure cases:
        - Streams that cannot report their size are rejected instead of bypassing the ratio guard.

        Side effects:
        - Temporarily moves and then restores the input stream cursor.
        """
        try:
            current = archive_file.tell()
            archive_file.seek(0, 2)
            end = archive_file.tell()
            archive_file.seek(current)
            return end
        except (AttributeError, OSError, ValueError) as error:
            raise ArchiveMaterializationError("archive stream must be seekable") from error

    def _seek_archive_start(self, archive_file: BinaryIO) -> None:
        """Business purpose:
        Ensure archive detection and parsing cover the complete immutable response body.

        Business rules:
        - Container parsing always begins at byte zero.

        Execution flow:
        1. Seek the prepared stream to its beginning before signature detection.

        Failure cases:
        - A stream that cannot return to its beginning is rejected before extraction.

        Side effects:
        - Updates the stream cursor; archive bytes remain unchanged.
        """
        try:
            archive_file.seek(0)
        except (AttributeError, OSError, ValueError) as error:
            raise ArchiveMaterializationError("archive stream must be seekable") from error

    def _result(
        self,
        job_id: str,
        snapshot_id: str | None,
        workspace_path: Path,
        total_size_bytes: int,
        extracted_files: int,
        skipped_entries: list[SkippedArchiveEntry],
        verified_archive_root: str | None = None,
    ) -> MaterializationResult:
        """Business purpose:
        Return one consistent coverage summary for either supported archive format.

        Business rules:
        - Omitted entries determine skipped-file count and whether source coverage is limited.

        Execution flow:
        1. Combine snapshot identity, workspace totals and omission records into the result value.

        Failure cases:
        - Invalid internal summaries are rejected by the dataclass or earlier extraction guards.

        Side effects:
        - Constructs an immutable in-memory result without filesystem changes.
        """
        return MaterializationResult(
            job_id=job_id,
            snapshot_id=snapshot_id,
            workspace_path=workspace_path,
            total_size_bytes=total_size_bytes,
            extracted_files=extracted_files,
            skipped_files=len(skipped_entries),
            coverage_limited=bool(skipped_entries),
            skipped_entries=tuple(skipped_entries),
            verified_archive_root=verified_archive_root,
        )


def _path_set_sha256(paths: list[str]) -> str:
    """Business purpose:
    Compute the shared commitment used to compare archive paths with Azure's pinned Git tree.

    Business rules:
    - Paths are compared as exact UTF-8 byte strings and cannot be Unicode-normalized or case-folded.
    - Length-prefixing prevents ambiguous concatenations of adjacent path values.

    Execution flow:
    1. Encode each validated path as strict UTF-8.
    2. Sort the encoded byte strings and hash each 32-bit big-endian length followed by its bytes.

    Failure cases:
    - Invalid Unicode or an overlong path length aborts root verification.

    Side effects:
    - Pure digest computation; no archive or filesystem content is changed.
    """
    encoded_paths = [path.encode("utf-8", errors="strict") for path in paths]
    digest = hashlib.sha256()
    for encoded in sorted(encoded_paths):
        if len(encoded) > 0xFFFFFFFF:
            raise ArchiveMaterializationError("tree path exceeds verification limits")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
    return digest.hexdigest()

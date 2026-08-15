from __future__ import annotations

import io
import shutil
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO


DEFAULT_MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024
DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_MEMBER_COUNT = 20_000
DEFAULT_MAX_PATH_DEPTH = 20
DEFAULT_MAX_EXPANSION_RATIO = 100


class ArchiveMaterializationError(RuntimeError):
    """Raised when a repository snapshot archive cannot be materialized safely."""


@dataclass(frozen=True)
class MaterializationResult:
    """Summarizes the temporary workspace created for an immutable scan snapshot."""

    job_id: str
    snapshot_id: str | None
    workspace_path: Path
    total_size_bytes: int
    extracted_files: int
    skipped_files: int
    coverage_limited: bool


class ScannerWorkspace:
    """Materialize repository archives into bounded, isolated temporary workspaces.

    Archive extraction is treated as an untrusted-input boundary. The workspace
    rejects traversal, links/devices, excessive path depth/member count/expansion,
    and oversized archives. Individual oversized files are skipped with an explicit
    coverage limitation instead of weakening the global extraction limits.
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
        ) / "lcsp-scanner"
        self._max_total_size_bytes = max_total_size_bytes
        self._max_file_size_bytes = max_file_size_bytes
        self._max_member_count = max_member_count
        self._max_path_depth = max_path_depth
        self._max_expansion_ratio = max_expansion_ratio

    @property
    def root_path(self) -> Path:
        """Return the parent directory that contains per-scan workspaces."""
        return self._root_path

    def workspace_path(self, job_id: str) -> Path:
        """Return the deterministic temporary path allocated to a scan job."""
        return self._root_path / job_id

    def create(self, job_id: str) -> Path:
        """Create and return the per-job workspace directory."""
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
    ) -> MaterializationResult:
        """Safely extract a gzip tar snapshot into the scan workspace.

        Args:
            job_id: Scan job used to isolate the temporary directory.
            archive_stream: Snapshot archive bytes or seekable binary stream.
            snapshot_id: Optional immutable snapshot identifier for provenance.

        Returns:
            Extraction counts, size, workspace path, and coverage-limit status.

        Raises:
            ArchiveMaterializationError: If archive structure or resource usage
                violates a safety limit.
            tarfile.TarError: If the snapshot is not a readable gzip tar archive.
        """
        workspace_path = self.create(job_id)
        archive_file = self._ensure_binary_stream(archive_stream)
        archive_size_bytes = self._archive_size_bytes(archive_stream)

        try:
            with tarfile.open(fileobj=archive_file, mode="r:gz") as archive:
                members = archive.getmembers()
                self._validate_archive_members(workspace_path, members)

                total_size_bytes = sum(member.size for member in members if member.isfile())
                if total_size_bytes > self._max_total_size_bytes:
                    raise ArchiveMaterializationError(
                        "archive exceeds the maximum total workspace size"
                    )
                if archive_size_bytes > 0 and total_size_bytes > archive_size_bytes * self._max_expansion_ratio:
                    raise ArchiveMaterializationError(
                        "archive expansion ratio exceeds the allowed limit"
                    )

                extracted_files = 0
                skipped_files = 0
                coverage_limited = False
                member_count = 0

                for member in members:
                    member_count += 1
                    if member_count > self._max_member_count:
                        raise ArchiveMaterializationError(
                            "archive exceeds the maximum member count"
                        )

                    if member.isdir():
                        self._safe_member_path(workspace_path, member.name).mkdir(
                            parents=True, exist_ok=True
                        )
                        continue

                    if member.issym() or member.islnk() or member.isdev():
                        raise ArchiveMaterializationError(
                            f"unsupported archive entry type: {member.name!r}"
                        )

                    if not member.isfile():
                        continue

                    if member.size > self._max_file_size_bytes:
                        skipped_files += 1
                        coverage_limited = True
                        continue

                    target_path = self._safe_member_path(workspace_path, member.name)
                    target_path.parent.mkdir(parents=True, exist_ok=True)

                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise ArchiveMaterializationError(
                            f"unable to read archive entry: {member.name!r}"
                        )

                    with extracted, target_path.open("wb") as destination:
                        shutil.copyfileobj(extracted, destination)

                    extracted_files += 1

                return MaterializationResult(
                    job_id=job_id,
                    snapshot_id=snapshot_id,
                    workspace_path=workspace_path,
                    total_size_bytes=total_size_bytes,
                    extracted_files=extracted_files,
                    skipped_files=skipped_files,
                    coverage_limited=coverage_limited,
                )
        except Exception:
            self.cleanup(job_id)
            raise

    def _validate_archive_members(
        self,
        workspace_path: Path,
        members: list[tarfile.TarInfo],
    ) -> None:
        """Preflight all archive member paths before any file content is written."""
        for member in members:
            self._validate_member_depth(member.name)
            self._safe_member_path(workspace_path, member.name)

    def _validate_member_depth(self, member_name: str) -> None:
        """Reject empty or excessively nested archive paths."""
        normalized = member_name.replace("\\", "/").strip("/")
        if not normalized:
            raise ArchiveMaterializationError("archive entry name is empty")

        depth = len([segment for segment in normalized.split("/") if segment])
        if depth > self._max_path_depth:
            raise ArchiveMaterializationError(
                f"archive entry exceeds maximum path depth: {member_name!r}"
            )

    def _safe_member_path(self, workspace_path: Path, member_name: str) -> Path:
        """Resolve an archive member and enforce that it remains inside the workspace."""
        workspace_resolved = workspace_path.resolve(strict=False)
        candidate = (workspace_path / member_name).resolve(strict=False)
        if candidate != workspace_resolved and workspace_resolved not in candidate.parents:
            raise ArchiveMaterializationError(
                f"archive entry escapes workspace: {member_name!r}"
            )

        return candidate

    def _ensure_binary_stream(self, archive_stream: BinaryIO | bytes) -> BinaryIO:
        """Wrap byte archives in an in-memory stream while preserving file-like inputs."""
        if isinstance(archive_stream, bytes):
            return io.BytesIO(archive_stream)
        return archive_stream

    def _archive_size_bytes(self, archive_stream: BinaryIO | bytes) -> int:
        """Best-effort compressed-size measurement used by the expansion-ratio guard."""
        if isinstance(archive_stream, bytes):
            return len(archive_stream)

        try:
            current = archive_stream.tell()
            archive_stream.seek(0, 2)
            end = archive_stream.tell()
            archive_stream.seek(current)
            return end
        except Exception:
            return 0

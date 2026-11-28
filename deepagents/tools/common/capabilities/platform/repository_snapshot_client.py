"""Worker-authenticated access to immutable repository snapshot archives."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from http import HTTPStatus
from typing import Callable

import httpx

DEFAULT_RATE_LIMIT_RETRY_DELAYS_SECONDS = (30.0, 60.0, 120.0)
MAX_RATE_LIMIT_RETRY_DELAY_SECONDS = 120.0


@dataclass(frozen=True)
class RepositoryArchiveRequest:
    """Identify one immutable repository snapshot archive."""

    snapshot_id: str
    scan_job_id: str
    correlation_id: str


@dataclass(frozen=True)
class RepositoryArchiveDownload:
    """Pinned archive bytes and independently validated source-root metadata."""

    content: bytes
    content_type: str | None
    archive_root: str | None
    archive_root_status: str
    tree_manifest: RepositoryTreePathManifest | None


@dataclass(frozen=True)
class RepositoryTreePathManifest:
    """Hash commitment to the pinned repository's regular Git blob paths."""

    version: int
    commit_sha: str
    tree_id: str
    file_count: int
    path_sha256: str


class RepositorySnapshotClient:
    """Download pinned repository archives through the worker-authenticated API."""

    def __init__(
        self,
        base_url: str,
        worker_api_key: str,
        *,
        retry_delays_seconds: tuple[float, ...] = DEFAULT_RATE_LIMIT_RETRY_DELAYS_SECONDS,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._worker_api_key = worker_api_key
        self._retry_delays_seconds = retry_delays_seconds
        self._sleeper = sleeper

    def download_archive(self, request: RepositoryArchiveRequest) -> bytes:
        """Business purpose:
        Preserve the existing byte-only snapshot client contract for callers that do not consume archive metadata.

        Business rules:
        - Returned bytes have already passed media type and archive signature validation.

        Execution flow:
        1. Download the authorized archive with metadata.
        2. Return only its content bytes.

        Failure cases:
        - HTTP, metadata, and archive validation failures propagate without returning bytes.

        Side effects:
        - Performs the same read-only worker-authenticated request as `download_archive_with_metadata`.
        """
        return self.download_archive_with_metadata(request).content

    def download_archive_with_metadata(
        self, request: RepositoryArchiveRequest
    ) -> RepositoryArchiveDownload:
        """Business purpose:
        Download the immutable repository archive authorized for one scan job.

        Business rules:
        - Only a supported TAR.GZ or ZIP response may be returned to the workspace materializer.
        - A declared archive media type must agree with the response signature; generic binary media types are signature-checked.
        - Rate-limited requests use bounded retry delays and retain the existing worker authorization.
        - Unknown archive roots are accepted only with a complete pinned-tree manifest for workspace verification.

        Execution flow:
        1. Request the pinned snapshot archive with the worker key and correlation identifier.
        2. Retry only HTTP 429 responses within the configured retry budget.
        3. Validate archive signature, explicit root status, and any pinned-tree manifest.
        4. Acknowledge a trusted hydration ticket before exposing validated bytes to the caller.

        Failure cases:
        - HTTP failures, exhausted rate limits, unsupported media types, contradictory signatures, or malformed wrapper metadata abort hydration.
        - A failed hydration acknowledgement aborts the download so the worker cannot treat an uncommitted delivery as successful.

        Side effects:
        - Performs read-only API requests and invokes the configured retry sleeper when rate limited.
        """

        for retry_index in range(len(self._retry_delays_seconds) + 1):
            response = httpx.get(
                f"{self._base_url}/internal/repository-snapshots/{request.snapshot_id}/archive",
                params={"scanJobId": request.scan_job_id},
                headers={
                    "X-Worker-Api-Key": self._worker_api_key,
                    "X-Correlation-Id": request.correlation_id,
                },
                timeout=30.0,
            )

            if response.status_code != HTTPStatus.TOO_MANY_REQUESTS:
                response.raise_for_status()
                content_type = response.headers.get("content-type")
                _validate_archive_response(content_type, response.content)
                archive_root = response.headers.get("x-repository-archive-root")
                _validate_archive_root(archive_root)
                root_status = response.headers.get(
                    "x-repository-archive-root-status"
                )
                tree_manifest = _read_tree_manifest(response.headers)
                response_commit = response.headers.get("x-commit-sha")
                if tree_manifest is not None and (
                    response_commit is None
                    or response_commit.lower() != tree_manifest.commit_sha
                ):
                    raise RuntimeError("snapshot tree manifest commit does not match archive")
                if root_status is None:
                    if archive_root is not None:
                        root_status = "VERIFIED_WRAPPER"
                    else:
                        raise RuntimeError("snapshot archive root status is missing")
                _validate_root_status(root_status, archive_root, tree_manifest)
                hydration_ticket_id = response.headers.get("x-hydration-ticket-id")
                if hydration_ticket_id is not None:
                    # Why: The server can fail to finalize after bytes leave its
                    # socket. The worker repairs that state before using them.
                    if hydration_ticket_id != request.scan_job_id:
                        raise RuntimeError("hydration ticket header does not match requested scan job")
                    acknowledgement = httpx.post(
                        f"{self._base_url}/internal/repository-snapshots/{request.snapshot_id}/archive/ack/{hydration_ticket_id}",
                        headers={
                            "X-Worker-Api-Key": self._worker_api_key,
                            "X-Correlation-Id": request.correlation_id,
                        },
                        timeout=30.0,
                    )
                    acknowledgement.raise_for_status()
                return RepositoryArchiveDownload(
                    content=response.content,
                    content_type=_normalized_archive_content_type(content_type),
                    archive_root=archive_root,
                    archive_root_status=root_status,
                    tree_manifest=tree_manifest,
                )

            if retry_index >= len(self._retry_delays_seconds):
                response.raise_for_status()

            fallback_delay = self._retry_delays_seconds[retry_index]
            self._sleeper(_rate_limit_retry_delay(response, fallback_delay))

        raise RuntimeError("snapshot rate-limit retry loop exhausted unexpectedly")


def _rate_limit_retry_delay(response: httpx.Response, fallback_delay: float) -> float:
    raw_retry_after = response.headers.get("retry-after")
    if raw_retry_after:
        try:
            retry_after = float(raw_retry_after)
        except ValueError:
            retry_after = fallback_delay
        if retry_after >= 0:
            return min(retry_after, MAX_RATE_LIMIT_RETRY_DELAY_SECONDS)
    return fallback_delay


def _validate_archive_response(content_type: str | None, content: bytes) -> None:
    """Business purpose:
    Prevent contradictory or unsupported API archive metadata from reaching repository hydration.

    Business rules:
    - TAR.GZ is identified by gzip magic and ZIP by a supported ZIP signature.
    - Declared gzip and ZIP media types must match those signatures; generic binary media is signature-checked.
    - Missing media type metadata leaves format detection to the shared materializer.

    Execution flow:
    1. Normalize the optional media type without parameters.
    2. Match a recognized type to the archive's leading signature.
    3. Reject unsupported declarations or mismatches before source bytes are returned.

    Failure cases:
    - Unsupported media types and malformed or contradictory signatures raise a safe runtime error.

    Side effects:
    - Pure validation; does not modify archive bytes or perform I/O.
    """
    if content_type is None:
        return
    normalized_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    gzip_signature = content.startswith(b"\x1f\x8b")
    zip_signature = content.startswith((b"PK\x03\x04", b"PK\x05\x06"))
    if normalized_type in {"application/gzip", "application/x-gzip"} and gzip_signature:
        return
    if normalized_type in {"application/zip", "application/x-zip-compressed"} and zip_signature:
        return
    if normalized_type == "application/octet-stream" and (gzip_signature or zip_signature):
        return
    raise RuntimeError("snapshot archive media type does not match a supported archive format")


def _normalized_archive_content_type(content_type: str | None) -> str | None:
    """Business purpose:
    Preserve the declared archive format metadata after the response passes signature validation.

    Business rules:
    - Media type parameters do not change the supported format identifier.
    - Missing media type remains unknown so the workspace materializer can rely on archive signatures.

    Execution flow:
    1. Return null when the provider/API omitted the header.
    2. Normalize the media type to lowercase without parameters.

    Failure cases:
    - Unsupported or contradictory values are rejected by `_validate_archive_response` before this helper is called.

    Side effects:
    - Pure normalization.
    """
    if content_type is None:
        return None
    return content_type.split(";", maxsplit=1)[0].strip().lower()


def _validate_archive_root(archive_root: str | None) -> None:
    """Business purpose:
    Reject ambiguous archive wrapper metadata before it can change repository-relative paths.

    Business rules:
    - A wrapper name is one exact path component supplied by the authenticated API transport.
    - Missing metadata preserves all archive paths; malformed metadata never triggers heuristic stripping.

    Execution flow:
    1. Accept absent metadata.
    2. Validate the supplied name as a bounded, non-traversing component.

    Failure cases:
    - Empty, oversized, dot, separator, drive, or control-bearing values abort hydration.

    Side effects:
    - Pure validation; no filesystem access or archive mutation occurs.
    """
    if archive_root is None:
        return
    if (
        not archive_root
        or len(archive_root) > 255
        or archive_root in {".", ".."}
        or "/" in archive_root
        or "\\" in archive_root
        or ":" in archive_root
        or any(ord(character) < 32 or ord(character) == 127 for character in archive_root)
    ):
        raise RuntimeError("snapshot archive root metadata is invalid")


def _read_tree_manifest(
    headers: httpx.Headers,
) -> RepositoryTreePathManifest | None:
    """Business purpose:
    Parse the compact Azure tree commitment that allows the secure workspace to resolve ZIP root semantics.

    Business rules:
    - Every manifest field is required together and must be bounded and correctly encoded.
    - The manifest is tied to the same pinned commit delivered by the API.

    Execution flow:
    1. Read all tree headers and distinguish a wholly absent manifest from a partial one.
    2. Validate version, commit/tree identifiers, path count and SHA-256 digest.
    3. Return the immutable manifest value for workspace verification.

    Failure cases:
    - Partial, malformed, or mismatched metadata aborts source hydration.

    Side effects:
    - Pure header validation; no source bytes or credentials are modified.
    """
    names = {
        "version": "x-repository-tree-manifest-version",
        "commit_sha": "x-repository-tree-commit-sha",
        "tree_id": "x-repository-tree-id",
        "file_count": "x-repository-tree-file-count",
        "path_sha256": "x-repository-tree-path-sha256",
    }
    values = {key: headers.get(name) for key, name in names.items()}
    present = [value is not None for value in values.values()]
    if not any(present):
        return None
    if not all(present):
        raise RuntimeError("snapshot tree manifest is incomplete")
    version = values["version"]
    commit_sha = values["commit_sha"]
    tree_id = values["tree_id"]
    file_count = values["file_count"]
    path_sha256 = values["path_sha256"]
    assert version is not None and commit_sha is not None
    assert tree_id is not None and file_count is not None and path_sha256 is not None
    if (
        version != "1"
        or re.fullmatch(r"[0-9a-fA-F]{40}", commit_sha) is None
        or re.fullmatch(r"[0-9a-fA-F]{40}", tree_id) is None
        or re.fullmatch(r"(?:0|[1-9][0-9]{0,5})", file_count) is None
        or int(file_count) > 100_000
        or re.fullmatch(r"[0-9a-fA-F]{64}", path_sha256) is None
    ):
        raise RuntimeError("snapshot tree manifest is invalid")
    return RepositoryTreePathManifest(
        version=1,
        commit_sha=commit_sha.lower(),
        tree_id=tree_id.lower(),
        file_count=int(file_count),
        path_sha256=path_sha256.lower(),
    )


def _validate_root_status(
    status: str,
    archive_root: str | None,
    tree_manifest: RepositoryTreePathManifest | None,
) -> None:
    """Business purpose:
    Require explicit and internally consistent archive-root proof before source reaches assessment execution.

    Business rules:
    - Wrapper status requires one exact root component; rootless status forbids a root and tree manifest.
    - Unknown status requires no claimed root and a valid pinned-tree manifest.

    Execution flow:
    1. Match the declared status to its permitted metadata shape.
    2. Reject unsupported status strings or contradictory claims.

    Failure cases:
    - Missing, contradictory, or unverifiable root metadata raises a safe runtime failure.

    Side effects:
    - Pure protocol validation; no filesystem or provider access.
    """
    if status == "VERIFIED_WRAPPER":
        if archive_root is None or tree_manifest is not None:
            raise RuntimeError("snapshot wrapper metadata is contradictory")
        return
    if status == "VERIFIED_ROOTLESS":
        if archive_root is not None or tree_manifest is not None:
            raise RuntimeError("snapshot rootless metadata is contradictory")
        return
    if status == "UNKNOWN":
        if archive_root is not None or tree_manifest is None:
            raise RuntimeError("snapshot archive root cannot be verified")
        return
    raise RuntimeError("snapshot archive root status is invalid")


__all__ = ["RepositoryArchiveDownload", "RepositoryArchiveRequest", "RepositorySnapshotClient"]

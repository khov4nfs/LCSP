from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).parents[1]
    / "runtime"
    / "legal"
    / "sources"
    / "scripts"
    / "build_reviewed_legal_corpus.py"
)
SPEC = importlib.util.spec_from_file_location("reviewed_legal_artifact_contract", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_article_33_repeal_scope_remains_canonical() -> None:
    """The deterministic Law 134 -> Law 71 repeal relationship remains code-owned."""
    assert MODULE.LAW_134 == "LAW-134-2025-QH15"
    assert MODULE.LAW_71 == "LAW-71-2025-QH15"
    assert MODULE.ARTICLE_33_REPEALS == (
        "art-3::cl-9",
        "art-4::cl-7",
        "art-12::cl-6",
        "art-34::cl-2::pt-đ",
        "art-41..art-45",
    )


def test_verified_manifest_source_artifact_is_hash_bound(tmp_path: Path) -> None:
    """Runtime source manifests replace the removed checked-in legal source snapshots."""
    source_path = tmp_path / "LAW-TEST.source.txt"
    source_path.write_text("verified legal source", encoding="utf-8")
    source_sha = MODULE.file_sha256(source_path)
    manifest_path = tmp_path / "LAW-TEST.source.json"
    manifest = {
        "documentId": "LAW-TEST",
        "textFile": source_path.name,
        "textSha256": source_sha,
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    resolved_path, resolved_ref, resolved_sha = MODULE.resolve_manifest_source_artifact(
        manifest_path,
        manifest,
    )

    assert resolved_path == source_path.resolve()
    assert resolved_ref == source_path.name
    assert resolved_sha == source_sha


def test_reviewed_source_snapshot_falls_back_to_verified_manifest(
    tmp_path: Path,
) -> None:
    """A removed reports snapshot can resolve through a verified runtime source artifact."""
    source_path = tmp_path / "LAW-TEST.canonical.txt"
    source_path.write_text("canonical runtime source", encoding="utf-8")
    source_sha = MODULE.file_sha256(source_path)
    manifest_path = tmp_path / "LAW-TEST.source.json"
    manifest = {
        "documentId": "LAW-TEST",
        "textFile": source_path.name,
        "textSha256": source_sha,
    }
    review_path = tmp_path / "LAW-TEST.hierarchy-review.json"
    review = {
        "documentId": "LAW-TEST",
        "reviewState": "APPROVED",
        "reviewedSourceSha256": "sha256:" + "0" * 64,
        "sourceReview": {
            "sourceSnapshotReviewed": "removed-reports-snapshot.pdf",
        },
    }

    resolved_sha, resolved_ref = MODULE.bind_reviewed_source_snapshot(
        manifest_path,
        manifest,
        review_path,
        review,
    )

    assert resolved_sha == source_sha
    assert resolved_ref == source_path.name
    assert review["_resolvedSourceSha256"] == source_sha
    assert review["_resolvedSourceSnapshotPath"] == str(source_path.resolve())
    assert review["_sourceSnapshotFallback"] == {
        "reason": "REVIEWED_SOURCE_SNAPSHOT_NOT_PRESENT",
        "declaredSnapshotPath": "removed-reports-snapshot.pdf",
        "manifestArtifactPath": source_path.name,
    }

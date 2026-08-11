from __future__ import annotations

import hashlib
import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
REVIEW_DIR = REPOSITORY_ROOT / "reports" / "legal-corpus-ocr"
DOCUMENT_IDS = ("LAW-134-2025-QH15", "LAW-71-2025-QH15")


def _sha256(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def test_reviewed_legal_artifacts_are_pdf_hash_bound_and_scoped() -> None:
    review_principals: set[str] = set()

    for document_id in DOCUMENT_IDS:
        reviewed_text = REVIEW_DIR / f"{document_id}.reviewed.txt"
        hierarchy_review = REVIEW_DIR / f"{document_id}.hierarchy-review.json"
        ocr_manifest = REVIEW_DIR / f"{document_id}.ocr.json"

        assert reviewed_text.is_file()
        assert hierarchy_review.is_file()
        assert ocr_manifest.is_file()

        review = json.loads(hierarchy_review.read_text(encoding="utf-8"))
        ocr = json.loads(ocr_manifest.read_text(encoding="utf-8"))
        assert review["documentId"] == document_id
        assert review["reviewState"] == "APPROVED"
        assert review["reviewedTextSha256"] == _sha256(reviewed_text)
        assert review["reviewScope"]["locators"]
        assert (
            review["reviewIdentityPolicy"]
            == "TECHNICAL_AUDIT_PRINCIPAL_NOT_LEGAL_SIGNATURE"
        )

        # Reviewed text must resolve back to the exact PDF bytes held in reports/.
        snapshot_ref = review["sourceReview"]["sourceSnapshotReviewed"]
        source_snapshot = REPOSITORY_ROOT / snapshot_ref
        assert source_snapshot.is_file()
        assert review["reviewedSourceSha256"] == _sha256(source_snapshot)
        assert ocr["sourceFile"] == snapshot_ref
        assert ocr["sourceSha256"] == review["reviewedSourceSha256"]

        review_principals.add(review["reviewedBy"])

    assert review_principals == {"lcsp-legal-review-gate"}


def test_law_134_hierarchy_correction_is_explicit() -> None:
    review = json.loads(
        (REVIEW_DIR / "LAW-134-2025-QH15.hierarchy-review.json").read_text(
            encoding="utf-8"
        )
    )
    chapters = {chapter["chapter"]: chapter["articles"] for chapter in review["chapters"]}
    assert chapters["VI"] == {"from": 28, "to": 29}
    assert chapters["VII"] == {"from": 30, "to": 32}
    assert chapters["VIII"] == {"from": 33, "to": 35}
    assert review["hierarchyCorrections"] == [
        {
            "raw": "Chương VI before Điều 30",
            "reviewed": "Chương VII",
            "scope": "Điều 30-32",
            "reason": "Authoritative/public full-text structure places Điều 30-32 under Chương VII; Chương VI already contains Điều 28-29 and Chương VIII begins at Điều 33.",
        }
    ]


def test_law_71_repeal_scope_matches_law_134_article_33() -> None:
    review = json.loads(
        (REVIEW_DIR / "LAW-71-2025-QH15.hierarchy-review.json").read_text(
            encoding="utf-8"
        )
    )
    assert review["repealReview"]["repealedLocators"] == [
        "art-3::cl-9",
        "art-4::cl-7",
        "art-12::cl-6",
        "art-34::cl-2::pt-đ",
        "art-41..art-45",
    ]
    assert review["repealReview"]["rangeExpansion"]["art-41..art-45"] == [
        "art-41",
        "art-42",
        "art-43",
        "art-44",
        "art-45",
    ]

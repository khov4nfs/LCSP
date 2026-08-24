import importlib.util
import json
import sys
from pathlib import Path

import pytest


script_path = (
    Path(__file__).parents[1]
    / "runtime"
    / "legal"
    / "scripts"
    / "build_reviewed_legal_corpus.py"
)
spec = importlib.util.spec_from_file_location("build_reviewed_legal_corpus", script_path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def reviewed_manifest(
    tmp_path: Path,
    document_id: str,
    text: str,
    *,
    chapters: list[dict] | None = None,
    full_text_reviewed_locators: list[str] | None = None,
    source_effect_status: str = "CON_HIEU_LUC",
) -> Path:
    text_path = tmp_path / f"{document_id}.reviewed.txt"
    review_path = tmp_path / f"{document_id}.hierarchy-review.json"
    manifest_path = tmp_path / f"{document_id}.source.json"
    snapshot_path = tmp_path / f"{document_id}.pdf"

    text_path.write_text(text, encoding="utf-8")
    snapshot_path.write_bytes(f"pdf:{document_id}".encode())
    source_sha = module.file_sha256(snapshot_path)

    review_path.write_text(
        json.dumps(
            {
                "documentId": document_id,
                "reviewState": "APPROVED",
                "reviewedTextSha256": module.sha256(text),
                "reviewedSourceSha256": source_sha,
                "sourceReview": {
                    "sourceSnapshotReviewed": snapshot_path.name,
                    "canonicalSourceUrl": "https://vbpl.vn/test",
                },
                "reviewScope": {
                    "fullTextReviewedLocators": full_text_reviewed_locators
                    or ["art-1"]
                },
                "chapters": chapters or [],
            }
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": document_id,
                "title": document_id,
                "sourceUrl": "https://vbpl.vn/test",
                "sourceSha256": source_sha,
                "sourceEffectStatus": source_effect_status,
                "reviewedTextFile": text_path.name,
                "hierarchyReviewFile": review_path.name,
            }
        ),
        encoding="utf-8",
    )
    return manifest_path


def add_article_33_review_assertions(tmp_path: Path) -> None:
    law_134_path = tmp_path / f"{module.LAW_134}.hierarchy-review.json"
    law_71_path = tmp_path / f"{module.LAW_71}.hierarchy-review.json"
    law_134 = json.loads(law_134_path.read_text(encoding="utf-8"))
    law_71 = json.loads(law_71_path.read_text(encoding="utf-8"))
    expected = list(module.ARTICLE_33_REPEALS)
    law_134["legalEffectAssertions"] = [
        {
            "amendingLocator": "art-33",
            "targetDocumentId": module.LAW_71,
            "repealedLocators": expected,
        }
    ]
    law_71["repealReview"] = {
        "amendingDocumentId": module.LAW_134,
        "amendingLocator": "art-33",
        "repealedLocators": expected,
        "rangeExpansion": {
            "art-41..art-45": [
                "art-41",
                "art-42",
                "art-43",
                "art-44",
                "art-45",
            ],
            "includeDescendants": True,
        },
    }
    law_134_path.write_text(json.dumps(law_134), encoding="utf-8")
    law_71_path.write_text(json.dumps(law_71), encoding="utf-8")


def test_fails_closed_without_approved_review(tmp_path: Path):
    manifest = reviewed_manifest(tmp_path, "LAW-TEST", "Điều 1. Test\n1. Nội dung\n")
    review = tmp_path / "LAW-TEST.hierarchy-review.json"
    review.write_text(
        json.dumps({"documentId": "LAW-TEST", "reviewState": "CHANGES_REQUIRED"}),
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="not APPROVED"):
        module.build_payload([manifest], "DRAFT-1")


def test_fails_closed_when_reports_pdf_hash_changes(tmp_path: Path):
    manifest = reviewed_manifest(tmp_path, "LAW-TEST", "Điều 1. Test\n1. Nội dung\n")
    (tmp_path / "LAW-TEST.pdf").write_bytes(b"tampered")
    with pytest.raises(RuntimeError, match="source snapshot hash"):
        module.build_payload([manifest], "DRAFT-1")


def test_structure_first_chunking_and_law_134_article_33_repeal(tmp_path: Path):
    law_134 = reviewed_manifest(
        tmp_path,
        module.LAW_134,
        "\n".join(
            [
                "NOTE",
                "Điều 9–15, the Chapter VI–VIII hierarchy boundary around Điều 28–35, and Điều 33.",
                "Chương VIII",
                "ĐIỀU KHOẢN THI HÀNH",
                "Điều 33. Bãi bỏ một số chương, điều, khoản, điểm",
                "Bãi bỏ khoản 9 Điều 3, khoản 7 Điều 4, khoản 6 Điều 12, điểm đ khoản 2 Điều 34 và Chương IV của Luật Công nghiệp công nghệ số.",
                "",
            ]
        ),
        chapters=[
            {
                "chapter": "VIII",
                "title": "ĐIỀU KHOẢN THI HÀNH",
                "articles": {"from": 33, "to": 35},
            }
        ],
        full_text_reviewed_locators=["art-33"],
    )
    law_71 = reviewed_manifest(
        tmp_path,
        module.LAW_71,
        "\n".join(
            [
                "Điều 3. Test",
                "9. Repealed",
                "Điều 4. Test",
                "7. Repealed",
                "Điều 12. Test",
                "6. Repealed",
                "Điều 34. Test",
                "2. Nội dung",
                "đ) Repealed point",
                "Điều 40. Boundary before",
                "[Boundary sentinel: outside repeal.]",
                "Chương IV",
                "TRÍ TUỆ NHÂN TẠO",
                "Điều 41. A",
                "1. Clause with points:",
                "a) First point",
                "continued point text",
                "b) Second point",
                "Điều 42. B",
                "Điều 43. B2",
                "Điều 44. B3",
                "Điều 45. C",
                "Chương V",
                "TÀI SẢN SỐ",
                "Điều 46. Active",
                "",
            ]
        ),
        chapters=[
            {
                "chapter": "I",
                "title": "NHỮNG QUY ĐỊNH CHUNG",
                "articles": {"from": 1, "to": 12},
            },
            {
                "chapter": "II",
                "title": "PHÁT TRIỂN CÔNG NGHIỆP CÔNG NGHỆ SỐ",
                "articles": {"from": 13, "to": 35},
            },
            {
                "chapter": "III",
                "title": "CÔNG NGHIỆP BÁN DẪN",
                "articles": {"from": 36, "to": 40},
            },
            {
                "chapter": "IV",
                "title": "TRÍ TUỆ NHÂN TẠO",
                "articles": {"from": 41, "to": 45},
            },
            {
                "chapter": "V",
                "title": "TÀI SẢN SỐ",
                "articles": {"from": 46, "to": 48},
            },
        ],
        full_text_reviewed_locators=[
            "art-3::cl-9",
            "art-4::cl-7",
            "art-12::cl-6",
            "art-34::cl-2::pt-đ",
            "art-41",
            "art-42",
            "art-43",
            "art-44",
            "art-45",
        ],
        source_effect_status="HET_HIEU_LUC_MOT_PHAN",
    )
    add_article_33_review_assertions(tmp_path)

    payload = module.build_payload([law_134, law_71], "DRAFT-1")
    law_134_doc, law_71_doc = payload["documents"]
    law_134_chunks = {item["locator"]: item for item in law_134_doc["chunks"]}
    law_71_chunks = {item["locator"]: item for item in law_71_doc["chunks"]}

    # The review-note range must not be misparsed as a second Article 9.
    assert "art-9" not in law_134_chunks

    # A no-clause article retains its substantive body, not only its heading.
    assert "Bãi bỏ khoản 9 Điều 3" in law_134_chunks["art-33"]["content"]
    assert law_134_chunks["art-33"]["hierarchy"]["chapterNumber"] == "VIII"
    assert law_134_chunks["art-33"]["hierarchy"]["chapterTitle"] == "ĐIỀU KHOẢN THI HÀNH"

    # Clause is the base retrieval unit and retains Point descendants.
    assert "đ) Repealed point" in law_71_chunks["art-34::cl-2"]["content"]
    assert "continued point text" in law_71_chunks["art-41::cl-1::pt-a"]["content"]
    assert "a) First point\ncontinued point text" in law_71_chunks["art-41::cl-1"]["content"]
    assert "b) Second point" in law_71_chunks["art-41::cl-1"]["content"]
    assert law_71_chunks["art-41::cl-1::pt-a"]["hierarchy"]["clauseNumber"] == "1"
    assert law_71_chunks["art-3::cl-9"]["hierarchy"]["chapterNumber"] == "I"

    # Article 33 repeal is locator-scoped and expands Chapter IV descendants.
    assert law_71_chunks["art-34::cl-2"]["legalStatus"] == "ACTIVE"
    assert law_71_chunks["art-34::cl-2::pt-đ"]["legalStatus"] == "REPEALED"
    assert law_71_chunks["art-41::cl-1::pt-a"]["hierarchy"]["repealedByRef"] == {
        "documentId": module.LAW_134,
        "locator": "art-33",
    }
    assert law_71_chunks["art-45"]["legalStatus"] == "REPEALED"

    # Boundary-only locators validate the range but are never published to retrieval.
    assert "art-40" not in law_71_chunks
    assert "art-46" not in law_71_chunks

    relationship = payload["sourceManifest"]["materializedRelationships"][0]
    assert relationship["declaredLocators"] == list(module.ARTICLE_33_REPEALS)
    assert relationship["boundaryAssertions"] == {
        "art-40": "ACTIVE_OUTSIDE_REPEAL_RANGE",
        "art-46": "ACTIVE_OUTSIDE_REPEAL_RANGE",
    }
    assert payload["sourceManifest"]["reviewRequired"] is True

    # Corpus provenance points to the reviewed source snapshot, not a pre-review payload.
    assert law_134_doc["snapshotPath"] == f"{module.LAW_134}.pdf"
    assert law_71_doc["snapshotPath"] == f"{module.LAW_71}.pdf"


def test_review_scope_excludes_hierarchy_only_articles(tmp_path: Path):
    manifest = reviewed_manifest(
        tmp_path,
        "LAW-TEST",
        "\n".join(
            [
                "Điều 1. Reviewed",
                "1. Publish me",
                "Điều 2. Boundary only",
                "[Hierarchy boundary reviewed; full text outside current scope.]",
            ]
        ),
        full_text_reviewed_locators=["art-1"],
    )

    payload = module.build_payload([manifest], "DRAFT-1")
    locators = {item["locator"] for item in payload["documents"][0]["chunks"]}
    assert locators == {"art-1", "art-1::cl-1"}
    assert "art-2" not in locators


def test_article_33_mapping_must_be_confirmed_by_both_reviews(tmp_path: Path):
    law_134 = reviewed_manifest(
        tmp_path,
        module.LAW_134,
        "Điều 33. Bãi bỏ\nBãi bỏ khoản 9 Điều 3 và Chương IV\n",
        full_text_reviewed_locators=["art-33"],
    )
    law_71 = reviewed_manifest(
        tmp_path,
        module.LAW_71,
        "\n".join(
            [
                "Điều 3. A",
                "9. X",
                "Điều 4. A",
                "7. X",
                "Điều 12. A",
                "6. X",
                "Điều 34. A",
                "2. X",
                "đ) X",
                "Điều 40. X",
                "Điều 41. X",
                "Điều 42. X",
                "Điều 43. X",
                "Điều 44. X",
                "Điều 45. X",
                "Điều 46. X",
            ]
        ),
        full_text_reviewed_locators=[
            "art-3::cl-9",
            "art-4::cl-7",
            "art-12::cl-6",
            "art-34::cl-2::pt-đ",
            "art-41",
            "art-42",
            "art-43",
            "art-44",
            "art-45",
        ],
    )
    add_article_33_review_assertions(tmp_path)
    law_71_review_path = tmp_path / f"{module.LAW_71}.hierarchy-review.json"
    review = json.loads(law_71_review_path.read_text(encoding="utf-8"))
    review["repealReview"]["repealedLocators"] = ["art-3::cl-9"]
    law_71_review_path.write_text(json.dumps(review), encoding="utf-8")

    with pytest.raises(RuntimeError, match="mutually confirmed"):
        module.build_payload([law_134, law_71], "DRAFT-1")


def test_source_manifest_can_use_external_reviewed_dir(tmp_path: Path):
    reviewed_dir = tmp_path / "reviewed"
    reviewed_dir.mkdir()
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    manifest = reviewed_manifest(
        reviewed_dir,
        "LAW-TEST",
        "Điều 1. Test\n1. Nội dung\n",
    )
    manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
    manifest_data.pop("reviewedTextFile")
    manifest_data.pop("hierarchyReviewFile")
    # Discovery/source manifest hashes may represent an HTML/DOCX fetch; publication
    # provenance is intentionally rebound to the source snapshot reviewed by the gate.
    manifest_data["sourceSha256"] = "sha256:" + "0" * 64
    external_manifest = source_dir / manifest.name
    external_manifest.write_text(json.dumps(manifest_data), encoding="utf-8")

    payload = module.build_payload(
        [external_manifest],
        "DRAFT-1",
        reviewed_dir=reviewed_dir,
    )
    document = payload["documents"][0]
    review = json.loads(
        (reviewed_dir / "LAW-TEST.hierarchy-review.json").read_text(encoding="utf-8")
    )
    assert document["sourceSha256"] == review["reviewedSourceSha256"]


def test_missing_reviewed_pdf_falls_back_to_verified_manifest_source_file(
    tmp_path: Path,
) -> None:
    manifest = reviewed_manifest(tmp_path, "LAW-TEST", "Điều 1. Test\n1. Nội dung\n")
    source_path = tmp_path / "LAW-TEST.source.html"
    source_path.write_text("<html>official source</html>", encoding="utf-8")
    manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
    manifest_data.pop("sourceSha256")
    manifest_data["htmlFile"] = source_path.name
    manifest_data["htmlSha256"] = module.file_sha256(source_path)
    manifest.write_text(json.dumps(manifest_data), encoding="utf-8")
    (tmp_path / "LAW-TEST.pdf").unlink()

    payload = module.build_payload([manifest], "DRAFT-1")

    document = payload["documents"][0]
    artifact = payload["sourceManifest"]["sourceArtifacts"][0]
    assert document["sourceSha256"] == module.file_sha256(source_path)
    assert document["snapshotPath"] == str(source_path.resolve())
    assert artifact["declaredReviewedSourceSha256"].startswith("sha256:")
    assert artifact["sourceSnapshotFallback"] == {
        "reason": "REVIEWED_SOURCE_SNAPSHOT_NOT_PRESENT",
        "declaredSnapshotPath": "LAW-TEST.pdf",
        "manifestArtifactPath": source_path.name,
    }


def test_duplicate_real_locator_fails_closed():
    text = "Điều 9. First\n1. A\nĐiều 9. Duplicate\n1. B\n"
    with pytest.raises(RuntimeError, match="duplicate legal locator art-9"):
        module.parse_chunks("LAW-TEST", text)

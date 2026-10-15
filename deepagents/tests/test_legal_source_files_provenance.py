from __future__ import annotations

import hashlib
from pathlib import Path

from rule_set_preparation.legal_source_files import INDEX_PATH, materialize_legal_source


def test_unknown_legal_status_source_ref_remains_null_in_index(tmp_path: Path) -> None:
    content = "Synthetic source provision."
    content_sha256 = hashlib.sha256(content.encode("utf-8")).hexdigest()
    paths = materialize_legal_source(
        {
            "legalSourceVersion": "SYNTHETIC-LEGAL-V1",
            "legalSourceVersionId": "synthetic-version-id",
            "documents": [
                {
                    "documentId": "DOC-1",
                    "sourceEffectStatus": "UNKNOWN",
                    "chunks": [
                        {
                            "locator": "art-1",
                            "content": content,
                            "contentSha256": content_sha256,
                            "legalEffectStatus": "UNKNOWN",
                            "legalStatusSourceRef": None,
                            "hierarchy": {},
                        }
                    ],
                }
            ],
        },
        tmp_path,
    )

    chunk = (tmp_path / paths[1].lstrip("/")).read_text(encoding="utf-8")
    index = (tmp_path / INDEX_PATH.lstrip("/")).read_text(encoding="utf-8")

    assert "legalStatusSourceRef: null" in chunk
    assert (
        f"| DOC-1 | art-1 | {content_sha256} | UNKNOWN | null | {paths[1]} |"
        in index
    )

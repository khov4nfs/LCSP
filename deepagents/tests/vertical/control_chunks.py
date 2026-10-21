"""Print an unfamiliar semantic-control source as legal_source chunks (real extraction + chunking + hashes).

usage: control_chunks.py <control-id>   (source: tests/fixtures/semantic-control/<control-id>.txt)
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "deepagents"))

from tools.legal.managed_documents.ingest import ingest_document  # noqa: E402


def main() -> None:
    control = sys.argv[1]
    data = (ROOT / "tests" / "fixtures" / "semantic-control" / f"{control}.txt").read_bytes()
    result = ingest_document(data=data, media_type="text/plain", structure_profile="AUTO", attempt=1)
    if result["outcome"] != "READY":
        raise SystemExit(f"control ingestion {result['outcome']} {result.get('failureCode')}")
    print(json.dumps({
        "documentId": control,
        "sourceSha256": hashlib.sha256(data).hexdigest(),
        "chunks": [
            {"locator": c["locator"], "content": c["content"], "contentSha256": c["contentSha256"], "hierarchy": c.get("hierarchy", {})}
            for c in result["chunks"]
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

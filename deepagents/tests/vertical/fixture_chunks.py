"""Print the pinned synthetic V1 fixture as legal_source chunks (real text + real hashes)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

FIXTURE_DIR = Path(__file__).parents[1] / "fixtures" / "compliance_rule_set_context"
PARSER = Path(__file__).parents[2] / "tools" / "legal" / "sources" / "scripts" / "build_reviewed_legal_source.py"


def main() -> None:
    spec = importlib.util.spec_from_file_location("legal_source_parser", PARSER)
    parser = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parser)
    pins = json.loads((FIXTURE_DIR / "pins.json").read_text(encoding="utf-8"))
    pin = next(s for s in pins["sources"] if s["legalSourceVersion"] == "SYNTHETIC-LEGAL_SOURCE-V1")
    text = (FIXTURE_DIR / pin["sourceFile"]).read_text(encoding="utf-8")
    chunks = parser.parse_chunks(pin["documentId"], text)
    print(json.dumps({
        "documentId": pin["documentId"],
        "sourceSha256": pin["sourceSha256"].removeprefix("sha256:"),
        "chunks": [
            {"locator": c["locator"], "content": c["content"], "contentSha256": c["contentSha256"],
             "hierarchy": c.get("hierarchy", {})}
            for c in chunks
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

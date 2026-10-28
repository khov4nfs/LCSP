"""Pinned fixture ingestion must reject a source-byte change before seeding."""
import json

import pytest

from vertical import fixture_chunks


def test_pinned_fixture_rejects_source_bytes_that_do_not_match_its_pin(tmp_path, monkeypatch):
    pins = json.loads((fixture_chunks.FIXTURE_DIR / "pins.json").read_text())
    pin = next(source for source in pins["sources"] if source["legalSourceVersion"] == "SYNTHETIC-LEGAL_SOURCE-V1")
    (tmp_path / "pins.json").write_text(json.dumps(pins))
    (tmp_path / pin["sourceFile"]).write_bytes(b"different original document bytes")
    monkeypatch.setattr(fixture_chunks, "FIXTURE_DIR", tmp_path)

    with pytest.raises(ValueError, match="Pinned source SHA-256 does not match"):
        fixture_chunks.main()

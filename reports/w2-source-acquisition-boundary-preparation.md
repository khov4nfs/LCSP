# W2 official legal-source acquisition boundary preparation

Status: **PASS — offline preparation only.** This adds executable boundary tests without changing production acquisition, API, persistence, parser, lifecycle, or legal-agent evaluation code.

## Current seam confirmed

The owned test follows the current path:

`LegalSourceIngestBoundary.handle` (`deepagents/tools/legal/sources/ingest/legal_source_ingest_boundary.py:72-109`) → canonical dispatcher entrypoint (`deepagents/tools/common/capabilities/agentic_evidence/entrypoints/legal_tool_entrypoints.py:64-97`) → `OfficialSourceSnapshotFetcher.fetch` (`deepagents/tools/legal/sources/ingest/official_source_snapshot.py:168-250`). The recovery payload then consumes the crawler manifest through `_build_official_source_payload` (`deepagents/tools/legal/sources/recovery/legal_corpus_recovery_driver.py:584-667`), including deterministic chunk hierarchy and source-artifact hashes.

## Test boundary

`deepagents/tests/test_legal_source_acquisition_boundary_preparation.py` uses a fake VBPL HTTP session, fake registry API, temporary storage, and synthetic gateway bytes while executing the actual fetcher, dispatcher adapter, ingest boundary, and recovery payload builder.

- Identity/hash/provenance: exact document/catalog/source URLs, document number, source and HTML SHA-256 values, byte length, content-addressed object key, snapshot ref, provenance ref, and registered identity flag.
- Hierarchy/locators: exact `art-*`, `::cl-*`, and `::pt-*` locators; corpus-version namespaced IDs; article/chapter metadata; parent chunk IDs; source-manifest and text-artifact hashes.
- Failure/no fallback: observed document-number drift remains explicit as `documentIdentityVerified=False`; malformed upstream content raises before output creation rather than inventing a source artifact.

## Verification

- `rtk .venv/bin/python -m pytest tests/test_legal_source_acquisition_boundary_preparation.py tests/test_official_source_snapshot.py tests/test_legal_source_ingest_consumer.py -q` — exit `0`; 13 tests passed.
- `rtk .venv/bin/python -m compileall -q tests/test_legal_source_acquisition_boundary_preparation.py` — exit `0`.
- `rtk git diff --check` — exit `0`.
- Only the owned new test and this report were added; no accepted corpus/parser or legal-preparation evaluation fixture was changed.

## Non-claims and bounded limitation

All network, provider, API, database, activation, production, and browser behavior remains **NOT_PROVEN**. The test intentionally records the current Python helper's mismatch behavior (`False`) and does not claim that the downstream API rejects that payload; future W2 work can retain the seam and add server-side rejection tests once that contract is frozen. The hierarchy assertions verify deterministic structure/lineage only, not legal interpretation or semantic-agent quality.

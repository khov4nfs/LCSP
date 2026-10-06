# W2 official-source payload refactor

Status: **PASS — preparatory source-boundary refactor only.** This moves the
existing deterministic official-source payload construction out of the
assessment-linked recovery driver without implementing the later W2 portfolio
or agent semantics.

## Caller and helper trace

The project was already indexed in codebase-memory MCP. `trace_path` for the
old `LegalCorpusRecoveryDriver._build_official_source_payload` found two direct
callers: `_run_locked` and
`test_recovery_payload_keeps_exact_hierarchy_locators_and_artifact_lineage`.
The transitive callers (`run`, recovery boundary, rule-source recovery, and
catalog maintenance) remain on the legacy recovery orchestration path and were
not rewired.

Helper search found `_source_artifact` and `_namespace_chunks` were builder-only;
`_source_text_path` also served `_corpus_version`; `required_manifest_string`
served partial-update manifest preparation; and `_safe_ref` served recovery
references. Those pure helpers moved with the new payload module where needed;
the driver imports only the helpers it still owns through existing recovery
paths.

## Source change

- Added `deepagents/tools/legal/sources/ingest/official_source_payload.py` with
  the sole payload-builder callable `build_official_source_payload(...)` and the moved parser,
  hash, path, duplicate-document, namespace, and manifest-validation mechanics.
- Updated `_run_locked` to call that function directly.
- Updated the acquisition-boundary test to call the independent function
  directly, removing the old driver-instance method call.
- Removed `_build_official_source_payload` and its old driver-local payload
  helpers. Recovery scheduling, activation, rule recovery, resume behavior,
  parser scripts, fixtures, API contracts, and lifecycle code were unchanged.

The builder preserves the existing `reviewRequired`, trust policy, document
fields, source/text artifact hashes, parser output filtering, hierarchy and
locator namespace, effective-date selection, partial-update default, duplicate
document guard, empty-chunk failure, manifest-field failures, and source-artifact
failure behavior.

## Exact diff accounting

- `legal_corpus_recovery_driver.py`: `8` additions, `174` deletions in the
  tracked diff; the old 89-line method and related local helpers are removed.
- `official_source_payload.py`: new 181-line source module containing the
  extracted implementation and only the required pure helpers.
- `test_legal_source_acquisition_boundary_preparation.py`: the existing direct
  recovery-method call is replaced by the new function import/call.
- `w2-official-source-payload-refactor.md`: this report.

## Verification

- `rtk .venv/bin/python -m compileall -q tools/legal/sources/ingest/official_source_payload.py tools/legal/sources/recovery/legal_corpus_recovery_driver.py tests/test_legal_source_acquisition_boundary_preparation.py tests/test_legal_corpus_recovery_driver.py` — exit `0`.
- `rtk .venv/bin/python -c 'from tools.legal.sources.ingest.official_source_payload import build_official_source_payload; from tools.legal.sources.recovery.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver; assert callable(build_official_source_payload); assert not hasattr(LegalCorpusRecoveryDriver, "_build_official_source_payload")'` — exit `0`.
- `rtk .venv/bin/python -m pytest tests/test_legal_source_acquisition_boundary_preparation.py tests/test_official_source_snapshot.py tests/test_legal_source_ingest_consumer.py -q` — exit `0`; **13 passed**.
- `rtk .venv/bin/python -m pytest tests/test_legal_corpus_recovery_driver.py -q` — exit `0`; **10 passed**.
- `rtk git diff --check` — exit `0`.
- `rtk graphify update .` — exit `0`; refreshed the ignored graph artifacts and indexed the new function. Graphify reported the pre-existing repository conditions of 96 SQL files skipped because `tree_sitter_sql` is unavailable and one existing TypeScript syntax-error file; neither is in this change.
- Final source scan over the production/test source paths found one live
  `build_official_source_payload` definition and two live callers (driver and
  acquisition test), with no old-method code references. Pre-existing reports
  retain historical old-name references, and this report names the removed
  method only to document the boundary.

## Limitations and non-claims

This is not W2 acceptance and does not claim portfolio construction, agent
semantics, API/database/provider/network behavior, activation correctness, or
browser proof. No full repository test suite, remote CI, commit, push, or PR was
run or created.

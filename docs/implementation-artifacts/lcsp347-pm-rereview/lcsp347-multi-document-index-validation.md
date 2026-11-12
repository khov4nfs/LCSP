# DATA-04 multi-document index validation

**Status: NOT RUN.** No Legal Source Version or documents were created in DATA-04 because the provider-free Agent Server boundary could not be established.

The disposable database `lcsp_data04_corpus` was empty of source and Rule Set data before the intended corpus work. No ingestion event reached `/lcsp-data04`; no index was built. Therefore full-corpus index identity, document membership, content hash, validation manifest, chunk ownership, locator uniqueness, and whether later document ingestion invalidates a prior index are all `NOT_PROVEN`.

The earlier DATA-03.3 Law 134 result (265 chunks and a VALID index on a separate single-document DRAFT) is not evidence of seven-document index coverage.

Before the next corpus run, inspect the canonical `LegalRetrievalIndex` lifecycle and ensure validation is performed after all seven documents reach their terminal technical state. The final validation receipt must bind all seven document IDs/source hashes and must not reuse a single-document `VALID` index.

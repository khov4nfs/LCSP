# LCSP-347 DATA-04.1: persisted index validation

## Result

`FULL_SET_PERSISTED_INDEX: NOT_RUN`. No Legal Source or DRAFT was created, no document was persisted, and no source-level index lifecycle was invoked because the approved provider-free Agent Server preflight did not pass. There is no persisted index ID, database membership set, index digest, or full-set completeness claim.

## Offline checks completed

The configured `AUTO` profile pipeline was run independently on each verified original. It produced 2,381 in-memory chunks total. For every file, the original hash matched its expected value, chunk hashes recomputed, normalized non-whitespace source-to-chunk text matched exactly, and locators were unique within that document after suffix handling. Per-file receipts are in `lcsp347-seven-document-corpus.receipt.json`.

This does not establish persisted document ownership or a combined retrieval index. Separate offline extraction calls do not substitute for the canonical source-level index lifecycle.

## Next index acceptance criteria

After the runtime gate is authorized and seven documents are ingested into one DRAFT:

1. Read canonical source membership after the seventh terminal document result.
2. Run the supported full-source index lifecycle; do not reuse an index from a partial document set.
3. Verify the index source version ID equals the one DRAFT ID and membership contains seven distinct document IDs and expected hashes.
4. Verify every chunk references exactly one member document, hashes recompute, and locator uniqueness is scoped to document identity.
5. Verify no failed or pending document is silently omitted from a claimed complete index.
6. Independently read back the committed index state, digest, and membership.
7. Confirm the source remains DRAFT, with zero activations, Preparation runs, Assessments, and model usage.

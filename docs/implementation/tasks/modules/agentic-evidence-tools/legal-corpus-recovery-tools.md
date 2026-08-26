# Admin-Managed Legal Corpus Recovery Tool Tasks

Status: DELIVERED  
Stories: AO-3 — Missing-Input Orchestration; AO-6 — Legal Corpus Recovery  
Template: `agentic-tool-implementation-task-template.md`

| Task ID / tool | Implementation instruction | Typed result and safety boundary | Required verification |
|---|---|---|---|
| `TASK-AO-6-01-get-admin-source-catalog` / `get_admin_source_catalog` | Resolve source strictly by admin catalog document/source identity. | Catalog source ref only; arbitrary URL denied. | Unknown source/SSRF boundary. |
| `TASK-AO-6-02-fetch-official-source-snapshot` / `fetch_official_source_snapshot` | Fetch allow-listed official source with host/DNS/redirect/size/type controls; hash immutable snapshot. | Snapshot hash/provenance or blocked diagnostic. | Redirect/DNS/content-type/timeout failure. |
| `TASK-AO-6-03-extract-official-text` / `extract_official_text` | Prefer canonical HTML/DOCX extractor and record page/span/source hashes. | Extracted refs/provenance, not unbounded raw document. | HTML/DOCX fixtures and malformed extraction. |
| `TASK-AO-6-04-run-ocr-fallback` / `run_ocr_fallback` | Invoke OCR only after canonical extraction is unavailable; page-hash output. | OCR refs/limitations only. | Fallback precondition, missing page, no silent OCR use. |
| `TASK-AO-6-05-evaluate-ocr-quality` / `evaluate_ocr_quality` | Detect page/text/numbering/identity/hierarchy anomalies. | Quality gate finding/refs. | Low confidence and missing-page block. |
| `TASK-AO-6-06-build-reviewed-corpus-input` / `build_reviewed_corpus_input` | Build deterministic correction/review artifact from extraction findings. | Immutable input/ref; no manual source approval step. | Hash binding and invalid correction block. |
| `TASK-AO-6-07-build-legal-chunks` / `build_legal_chunks` | Create stable article/clause/point IDs with hierarchy/xref/citation metadata. | Versioned chunks/hashes. | Duplicate/missing hierarchy and stable IDs. |
| `TASK-AO-6-08-validate-chunk-integrity` / `validate_chunk_integrity` | Validate hashes, locators, relationships, repeal mapping, duplicates/missing chunks. | Deterministic pass/fail manifest. | Each integrity failure blocks activation. |
| `TASK-AO-6-09-build-legal-retrieval-index` / `build_legal_retrieval_index` | Build pinned structure-first ChromaDB index from validated chunks. | Index version/provenance. | Idempotent rebuild and failed-index boundary. |
| `TASK-AO-6-10-validate-retrieval-index` / `validate_retrieval_index` | Verify stable chunk IDs and required context roles are retrievable. | Validation manifest/ref. | Missing parent/xref retrieval block. |
| `TASK-AO-6-11-activate-validated-corpus-version` / `activate_validated_corpus_version` | Atomically activate only fully validated immutable version and write audit/outbox. | Active corpus ref/event; LLM cannot activate. | Transaction failure, audit/outbox, no partial activation. |
| `TASK-AO-6-12-resume-waiting-runs` / `resume_waiting_runs` | Resume only runs blocked on the activated exact corpus version with idempotency/checkpoint. | Resume audit/state refs. | Duplicate resume and unrelated-run exclusion. |

## Definition of Done

- Catalog membership replaces manual source approval only; all provenance, integrity, effect-status, chunk, index, and audit gates remain mandatory.
- Failure leaves the candidate version inactive and produces a safe `BLOCKED`/resolver-compatible diagnostic.

## Executable Tool Packets

All packets inherit [shared-tool-contract.md](shared-tool-contract.md). `legal-corpus-source-spec.md` is authoritative: for an admin-catalog source, passing automated validation activates the immutable candidate without manual source approval. Older Internal Legal Operator sign-off semantics are superseded here, while every hash, identity, effect-status, hierarchy, chunk, index, audit, and outbox gate remains mandatory.

| Tool | Input → output | Execution and LLM context | Failure, seams, tests |
|---|---|---|---|
| `get_admin_source_catalog` | document identity or catalog ID → catalog source/document ref and allowed host/path policy | Resolve only admin catalog; no URL field. System/orchestrator only; LLM sees identity/ref. | Unknown/wrong identity/URL param denied. Catalog repo/contracts; test SSRF boundary/RBAC. |
| `fetch_official_source_snapshot` | catalog ref, expected identity, fetch budget → immutable snapshot ref, final URL metadata, SHA-256 | HTTPS fetch with host/DNS/IP/redirect revalidation, type/size/timeout limits; immutable object storage. No LLM content. | Private-IP/redirect/type/size/timeout/hash failure blocks. Fetch adapter; test changed hash creates new candidate. |
| `extract_official_text` | snapshot ref + budget → normalized page/span refs, extraction provenance, identity/date/effect candidates | Prefer HTML/DOCX; sanitize markup and preserve locator/hash. LLM receives bounded span only after quality gate. | Malformed/identity failure blocks. Extraction worker; test HTML/DOCX and hash binding. |
| `run_ocr_fallback` | snapshot/page refs plus canonical-extraction-unavailable proof → page/span refs, hashes, confidence/limits | Precondition gate, bounded page render/OCR, retain ordering/map. System only; no full OCR document to LLM. | Canonical success forbids call; timeout/missing page limits. OCR worker; test precondition/hashes. |
| `evaluate_ocr_quality` | extraction/OCR refs + expected markers → quality manifest/findings | Check continuity/confidence/numbering/identity/hierarchy/hash anomalies. Deterministic-only. | Low confidence/missing/reordered/identifier mismatch blocks. Validator; test each. |
| `build_reviewed_corpus_input` | refs/findings + correction policy/version → immutable normalized ref or block | Hash-bind inputs; apply deterministic permitted corrections only; no human/LLM approval or correction. | Changed hash/unsupported correction/failed quality blocks. Builder; test repeat determinism. |
| `build_legal_chunks` | reviewed input + identity/relationship refs + chunk version → chunks/hierarchy/xref/citation hashes | Parse chapter/article/clause/point; clause base, parent context, locator repeal mapping. LLM sees stable IDs/metadata only. | Duplicate/missing parent/repeal target failure. Chunker; test rerun stable IDs/no intra-clause split. |
| `validate_chunk_integrity` | candidate + chunk/relationship refs → immutable validation manifest | Validate hashes/hierarchy/locators/xrefs/duplicates/effect/repeal consistency. Deterministic gate. | Any invariant incl. effect conflict blocks activation. Validator; test each invariant. |
| `build_legal_retrieval_index` | validated manifest + index config/version → index ref/checksum/provenance | Idempotent version-scoped Chroma structure-first collection; no dense embeddings/pgvector. Worker-only. | Partial/invalid build never READY. Retriever indexer; test isolation/idempotency. |
| `validate_retrieval_index` | index/corpus refs + probe set → validation manifest | Exact plus structure-first probes for primary/parent/one-hop context and status filters. Deterministic-only. | Missing parent/xref/repealed leakage/wrong collection block. Validation harness; test each. |
| `activate_validated_corpus_version` | candidate + passing manifests + idempotency/correlation → active immutable ref + audit/outbox ref | One transaction verifies manifests/index then activate/supersede as policy and atomically emits audit/outbox. Not LLM-callable. | Any missing manifest/transaction/outbox failure prevents partial activation. API service/outbox; test rollback/duplicate. |
| `resume_waiting_runs` | activation event/ref + resume budget → resumed run/checkpoint/audit refs | Select only blocked/waiting runs requiring exact compatible corpus version; lock/idempotency and enqueue checkpoint continuation. Not LLM-selectable. | Duplicate/unrelated/stale checkpoint are safe no-op/block/retry policy. Resume worker/outbox; test each and DLQ. |

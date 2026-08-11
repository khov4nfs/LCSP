# Story AO-6: Automate Admin-Managed Legal Corpus Recovery

Status: ready-for-dev

Jira: [LCSP-163 — Legal Corpus Recovery](https://minhpnq1807.atlassian.net/browse/LCSP-163)

## Story

As the legal-corpus workflow,
I want to recover and validate missing legal evidence from admin-managed official sources,
so that retrieval remains authoritative and resumable without individual approval.

## Acceptance Criteria

1. Recovery accesses only sources in the admin-managed official source catalog; no individual approval step is required.
2. It prefers HTML/DOCX extraction, uses OCR only as fallback, and records immutable page/span hashes and extraction provenance.
3. It builds hierarchy and citation chunks, validates integrity, indexes/retrieves them, and validates policy compatibility.
4. A passing recovery activates a new corpus version with audit/outbox events and can resume waits; a failure reaches `BLOCKED` with safe diagnostics.

## Tasks / Subtasks

- [ ] Implement catalog-bound source selection, safe fetch/extract flow, preferred HTML/DOCX extraction, and OCR fallback with provenance. (AC: 1, 2)
- [ ] Persist immutable source/page/span references, build hierarchical citation chunks, re-index, and validate integrity/retrieval/policy compatibility. (AC: 2, 3)
- [ ] Implement activation, audit/outbox, checkpoint-resume, and blocked diagnostic flows; add extractor/OCR/integrity/activation/failure tests. (AC: 3, 4)

## Dev Notes

- Official execution artifact: `docs/implementation-artifacts/ao-6-automate-admin-managed-legal-corpus-recovery.md`.
- The admin-managed official source catalog is the authorization boundary. Do not add per-document approval, arbitrary URLs, user-uploaded sources, or bypasses around catalog policy.
- This story follows the newer automated validation/activation rule in `legal-corpus-source-spec.md`: catalog membership removes manual source approval, but never removes extraction, integrity, hierarchy, effect-status, chunk, index, or audit gates.
- Persist source identity, content/page/span hashes, hierarchy IDs, extraction/OCR/tool provenance, validation outcome, and corpus version. Avoid treating OCR text as unverified just because it was recovered; it must still pass integrity/policy gates.
- HTML/DOCX is preferred. OCR is a bounded recovery action with page-level diagnostics and may produce `NEEDS_INPUT`/`BLOCKED` through AO-3 when confidence or integrity is inadequate.
- Activation is atomic at the corpus-version boundary: a partially indexed or validation-failed corpus can never become the active retrieval source.

### Tool Catalog Coverage

- Recovery sequence: `get_admin_source_catalog` → `fetch_official_source_snapshot` → `extract_official_text` → `run_ocr_fallback` only when canonical extraction is unavailable → `evaluate_ocr_quality` → `build_reviewed_corpus_input`.
- Version validation/activation sequence: `build_legal_chunks` → `validate_chunk_integrity` → `build_legal_retrieval_index` → `validate_retrieval_index` → `activate_validated_corpus_version` → `resume_waiting_runs`.
- A failed tool, validation gate, or retry budget must produce the catalog's safe blocked diagnostic; activation and resume never run for a partial chain.
- Per-tool implementation tasks: `docs/implementation/tasks/modules/agentic-evidence-tools/legal-corpus-recovery-tools.md`.

### Expected Files

- `apps/api/src/modules/legal-corpus/*`
- `lcsp-python-workers/src/lcsp_workers/legal_corpus/*` or the existing ingestion worker modules
- `packages/contracts/src/*` for source, extraction, corpus-version, and recovery events
- legal corpus integration fixtures/tests including OCR fallback

### Verification Requirements

- Test catalog allow-list enforcement, HTML/DOCX preference, OCR fallback, immutable hashes/provenance, hierarchy/citation chunk integrity, and retrieval validation.
- Test both successful atomic activation/audit/outbox and safe blocked diagnostics/checkpoint resume.
- Confirm no user approval is requested for a catalog-authorized official source.

### References

- [Source: docs/specs/legal-corpus-source-spec.md]
- [Source: docs/implementation/legal-corpus-ingestion-implementation.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/SPEC.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/orchestration-state-machine.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md]
- [Source: docs/specs/domain-state-machines.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Completion Notes List

- Created from the LCSP-163 Jira Story and the admin-managed legal-corpus recovery specification.

### File List

- docs/implementation-artifacts/ao-6-automate-admin-managed-legal-corpus-recovery.md

## Change Log

- 2026-08-11: Created AO-6 execution artifact.

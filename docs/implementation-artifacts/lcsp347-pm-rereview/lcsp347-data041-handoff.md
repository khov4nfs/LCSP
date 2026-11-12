# LCSP-347 DATA-04.1 handoff

## Baseline

- Repository: `khov4nfs/LCSP`
- PR #456: OPEN / Draft
- Branch: `feat/LCSP-347-assessment-prompt-locales`
- Initial/current remote HEAD at investigation start: `ef03311a79635307c66bf61e40724ba075421042`
- DATA-04 retry-boundary changes remain present; remote was an ancestor of the local HEAD.
- Historical handoffs, diagnostic scripts, raw source files, and screenshots were preserved.

## Root cause and fix

Graph construction creates the root model before the system-event hook can dispatch a task. The managed-document event does jump to the end before the model turn, as shown by a new deterministic in-process graph test with an injected fake model. A real Agent Server still requires a supported model client at startup. The previous local-only launch was rejected at command execution authorization; exact refusal text/subcode was not retained. No alternate launcher was attempted.

No production routing or execution policy was changed. The approved provider-free runtime remains unestablished, so live ingestion was not started. Permitted offline extraction and chunk-quality checks were completed for all seven retained original DOCX files.

## Offline result

All seven original hashes and byte lengths match the DATA-04 manifest. The current managed extractor/chunker returned offline technical `READY` for 7/7, with 2,381 chunks total, no explicit extraction gaps, no Unicode replacement characters, recomputed chunk hashes, unique per-document locators after suffix handling, and exact non-whitespace source-to-chunk partition parity.

Article-number restarts were detected in Decree 142 and Decree 356. Duplicate locator suffixes were detected in Decree 142, Circular 05, Decision 1671, and Decree 356. These require structural review against the originals; no legal interpretation or locator correction was made. No raw document text is included in new evidence files.

Offline technical `READY` is not persisted API `READY`, a source-level index, legal completeness, or legal approval. All seven require independent legal review. Laws 71 and 91 remain outside this supported DOCX wave because their retained originals are legacy DOC.

## Readiness

| Gate | Status |
|---|---|
| DATA-04 retry-boundary isolation | PASS, published |
| Provider-free graph dispatch mechanics | PARTIAL, deterministic fake-model graph test |
| Authorized real Agent Server and blocked provider egress | BLOCKED_BY_EXECUTION_POLICY / NOT_PROVEN |
| Seven original DOCX hashes | PASS, 7/7 |
| Offline extraction and chunking | PASS, 7/7 technical output; locator review remains |
| Authenticated HTTP import and real worker | NOT_RUN |
| Seven persisted documents in one DRAFT | NOT_RUN; no source/DRAFT created |
| Full-set persisted retrieval index | NOT_RUN |
| Legal effect, applicability, role, semantic fidelity | REQUIRES_REVIEW, 0/7 approved |
| Activation, Preparation, Assessment, paid model calls | NOT_RUN; none occurred |

## Operator action and next step

An authorized runtime operator must permit the normal Agent Server entrypoint under an isolated local-only model transport with verified provider egress denial, or provide a sanctioned provider-free Agent Server integration harness. Verify the instantiated client/fallback graph and network guard first. Only then revalidate the disposable database and `/lcsp-data04`, create one managed source and one DRAFT through the authenticated Admin API, and process the seven originals sequentially through outbox, broker, Agent Server, worker, callback, and complete-set indexing. Keep the DRAFT unactivated.

## Evidence files

- `lcsp347-provider-free-runtime-verification.md` and `.receipt.json`
- `lcsp347-seven-document-corpus-ingestion.md` and `.receipt.json`
- `lcsp347-full-corpus-index-validation.md`
- `lcsp347-retry-authority-review.md` (DATA-04)

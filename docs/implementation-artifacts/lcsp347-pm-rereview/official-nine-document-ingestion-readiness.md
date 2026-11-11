# Official nine-document ingestion readiness (DATA-03.4)

Scope: technical intake readiness only. This is not legal approval, source-effect validation, corpus approval, or activation authorization. Historical LCSP-360 v1/v4 equivalence remains NOT_PROVEN. Existing original binaries remain in the local ignored evidence directory; no source binary is included in this report.

All nine original files were rehashed on 2026-11-12 from paths recorded in the local unreviewed manifest. Every current hash matched its manifest entry. Hashes identify the obtained bytes; no independent publisher digest was available. Human legal-effect/applicability and corpus-role review is pending for all nine.

| Instrument | Retained original format | SHA-256 | Technical intake status | Review / caveat |
|---|---|---|---|---|
| Law 134/2025/QH15 | DOCX | `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7` | One source completed authenticated HTTP upload and URL-import worker paths in DATA-03.3; READY/index VALID in three DRAFT test versions. | Extraction observed 35 article headings and no parser gaps; complete source comparison NOT_PROVEN. |
| Law 71/2025/QH15 | legacy DOC | `a6c820bdf0d38acc804ee4ca720e5b570746cd210df194949e3d7c2c67bd088c` | BLOCKED for current DOCX importer; no ingestion. | Do not rename to DOCX. Obtain supported official representation or documented, reviewed conversion path. |
| Decree 142/2026/NĐ-CP | DOCX | `110928d40055ca86d7278785f9c44aa165ab70bdf82013e8da677a1edc864000` | Supported format; original rehash matches; technical ingestion NOT_RUN. | Effect, amendments, completeness and role require review. |
| Decision 33/2026/QĐ-TTg | DOCX | `a0e042c90787edf7ef08a35ba7905e6d65758772ba0fd19bbcf31d201464297a` | Supported format; original rehash matches; technical ingestion NOT_RUN. | Effect, amendments, completeness and role require review. |
| Circular 05/2026/TT-BKHCN | DOCX | `299dc939784b39450f17492b8799e3776c9f56cfae4e832f14e3836e23a76a66` | Supported format; original rehash matches; technical ingestion NOT_RUN. | Binding applicability is unreviewed. |
| Decision 1671/QĐ-TTg | DOCX | `d6dcdb889cccf2c1f6beaa331a1399662241b89377ba9cd7f45344e507908b21` | Supported format; original rehash matches; technical ingestion NOT_RUN. | Potentially contextual/reference-only; do not infer role from title. |
| Law 91/2025/QH15 | legacy DOC | `0228aef1d7bb8d5ccbd8aff34a80afc988fc3b5f2ee82cbd334b28d3be6413ba` | BLOCKED for current DOCX importer; no ingestion. | Separate 23-page OCR evidence has duplicate/out-of-order headings; OCR needs page-linked human review and is not accepted as legal text. |
| Decree 356/2025/NĐ-CP | DOCX | `c36a6740d034031abb2d4a3a0350b99dfe395a40f8bff1f9dd98502267f8c4de` | Supported format; original rehash matches; technical ingestion NOT_RUN. | Replacement/temporal relationship to Decree 13/2023 requires review. |
| Law 116/2025/QH15 | DOCX | `b3bb2ad8e013881361a7ae2325aecb660d55e41f48755ed590a6f23cb44d1150` | Supported format; original rehash matches; technical ingestion NOT_RUN. | Broader cybersecurity scope and role require review. |

## Import plan for a later stage

1. Obtain independent legal approval of scope, effective status, source role, amendments, and the complete nine-document candidate corpus. Keep uncertain items `UNKNOWN`/review-required.
2. Prepare a newly isolated disposable database and a dedicated RabbitMQ vhost. Do not reuse `/lcsp-data032` until its five residual messages are inspected and reconciled. `/lcsp-data034` is currently an empty vhost in the same disposable broker; no API queues/bindings have been declared there yet.
3. Establish one isolated API + outbox publisher, one Agent Server, one worker consumer, and exactly one queue prefix. Verify every process has the same disposable API/database/vhost/provider-free configuration before creating documents.
4. Import supported DOCX bytes through the authenticated Admin API; verify each original hash, ingestion attempt, extracted-text hash, chunk count/locators, and index state. Do not count multiple imports of Law 134 as distinct corpus coverage.
5. Resolve Law 71 and Law 91 through independently verified official supported-format originals where available. Otherwise preserve the legacy source bytes and use only an approved, traceable conversion/OCR path with source-to-derived hashes and human page/section review.
6. Inspect all Article/Clause/appendix coverage. READY/index VALID is technical processing evidence, not legal completeness or applicability approval.
7. Leave every Legal Source Version DRAFT. Activation, Preparation, Assessment, and paid execution require separate authorization and governed admission.

## Readiness summary

- Original bytes found and manifest hashes reverified: 9/9.
- Original publisher expected-hash matches: NOT_AVAILABLE.
- Supported original DOCX: 7/9; legacy DOC: 2/9.
- Full technical ingestion: 1 distinct document / 9; 134/2025/QH15.
- Complete text/structure review: 0/9 independently completed.
- Human legal approval: 0/9.
- Corpus import readiness: PARTIAL; seven DOCX are format-ready, but six remain un-ingested and both legacy DOCs need supported source representation/conversion decisions. Do not start corpus-wide intake until replay/recovery controls are exercised and the residual old-vhost messages have authorized disposition.


## DATA-03.5 update (2026-11-12)

The prior readiness assessment above is preserved as recorded. DATA-03.5 now demonstrates repeatable provider-free Law 134 ingestion through the isolated API, outbox, RabbitMQ, Python worker, Agent Server and callback path, including an API outage/recovery and a callback-commit/response-loss replay. Original bytes remained hash-identical; successful test documents reached READY with 265 unique chunks and VALID indexes, while a corrupt PDF failed with zero chunks/index. This remains technical ingestion evidence only.

The DATA-03.5 disposable vhost /lcsp-data034 is no longer empty: its one task queue prefix was declared and consumed during the completed reliability run. Managed-document queues ended with zero ready/unacknowledged messages and the temporary consumer was stopped. The old /lcsp-data032 messages were not accessed. Seven DOCX remain candidates for later batch import, two legacy DOC originals remain blocked pending supported representation/conversion, and legal-effect/corpus review remains pending. No source activation, Preparation, Assessment, or paid model invocation occurred. See legal-source-data035-broker-settlement.md and lcsp347-data035-handoff.md.

# LCSP-347 DATA-04.2 — Seven-document structural review

## Scope

This is an offline structural audit of the seven retained official Gazette DOCX files, using the DATA-04.1 source hashes and the repository's managed-document extractor/chunker v1.1.0 (`managed-document-ingest:docx-xml`, `AUTO` profile, resolved profile `ARTICLES`). The source bytes were read from `%TEMP%\lcsp347-data031-word`; no source file was changed. No legal-effect, applicability, corpus-role, or legal-approval decision is made here.

The source hashes and extracted text hashes below match the committed DATA-04.1 receipt. The structural checks re-ran extraction for the four documents with reported anomalies. Table statistics were measured directly from the DOCX body XML and compared with the extractor's `" | "` cell separator count. This verifies row/cell boundary counts at the text-stream level, not the semantics of column headers or merged cells.

## Root cause

The current `ARTICLES` profile models chapter, article, clause and point. It does not model an Annex/Form hierarchy. The chunker preserves repeated paths by appending `::dup-N`; that prevents a literal locator collision but does not recover the source-native annex, form, table, or nested-list path. Source XML confirms Annex/Form boundaries in the four flagged files. Decree 142 and Decree 356 also contain repeated list labels under the same parsed Article/Clause path. In Decision 1671, repeated point labels occur within Article 1 before Article 2; they are not explained by the later Annex I/II boundaries. Those cases remain ambiguous between legitimate nested list restarts and profile over-interpretation.

**Fix:** no extractor or source change was made. Although the locator limitation is confirmed, changing the profile without a reviewed citation hierarchy could assign incorrect legal paths. Keep affected files `STRUCTURE_REVIEW_REQUIRED` and require a reviewed Annex/Form/table locator design plus regression fixtures before using these locators for Rule Decision citations.

## Document-level matrix

| Instrument | Original SHA-256 | Source/XML structure | Offline output | Result |
|---|---|---|---|---|
| Law 134/2025/QH15 | `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7` | 8 chapters; Arts. 1–46 followed by Annex “Danh mục biểu mẫu”; form sections later restart at Điều 1 (DOCX body block 706; form article headings include blocks 1066, 1677, 1735). 2 tables, 2 rows, 4 cells, 2 separators; no merge markers. | 48,832 chars; 265 chunks; text SHA `6370b7cbb224af43601d2c5e94f21e2c566d5e956fcb40a0dd54db94a71eb4e9`; 0 duplicate locator suffixes. | **STRUCTURE_REVIEW_REQUIRED**. Annex citation hierarchy is not represented in the profile. |
| Decree 142/2026/NĐ-CP | `110928d40055ca86d7278785f9c44aa165ab70bdf82013e8da677a1edc864000` | 8 chapters; main text Arts. 1–46. Annex “Danh mục biểu mẫu” begins at body block 706; numbered form articles restart at Điều 1 in the forms. 37 tables, 105 rows, 365 cells, 1 empty row; 259 nonempty-row separators expected and observed; no merge markers. | 181,148 chars; 840 chunks; text SHA `b468b67eeea04fb016fb8d056f1b74732286728903dd7312f590148908ef2e98`; 19 repeated article identifiers; 163 `dup` occurrences across 50 base locator groups. | **STRUCTURE_REVIEW_REQUIRED**. Source-level form restarts are legitimate; individual repeated Article 5 list paths and annex-qualified citation locators remain unresolved. |
| Decision 33/2026/QĐ-TTg | `a0e042c90787edf7ef08a35ba7905e6d65758772ba0fd19bbcf31d201464297a` | 4 article headings; 3 tables, 57 rows, 259 cells; 7 grid-span markers; 202 nonempty-row separators expected and observed. | 22,437 chars; 19 chunks; text SHA `0d8f7245b9a282c1247801c7b08524452dc8ad2c06f1d23fb6d08323b4c62a26`; no duplicate suffixes. | **STRUCTURE_REVIEW_REQUIRED**. Row/cell boundary counts match; spanned-column semantics need review. |
| Circular 05/2026/TT-BKHCN | `299dc939784b39450f17492b8799e3776c9f56cfae4e832f14e3836e23a76a66` | Arts. 1–5; Annex I at body block 50 and Annex II at block 75. 3 tables, 22 rows, 101 cells; 79 separators expected and observed; no merge markers. | 12,879 chars; 53 chunks; text SHA `1d02f89e928f3265f2af94a1c70b38aae3759d785cd981749997292c76db5538`; 11 duplicate suffixes in 6 `art-5::cl-3::pt-*` groups. | **STRUCTURE_REVIEW_REQUIRED**. Repeated point labels coincide with appendix/form material, but the source hierarchy is not represented in the locator. |
| Decision 1671/QĐ-TTg | `d6dcdb889cccf2c1f6beaa331a1399662241b89377ba9cd7f45344e507908b21` | Arts. 1–3; Annex I at body block 362 and Annex II at 372. 4 tables, 156 rows, 888 cells; 19 grid-span markers; 732 separators expected and observed. 79 duplicate suffixes in 19 paths, principally Art. 1 clauses 6 and 9. | 103,017 chars; 191 chunks; text SHA `5e2c40b6e87a85434d323d99c2698d68a1eddbfe0eaee686cba968b46f4fa711`. | **STRUCTURE_REVIEW_REQUIRED**. Repeated point paths occur within source Article 1 before Article 2 (body block 298); later annexes do not explain them. Need determine whether these are nested list restarts or over-parsed headings. |
| Decree 356/2025/NĐ-CP | `c36a6740d034031abb2d4a3a0350b99dfe395a40f8bff1f9dd98502267f8c4de` | 5 chapters; main text Arts. 1–42; Annex begins at body block 472; certificate/form article headings restart at Điều 1 in blocks 732 and 813. 29 tables, 265 rows, 719 cells; 24 empty rows, 392 nonempty-row separators expected and observed; 407 grid-span markers and 10 vertical-merge markers. | 115,964 chars; 470 chunks; text SHA `632b7cf13ab907f45a91890ef32820aaa75a18cb0d150fccf51aa4121525ccee`; 6 repeated article identifiers and 29 duplicate suffixes across 16 base paths. | **STRUCTURE_REVIEW_REQUIRED**. Form numbering restart is source-supported; 9 duplicate point occurrences under Art. 42 clause 5 and annex-qualified locators need review. Merged/spanned table semantics are flattened. |
| Law 116/2025/QH15 | `b3bb2ad8e013881361a7ae2325aecb660d55e41f48755ed590a6f23cb44d1150` | 8 chapters; Arts. 1–45. 2 tables, 3 rows, 6 cells; 3 separators expected and observed; no merge markers. | 86,605 chars; 543 chunks; text SHA `48d7b4e886f6cb75bd61785fbb425cf92c43768dae3de9e1657a7f50f8bd7c09`; no duplicate suffixes. | **TECHNICALLY_VERIFIED** for offline partition/hash. |

`TECHNICALLY_VERIFIED` is limited to the recorded offline structural checks; it is not persisted ingestion, legal completeness, or human legal approval. Law 116 has no reported locator collision or unmodeled annex boundary in the inspected structure. The other six remain `STRUCTURE_REVIEW_REQUIRED` for locator hierarchy or table-structure reasons noted above.

## Duplicate locator review matrix

The machine-readable receipt lists every base locator group and its repeated occurrence count for the 4 flagged documents. `::dup-N` is generated by the chunker when a normalized structural path repeats; it does not mean a duplicate chunk was dropped. Chunk hashes in the DATA-04.1 receipt and normalized source-to-chunk parity were valid.

| Document / structural path | Original context reference | Duplicate/restart type | Expected citation hierarchy | Review result |
|---|---|---|---|---|
| Decree 142: repeated `art-1` through `art-7` paths, including `art-1::cl-*` | Annex “Danh mục biểu mẫu” at DOCX body block 706; form headings restart at Điều 1 in blocks 1066, 1677, 1735 | **Legitimate source numbering restart** within distinct forms; annex/form prefix missing from extracted locator | Annex → form identity → form article/clause/point | Source restart verified; locator ambiguity confirmed; exact form-to-chunk mapping requires review. |
| Decree 142: `art-5::cl-4::pt-{a,b,c,d}` and related repeated paths | Main Article 5 region; repeated path groups occur before Annex boundary; XML paragraph/article references are enumerated in receipt by hash/ref | Same article/clause/point path repeats; whether separate nested list/table scopes or extraction interpretation cannot be resolved from locator alone | Chapter II → Article 5 → actual clause/list/table path | **NOT_PROVEN**; inspect each source paragraph/table against document rendering. |
| Decree 356: `art-1`–`art-3` and descendants | Annex at body block 472; form headings restart at Điều 1 in blocks 732 and 813 | **Legitimate source numbering restart** in two forms; annex/form prefix missing | Annex → named form → article/field | Restart verified; exact named-form mapping needs review. |
| Decree 356: `art-42::cl-5::pt-a/b` | Main body, before Annex block 472; chunk ordinals in receipt | Repeated point labels in one parsed article/clause | Chapter V → Article 42 → clause 5 → source-native list/table scope | **NOT_PROVEN**; 9 repeated occurrences need paragraph/table context audit. |
| Circular 05: `art-5::cl-3::pt-a` through `pt-e` | Annex I at body block 50; Annex II at block 75; repeated chunks are in the appendix/form sequence | Reused checklist/form labels attached to the last parsed article | Annex II → form/checklist section → item | Likely source form-label reuse; source-native structure is not expressed by locator; review required. |
| Decision 1671: `art-1::cl-6::pt-*` and `art-1::cl-9::pt-*` | Article 1 begins body block 23; Article 2 begins block 298. Duplicate chunk ordinals 13–64 occur before Article 2. Annex I/II are later at blocks 362/372. | Repeated point labels under the Article 1 list structure; not explained by the later annex restart | Article 1 → clause 6/9 → source-native sublist/table path | **NOT_PROVEN**; determine whether distinct strategy actions legitimately restart lettering or `ARTICLES` over-parses list items. |

No duplicate locator is classified as a chunk identity collision: document identity remains a separate scope and `::dup-N` makes the string unique. Whether the locator is a sufficient legal citation is a different, unresolved question.

## Table and appendix review

| Instrument | Direct body tables / rows / cells | Row separator parity | Merge/span evidence | Finding |
|---|---:|---:|---|---|
| Law 134 | 2 / 2 / 4 | 2 expected; 2 extracted | none | Count-level pass; no separate rendered-content comparison. |
| Decree 142 | 37 / 105 / 365 | 259 expected for nonempty rows; 259 extracted | none | Row/cell boundary count matches. Appendix form identities and column/header semantics not encoded as locators. |
| Decision 33 | 3 / 57 / 259 | 202 / 202 | 7 grid-span markers | Row separators preserved; spanned columns need visual/source review. |
| Circular 05 | 3 / 22 / 101 | 79 / 79 | none | Row separators preserved; checklist semantics and Annex II hierarchy need review. |
| Decision 1671 | 4 / 156 / 888 | 732 / 732 | 19 grid-span markers | Row separators preserved; matrix header-to-cell meaning not retained as a typed table structure. |
| Decree 356 | 29 / 265 / 719 | 392 / 392 nonempty-row separators | 407 grid-span and 10 vertical-merge markers | Text/cell boundary count matches, but merged/spanned relationships are flattened. No semantic table fidelity claim. |
| Law 116 | 2 / 3 / 6 | 3 / 3 | none | Count-level pass; no separate rendered-content comparison. |

The extractor joins cells in a row with ` | `, which maintains an observable text boundary, and the DATA-04.1 source/chunk partition check proves normalized text was not omitted by chunk partitioning. It does not retain an explicit table object, header designation, merge map, or column types. For the Decree 356 forms and Decision 1671 matrices, later evidence should include a reviewer-approved rendering comparison for representative multi-column rows, merged cells, header relationships, exceptions, and conditions. No rule extraction should use those flattened rows until that review passes.

## Combined status

- Original bytes: 7/7 match the expected DATA-04.1 SHA-256 values.
- Offline extraction: 7/7 generated; total 2,381 chunks per the committed receipt.
- Chunk hashes and normalized non-whitespace source/chunk parity: PASS in DATA-04.1 evidence.
- Annex/form boundaries and repeated numbering: source evidence found; citation hierarchy partial or unresolved on 4 flagged documents.
- Table row/cell separator counts: match for all seven. Merged-cell/column semantics are not represented; separate semantic review remains required.
- Extraction defect: **NOT_PROVEN**. Citation/structure suitability for Decree 142, Decree 356, Circular 05 and Decision 1671: **STRUCTURE_REVIEW_REQUIRED**.
- Human legal review, role assignment, effect/applicability and legal completeness: **REQUIRES_REVIEW, 0/7 approved**.
- Persisted Legal Source/DRAFT, HTTP import, worker, RabbitMQ, corpus index: **NOT_RUN**.
- Activation, Preparation, Assessment and paid model inference: **NOT_RUN; none occurred in DATA-04.2**.

## Verification commands

Offline structural re-extraction of the flagged documents (local bytes only):

```powershell
uv run --project deepagents --frozen python $env:TEMP\lcsp347_data042_summary.py
uv run --project deepagents --frozen python $env:TEMP\lcsp347_data042_doc_structure.py
uv run --project deepagents --frozen python $env:TEMP\lcsp347_data042_tableallcompact.py
```

The scripts are temporary local audit helpers and are not repository deliverables. `python-docx`/lxml were not assumed; the audit reads the DOCX XML with Python's standard-library `zipfile` and `xml.etree.ElementTree` and calls the repository's real `ingest_document` implementation. No application/database/broker service was started.

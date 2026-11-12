# LCSP-347 DATA-04.1: offline document extraction evidence

## Scope and limits

Seven retained official Gazette DOCX candidates were rehashed and run through the repository's actual `managed_document_ingest.ingest_document` implementation, including DOCX extraction and configured `AUTO` structure chunking. This was offline processing over local source bytes. It was **not** authenticated HTTP import, PostgreSQL persistence, RabbitMQ delivery, Agent Server execution, callback processing, or source-level index construction.

The original files remain outside Git under `%TEMP%/lcsp347-data031-word`. Acquisition provenance remains in `official-nine-document-source-manifest.json`. Historical PDF and legacy DOC artifacts are unchanged.

## Results

| ID | Candidate instrument | Bytes | Original SHA-256 | Extracted chars | Extracted-text SHA-256 | Chapters | Articles | Chunks | Repeated article IDs | Duplicate locator suffixes |
|---|---|---:|---|---:|---|---|---|---:|---:|---:|
| 134 | Law 134/2025/QH15 | 66,110 | `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7` | 48,832 | `6370b7cbb224af43601d2c5e94f21e2c566d5e956fcb40a0dd54db94a71eb4e9` | I–VIII | 1–35 | 265 | 0 | 0 |
| 142 | Decree 142/2026/NĐ-CP | 241,572 | `110928d40055ca86d7278785f9c44aa165ab70bdf82013e8da677a1edc864000` | 181,148 | `b468b67eeea04fb016fb8d056f1b74732286728903dd7312f590148908ef2e98` | I–VIII | 1–46, 1–5, 1–7, 1–7 | 840 | 19 | 163 |
| 33 | Decision 33/2026/QĐ-TTg | 71,718 | `a0e042c90787edf7ef08a35ba7905e6d65758772ba0fd19bbcf31d201464297a` | 22,437 | `0d8f7245b9a282c1247801c7b08524452dc8ad2c06f1d23fb6d08323b4c62a26` | None detected | 1–4 | 19 | 0 | 0 |
| 05 | Circular 05/2026/TT-BKHCN | 61,198 | `299dc939784b39450f17492b8799e3776c9f56cfae4e832f14e3836e23a76a66` | 12,879 | `1d02f89e928f3265f2af94a1c70b38aae3759d785cd981749997292c76db5538` | None detected | 1–5 | 53 | 0 | 11 |
| 1671 | Decision 1671/QĐ-TTg | 133,808 | `d6dcdb889cccf2c1f6beaa331a1399662241b89377ba9cd7f45344e507908b21` | 103,017 | `5e2c40b6e87a85434d323d99c2698d68a1eddbfe0eaee686cba968b46f4fa711` | None detected | 1–3 | 191 | 0 | 79 |
| 356 | Decree 356/2025/NĐ-CP | 143,174 | `c36a6740d034031abb2d4a3a0350b99dfe395a40f8bff1f9dd98502267f8c4de` | 115,964 | `632b7cf13ab907f45a91890ef32820aaa75a18cb0d150fccf51aa4121525ccee` | I–V | 1–42, 1–3, 1–3 | 470 | 6 | 29 |
| 116 | Law 116/2025/QH15 | 86,919 | `b3bb2ad8e013881361a7ae2325aecb660d55e41f48755ed590a6f23cb44d1150` | 86,605 | `48d7b4e886f6cb75bd61785fbb425cf92c43768dae3de9e1657a7f50f8bd7c09` | I–VIII | 1–45 | 543 | 0 | 0 |

Aggregate: **7 distinct original hashes and 2,381 offline chunks**. All seven matched expected byte lengths and hashes. All returned technical `READY` from the offline extractor; each had zero explicit extraction gaps, zero Unicode replacement characters, and its instrument number was present in extracted text. Every chunk hash recomputed; locators were unique within each document after suffix handling; and each normalized non-whitespace source-to-chunk stream matched exactly.

The DOCX files contain respectively 2, 37, 3, 3, 4, 29, and 2 tables. The extractor output contains table-cell separators, but table-row/appendix semantic completeness was not independently compared against a separate trusted rendering.

## Structural review flags

Decree 142 and Decree 356 have article-number restarts and repeated numbers. These may reflect annexes or repeated structures, but that interpretation has not been established independently. Circular 05, Decision 1671, Decree 142, and Decree 356 have `dup` locator suffixes. No locator was manually corrected. Review those locators against the original documents before citation use.

The extraction results establish deterministic technical extraction and chunk partitioning only. They do not establish full legal fidelity against an independently verified rendition, legal effect, applicability, or corpus role. All seven remain `REQUIRES_REVIEW`.

## Readiness

| Check | Result |
|---|---|
| Original hash and byte-length match | PASS, 7/7 |
| Current managed extractor execution | PASS, 7/7 offline |
| Chunk-content hash and source partition | PASS, 7/7 offline |
| Article/locator structure | PARTIAL; review flags above |
| Authenticated import and persisted document state | NOT_RUN |
| Real broker/Agent Server/worker/callback | NOT_RUN |
| Full-set persisted retrieval index | NOT_RUN |
| Legal effect, applicability, role, and text fidelity approval | REQUIRES_REVIEW, 0/7 approved |

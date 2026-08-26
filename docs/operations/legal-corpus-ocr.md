# Legal Corpus OCR

Use the VBPL HTML crawler as the preferred source path. It preserves document
text and metadata without OCR. The OCR command is only a fallback for a
provenance-validated scan that has no accessible HTML source.

Both commands create review artifacts only; neither ingests or approves legal
content.

## Preferred: Crawl Official VBPL HTML

The crawler requires the numeric gateway document ID, not the `ItemID` in the
portal URL. Obtain that ID from an approved source lookup; do not bulk-crawl or
probe the gateway.

```bash
deepagents/.venv/bin/python deepagents/scripts/crawl_vbpl_document.py \
  --document-id LAW-71-2025-QH15 \
  --gateway-document-id <validated-vbpl-gateway-id> \
  --source-url 'https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989&Keyword=' \
  --output-dir reports/legal-corpus-source
```

This outputs source HTML, normalized plain text and a JSON manifest containing
the source/status metadata, retrieval time, and SHA-256 hashes. Review the
manifest's `sourceEffectStatus` before corpus ingestion.

## Normalize To A Draft Corpus Payload

```bash
deepagents/.venv/bin/python deepagents/scripts/normalize_vbpl_document.py \
  --source-manifest reports/legal-corpus-source/LAW-71-2025-QH15.source.json \
  --corpus-version VN-LEGAL-2026-08 \
  --output reports/legal-corpus-source/LAW-71-2025-QH15.ingest.json
```

The crawler always verifies HTTPS. On a server using an enterprise TLS proxy,
provide the proxy CA without disabling verification:

```bash
REQUESTS_CA_BUNDLE=/etc/ssl/certs/enterprise-proxy-ca.pem \
  deepagents/.venv/bin/python deepagents/scripts/crawl_congbao_docx.py ...
```

The generated payload contains stable `art-N`, `art-N::cl-M`, and
`art-N::cl-M::pt-X` locators, parent context and direct in-document article
references. It has `reviewRequired: true`; inspect warnings, hierarchy and
cross references before submitting it to the corpus ingestion endpoint.

## Official DOCX Fallback For Law 134

Luật 134/2025/QH15 is available as an official Công báo DOCX. Use it instead
of OCR whenever the official DOCX can be retrieved and its provenance can be
validated against the official publication metadata.

```bash
deepagents/.venv/bin/python deepagents/scripts/crawl_congbao_docx.py \
  --document-id LAW-134-2025-QH15 \
  --source-url 'https://congbao.chinhphu.vn/van-ban/luat-so-134-2025-qh15-468694.htm' \
  --source-effect-status 'Còn hiệu lực' \
  --output-dir reports/legal-corpus-source

deepagents/.venv/bin/python deepagents/scripts/normalize_vbpl_document.py \
  --source-manifest reports/legal-corpus-source/LAW-134-2025-QH15.source.json \
  --corpus-version VN-LEGAL-2026-08 \
  --output reports/legal-corpus-source/LAW-134-2025-QH15.ingest.json
```

## Fallback: OCR Scanned PDF

### Prerequisites

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-vie
```

`pdftoppm` comes from `poppler-utils`; Vietnamese recognition data is supplied
by `tesseract-ocr-vie`.

### Run The Repository Sources

From the repository root:

```bash
deepagents/.venv/bin/python deepagents/scripts/ocr_legal_pdf.py \
  --pdf reports/Luat_134_2025_QH15.pdf \
  --document-id LAW-134-2025-QH15 \
  --source-url https://vanban.chinhphu.vn/?docid=216334\&pageid=27160 \
  --output-dir reports/legal-corpus-ocr

deepagents/.venv/bin/python deepagents/scripts/ocr_legal_pdf.py \
  --pdf reports/Luat-71-2025-qh15_0710195033.pdf \
  --document-id LAW-71-2025-QH15 \
  --source-url https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989\&Keyword= \
  --output-dir reports/legal-corpus-ocr
```

Each run creates:

- `<document-id>.ocr.txt`: page-separated raw OCR text;
- `<document-id>.ocr.json`: source hash, page text hashes, OCR language/DPI and timestamp.

Raw OCR artefacts are immutable evidence of the OCR run. Do not correct them in
place after hashes have been recorded.

## Reviewed Artefact Gate

Before a corpus can leave `DRAFT`, the extracted text and legal hierarchy must
be reviewed and represented by deterministic artefacts. The gate is an artefact
and validation gate, not a real-person signature gate.

The current Law 134/Law 71 corpus requires:

- `<document-id>.reviewed.txt` — text corrected against the PRIMARY source;
- `<document-id>.hierarchy-review.json` — reviewed hierarchy, source/text hashes,
  review scope and review state;
- `reviewState: APPROVED` before the reviewed artefacts are eligible for corpus
  ingestion and automatic approval.

No handwritten/digital signature or verified identity of a legal-department
employee is required by the LCSP corpus pipeline. `reviewedBy`, when present,
is an audit principal/label only. It may identify a service account, automated
review process, role account or other technical principal and must not be
interpreted as legal certification or as evidence that a named lawyer signed the
content.

Corpus approval remains fail-closed when reviewed artefacts are missing,
hashes do not match, hierarchy/repeal relationships are unresolved or review
state is not `APPROVED`.

### Law 134 reviewed hierarchy

The raw OCR has a duplicate `Chương VI` before Điều 30. The reviewed hierarchy
used by LCSP is:

```text
Chương VI   -> Điều 28-29
Chương VII  -> Điều 30-32
Chương VIII -> Điều 33-35
```

This correction is recorded in
`LAW-134-2025-QH15.hierarchy-review.json`; the raw OCR file remains unchanged.

### Minimum hierarchy-review record

A review record contains at least:

```json
{
  "documentId": "LAW-134-2025-QH15",
  "reviewedSourceSha256": "sha256:...",
  "reviewedTextSha256": "sha256:...",
  "reviewState": "APPROVED",
  "reviewScope": {
    "type": "LCSP_TARGETED_CORPUS_PROVISIONS",
    "locators": ["art-9", "art-10", "art-33"]
  },
  "hierarchyCorrections": [
    {
      "raw": "Chương VI before Điều 30",
      "reviewed": "Chương VII",
      "scope": "Điều 30-32"
    }
  ]
}
```

Optional audit metadata such as `reviewedBy` and `reviewedAt` may be retained,
but it is not a requirement that `reviewedBy` resolve to a real legal employee.

`reviewState` must remain `CHANGES_REQUIRED` while any material OCR, hierarchy,
source-provenance or repeal-mapping issue is unresolved.

## Automatic Post-Review Pipeline

After all reviewed text and hierarchy files are present and every `reviewState`
is `APPROVED`, the remaining lifecycle is automated:

```text
reviewed text + hierarchy APPROVED
  -> validate source/text hashes and review scope
  -> ingest DRAFT corpus
  -> build and validate retrieval index
  -> approve corpus
```

The API still requires an authenticated principal with the applicable RBAC
actions to execute ingest/approval. That principal is a technical audit actor;
it does not have to be a real-person Legal Operator and its identity is not a
legal signature.

Run the orchestration only after the builder has produced the corpus payload:

```bash
LEGAL_OPERATOR_BEARER_TOKEN='<authenticated corpus approval principal token>' \
LEGAL_CHROMA_PATH='/var/lib/lcsp/chroma' \
deepagents/.venv/bin/python \
  deepagents/scripts/orchestrate_reviewed_legal_corpus.py \
  --payload reports/legal-corpus-source/VN-LEGAL-2026-08.ingest.json \
  --reviewed-dir reports/legal-corpus-reviewed \
  --api-base-url http://127.0.0.1:4000
```

`LEGAL_OPERATOR_BEARER_TOKEN` is retained as the current environment-variable
name for compatibility; it does not imply that the token belongs to a named
legal-department employee.

The orchestration fails closed when any reviewed text or hierarchy file is
missing, `reviewState` is not `APPROVED`, a reviewed text/source hash differs,
normalization warnings remain unresolved, or the retrieval index cannot return
all stable chunk IDs.

Corpus approval is an LCSP lifecycle decision only. It does not constitute a
legal opinion, legal certification or external regulatory approval.

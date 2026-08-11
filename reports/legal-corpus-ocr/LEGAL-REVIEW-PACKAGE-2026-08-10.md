# Legal corpus and rule-catalog review package — 2026-08-10

## Status and decision boundary

This package is a corpus review aid and implementation input. It does not create
a legal opinion, legal certification, attorney signature, regulatory approval or
other external legal conclusion.

The source PDFs were processed with Vietnamese/English OCR to produce stable,
hashable review artefacts. Raw OCR artefacts are immutable evidence of the OCR
run and must not be edited in place. Reviewed text and hierarchy artefacts are
the inputs to the LCSP corpus review gate.

**Identity policy:** LCSP does not require a handwritten/digital signature or a
verified identity belonging to a real legal-department employee. A
`reviewedBy`/`approvedBy` value, when stored, is technical audit metadata only.
It may represent a service account, role account, automated review process or
other authenticated principal and must not be interpreted as legal attestation.

| Document | OCR artefacts | Reviewed artefacts | Review gate state |
| --- | --- | --- | --- |
| `LAW-134-2025-QH15` | `LAW-134-2025-QH15.ocr.txt`, `LAW-134-2025-QH15.ocr.json` | `LAW-134-2025-QH15.reviewed.txt`, `LAW-134-2025-QH15.hierarchy-review.json` | determined by `reviewState` + hash/hierarchy validation |
| `LAW-71-2025-QH15` | `LAW-71-2025-QH15.ocr.txt`, `LAW-71-2025-QH15.ocr.json` | `LAW-71-2025-QH15.reviewed.txt`, `LAW-71-2025-QH15.hierarchy-review.json` | determined by `reviewState` + hash/hierarchy validation |

The locally held Law 71 PDF must not be promoted to a PRIMARY source merely
because its OCR manifest contains the canonical VBPL URL; source provenance is
validated separately from personnel identity.

## Required reviewed artefacts

Required artefacts per document:

1. `<document-id>.reviewed.txt`
   - corrected against a PRIMARY official source or verified authoritative text;
   - free of OCR transcription artefacts that could change legal meaning or
     hierarchy;
   - bound by SHA-256 in the hierarchy-review record.
2. `<document-id>.hierarchy-review.json`
   - records reviewed chapter/article/clause/point boundaries;
   - records corrections from raw OCR headings;
   - records source hash, reviewed-text hash, review scope and review state;
   - uses `reviewState: APPROVED` or `CHANGES_REQUIRED`.
3. The corpus normalizer/ingestion flow must consume the reviewed artefacts,
   never the raw `.ocr.txt`, once the review gate is enabled.

A named human reviewer, employee identity or legal signature is not required by
the LCSP MVP corpus contract. Optional reviewer metadata is audit metadata only.

## Reviewed hierarchy — Law 134

The raw OCR renders the management chapter following Article 29 as another
`Chương VI`, even though the preceding enforcement chapter is already
`Chương VI`, and the final provisions are `Chương VIII`.

The reviewed hierarchy recorded for LCSP is:

- `Chương VI` — Articles 28–29 — inspection/enforcement and violations;
- **`Chương VII` — Articles 30–32 — state management of artificial intelligence;**
- `Chương VIII` — Articles 33–35 — final provisions.

The correction is stored in `LAW-134-2025-QH15.hierarchy-review.json`; raw OCR
remains unchanged.

## Locator normalization and repeal mapping

The reviewed LCSP mapping for Law 134 Article 33 targets the following Law 71
locators:

| Amending text | Target document | Target locators | Required corpus action |
| --- | --- | --- | --- |
| Law 134, Article 33 | Law 71 | `art-3::cl-9` | set target chunk to `REPEALED`; retain repeal provenance to Law 134 Article 33 |
| Law 134, Article 33 | Law 71 | `art-4::cl-7` | same |
| Law 134, Article 33 | Law 71 | `art-12::cl-6` | same |
| Law 134, Article 33 | Law 71 | `art-34::cl-2::pt-đ` | same |
| Law 134, Article 33 | Law 71 | `art-41..art-45` | expand the range and set every article and descendant locator to `REPEALED` |

Boundary assertions:

- `art-40` is outside Chapter IV and is not part of the chapter-range repeal;
- `art-46` begins Chapter V and is not part of the chapter-range repeal.

Law 134 Articles 9–15 are retained as active reviewed candidate citation
targets. Law 71 Articles 41–45 must not be retrieved as active law after the
Article 33 relationship is materialized.

## Rule applicability scope for Law 134 Articles 9–15

Every rule must use `BLOCK_ON_UNKNOWN`. A match means only that an obligation
may apply; it is not a finding that an organization has breached or satisfied
that obligation. Each material fact must carry a verified-profile evidence
reference.

The baseline implementation must not infer missing legal roles or business facts
from source code when the verified profile does not contain evidence-backed
fields. Missing provider/deployer/developer/user role, deployment stage, sector,
scale, public distribution, high-risk catalogue status or conformity evidence
must remain unknown.

## Review gate checklist

- [x] Reviewed text artefact exists for Law 134 and is hash-bound.
- [x] Law 134 Chapter VI/VII/VIII hierarchy is explicitly recorded.
- [x] Reviewed text artefact exists for Law 71 and is hash-bound.
- [x] Stable target locators for the Article 33 repeal are recorded.
- [x] `art-41..art-45` range expansion and descendant semantics are recorded.
- [x] Boundary checks preserve `art-40` and `art-46` outside the repeal range.
- [x] Raw OCR remains immutable.
- [ ] Normalizer must build corpus chunks from reviewed text rather than a pre-review payload.
- [ ] Relationship resolver must materialize `REPEALED` status and repeal provenance.
- [ ] Corpus/retrieval validation pipeline must complete successfully.

## Approval identity policy

LCSP separates **content review evidence** from **personnel identity**:

- content trust comes from source provenance, deterministic hashes, reviewed
  text, hierarchy/repeal assertions and validation results;
- `reviewState` is the content gate state;
- `reviewedBy`/`approvedBy`, if stored, are audit fields only;
- no real-person Legal Operator identity or signature is required by this MVP;
- an authenticated service/role account may execute technical corpus lifecycle
  actions when it has the required PBAC permission;
- corpus `APPROVED` means eligible for LCSP retrieval under the configured
  policy, not certified by legal counsel.

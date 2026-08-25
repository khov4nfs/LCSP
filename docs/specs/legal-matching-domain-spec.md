# Legal Matching Domain Spec

> Superseded for active runtime: new assessment execution uses direct EngineeringRule classification. This document remains as historical domain behavior for the retired `VerifiedProfile -> LegalRuleMatch -> ClassificationWorker` chain; do not treat its callback or event handoff as an active MVP contract.

## Purpose

This document explains how verified LCSP business facts become citation-backed legal matches.

It is the domain behavior source of truth for `LegalMatchingWorker` and the legal-match input boundary for `ClassificationWorker`. It does not create legal advice, legal validation, architecture, implementation files, test plans or backlog items.

## Inputs

### VerifiedProfile

| Input | Meaning | Required | Missing behavior |
|---|---|---:|---|
| `verifiedProfileId` | Reconciled profile identity. | Yes | Legal matching is blocked. |
| `assessmentId` | Assessment scope. | Yes | Legal matching is blocked. |
| `technicalProfileId` | Technical source basis. | Yes | Legal matching is blocked. |
| `aiUsageFlowId` | AI usage claim source. | Yes | Legal matching is blocked. |
| `profileVersion` | Versioned verified basis. | Yes | Matching cannot be reproduced; block. |
| `mergedProfile` | Reconciled business and technical facts. | Yes | Rule applicability cannot be evaluated. |
| `evidenceRefs` | Evidence refs supporting merged facts. | Yes | Material legal matches are not allowed. |

### Legal Corpus

| Input | Meaning | Required | Missing behavior |
|---|---|---:|---|
| `legalCorpusVersionId` | Corpus version identity. | Yes | Legal matching is blocked. |
| `version` | Version label. | Yes | Legal matching is blocked. |
| `sourceRefs` | Source documents and retrieval metadata. | Yes | Citation coverage is `NO_CITATION`. |
| `status` | Corpus approval/availability state. | Yes | Obsolete or unapproved corpus blocks formal match output. |

### Legal Rule

`LegalRule` entity, authoring, versioning and approval are defined in `docs/specs/legal-rule-catalog-spec.md`. A `LegalRule` is hand-authored by an Internal Legal Operator and is never auto-derived from the legal corpus text; it is only citation-validated against an approved `LegalCorpusVersion` at authoring time.

| Input | Meaning | Required | Missing behavior |
|---|---|---:|---|
| `ruleId` | Stable legal rule identifier. | Yes | Match cannot be created. |
| `legalRuleCatalogVersionId` | Approved rule catalog version pinned for this match run. | Yes | Legal matching is blocked. |
| `ruleFamily` | Classification family such as AI use, data, oversight, documentation. | Yes | Candidate ranking is degraded. |
| `requiredFacts` | VerifiedProfile facts that must be present. | Yes | If absent, rule is not applicable or blocked. |
| `optionalFacts` | Facts that strengthen confidence. | No | Confidence may be lower. |
| `blockingFacts` | Facts that make the rule inapplicable. | No | Match is rejected when present. |
| `unknownFactPolicy` | How unknown critical facts affect applicability. | Yes | Default is blocked/degraded, never guessed. |

### Citation

| Input | Meaning | Required | Missing behavior |
|---|---|---:|---|
| `citationId` | Citation identity. | Yes for material match | Match coverage becomes `NO_CITATION` if absent. |
| `sourceTitle` | Legal source title. | Yes for material match | `PARTIAL_CITATION`. |
| `sourceIdentifier` | Law/decree/article/source identifier. | Yes for material match | `PARTIAL_CITATION`. |
| `locator` | Article/clause/section or other locator. | Yes for material match | `PARTIAL_CITATION`. |
| `corpusVersion` | Pinned corpus version. | Yes | Legal match is blocked. |
| `retrievalRef` | Retrieval/chunk/reference identity. | Yes | Citation cannot be audited; block/degrade. |
| `effectiveDateMetadata` | Effective/publication date when available. | Conditional | If unavailable, mark limitation, do not fabricate. |

### ChromaDB Vectorless Retrieval Payload

Legal matching consumes ChromaDB structure-first vectorless retrieval results. Retrieval is not a generic search box and must preserve legal hierarchy and citation provenance.

| Input | Meaning | Required | Missing behavior |
|---|---|---:|---|
| `retrievedChunks` | Primary chunks selected by full-text/metadata/direct ID lookup. | Yes | Legal matching is blocked for material rules. |
| `referencedContextChunks` | One-hop cross-reference expansions. | Conditional | Referenced context unavailable is a citation limitation. |
| `parentContextChunks` | Parent document/article/clause context required to interpret the primary hit. | Conditional | Point/clause interpretation blocks or degrades. |
| `citationAllowlist` | Legal refs that downstream rule/LLM output may cite. | Yes | Legal matching is blocked. |
| `retrievalAuditId` | Retrieval audit record for candidate selection and assembly. | Yes | Legal matching is blocked. |

Every chunk carries stable hierarchical identity:

```text
{document_id}::art-{article_no}
{document_id}::art-{article_no}::cl-{clause_no}
{document_id}::art-{article_no}::cl-{clause_no}::pt-{point_code}
```

The base retrieval unit is Clause (`Khoản`). Point (`Điểm`) content is assembled with its parent Clause and Article context.

## Outputs

### LegalRuleMatch

| Field | Meaning | Required | Source |
|---|---|---:|---|
| `legalRuleMatchId` | Match identity. | Yes | System generated. |
| `assessmentId` | Assessment scope. | Yes | VerifiedProfile. |
| `verifiedProfileId` | Verified profile source. | Yes | VerifiedProfile. |
| `legalCorpusVersionId` | Corpus version used. | Yes | Legal Corpus. |
| `legalRuleCatalogVersionId` | Rule catalog version used. | Yes | Legal Rule. |
| `ruleId` | Matched rule identifier. | Yes | Legal Rule. |
| `status` | `MATCHED`, `NOT_APPLICABLE`, `BLOCKED_UNKNOWN_FACT`, `BLOCKED_MISSING_CITATION`, `DEGRADED`, or `FAILED`. | Yes | Applicability and citation evaluation. |
| `citationRefs` | Citation references. | Yes | Citation retrieval. |
| `rationale` | Structured fact-to-rule rationale. | Yes | Rule evaluation. |
| `confidence` | Deterministic match confidence, 0.0 to 1.0. | Yes | Confidence model. |
| `coverage` | CitationCoverage object. | Yes | Coverage model. |
| `retrievalAuditId` | ChromaDB retrieval/assembly audit identity. | Yes | Retrieval audit. |
| `contextRoles` | Context roles used by citations: `PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT`. | Yes | Retrieval assembly. |
| `createdAt` | Creation timestamp. | Yes | System generated. |

### CitationCoverage

| Field | Meaning | Required | Source |
|---|---|---:|---|
| `coverageStatus` | `NO_CITATION`, `PARTIAL_CITATION`, or `COMPLETE_CITATION`. | Yes | Citation checks. |
| `requiredCitationCount` | Number of required citation refs. | Yes | Rule. |
| `completeCitationCount` | Number of complete citations. | Yes | Citation checks. |
| `partialCitationCount` | Number of partial citations. | Yes | Citation checks. |
| `missingCitationCount` | Number of missing citations. | Yes | Citation checks. |
| `coveragePercent` | `completeCitationCount / requiredCitationCount * 100`. | Yes | Coverage model. |
| `citationGaps` | Missing/incomplete citation descriptors. | Yes | Citation checks. |
| `limitations` | Non-fabricated limitations such as missing effective date. | Yes | Citation metadata. |

### LegalMatchingResult

| Field | Meaning | Required | Source |
|---|---|---:|---|
| `legalMatchingResultId` | Run identity. | Yes | System generated. |
| `assessmentId` | Assessment scope. | Yes | VerifiedProfile. |
| `verifiedProfileId` | Verified profile source. | Yes | VerifiedProfile. |
| `legalCorpusVersionId` | Corpus version used. | Yes | Legal Corpus. |
| `matches` | LegalRuleMatch array. | Yes | Rule evaluation. |
| `overallCoverage` | CitationCoverage aggregate. | Yes | Coverage model. |
| `blockingReasons` | Blocking conditions for classification. | Yes | Failure and citation checks. |
| `classificationEligible` | Whether classification command may be requested. | Yes | Handoff rules. |
| `createdAt` | Creation timestamp. | Yes | System generated. |

## Legal Matching Workflow

1. Load `VerifiedProfile`.
2. Verify no unresolved conflict remains.
3. Load active `LegalCorpusVersion`.
4. Extract legal facts from `VerifiedProfile.mergedProfile`.
5. Reject facts without evidence refs when they are material.
6. Use the ChromaDB vectorless retriever to retrieve primary legal chunks by evidence-backed AIUsageFlow fields: business process, AI purpose, automation level, affected subjects, input/output data types, human review and harm categories.
7. Assemble parent context for every primary match.
8. Expand one-hop legal cross-references and mark them `REFERENCED_CONTEXT`.
9. Build retrieved citation allowlist from primary, parent and referenced chunks.
10. Reject any rule, LLM or retrieval output that cites a legal ref outside the allowlist.
11. Evaluate rule applicability against required, optional, blocking and unknown facts.
12. Build `LegalRuleMatch` objects with retrieval audit IDs, context roles and citation coverage.
13. Calculate citation coverage per match and aggregate coverage.
14. Persist `LegalRuleMatch[]`.
15. Emit `event.legal-matching.completed.v1` if classification can evaluate the result.
16. Emit `event.legal-matching.failed.v1` if missing profile, obsolete corpus or fatal citation/retrieval failure prevents evaluation.

## Rule Applicability Model

| Fact Type | Meaning | Applicability behavior |
|---|---|---|
| Required facts | Facts that must be present for the rule to apply. | If all are present with evidence refs, continue. If any are absent, status is `NOT_APPLICABLE`. If any are unknown and legally material, status is `BLOCKED_UNKNOWN_FACT`. |
| Optional facts | Facts that strengthen or explain the match. | Improve confidence but never make a rule applicable alone. |
| Blocking facts | Facts that make the rule inapplicable. | If present, status is `NOT_APPLICABLE` with rationale. |
| Unknown facts | Facts that cannot be verified. | If critical to rule applicability, block/degrade; do not guess. |

Rule applicability expression:

```text
applicable =
  all(requiredFacts.present && requiredFacts.evidenceBacked)
  && none(blockingFacts.present)
  && no critical unknown facts
```

Provider/model/framework presence alone is never a required fact for legal rule applicability.

## Technical Claim Eligibility Threshold

Legal matching may only use an AIUsageFlow material claim when all conditions are true:

- claim has at least one `EvidenceRef`;
- claim lifecycle is `VALIDATED` or `VERIFIED`;
- claim confidence is `>= 0.75` for material classification use;
- claim is not provider/model/framework presence alone;
- claim has no unresolved conflict reference;
- claim is not blocked by coverage limitation for the rule-required fact.

Claims with confidence `0.65..0.74` may be recorded as supporting context only and must not be the sole basis for a material legal match. Claims below `0.65`, claims without evidence refs, and claims with unresolved conflict are not legal-matching eligible.

## Citation Requirements

| Status | Meaning | Classification effect |
|---|---|---|
| `NO_CITATION` | No citation ref exists for the material rule. | Blocks material legal conclusion and final classification when critical. |
| `PARTIAL_CITATION` | Citation exists but lacks required locator/version/source metadata. | Degrades or blocks depending on materiality; must be explicit. |
| `COMPLETE_CITATION` | Citation has source title, identifier, locator, corpus version, stable chunk ID, retrieval ref, context role and effective date metadata when available. | May support classification. |

No citation may be fabricated. Policy-only sources cannot be treated as standalone mandatory obligations unless the active legal classification spec identifies them as binding.

Citation refs must point to one of:

- `retrievedChunks`;
- `parentContextChunks`;
- `referencedContextChunks`.

Any `legal_ref` outside the retrieved citation allowlist is rejected and produces `BLOCKED_MISSING_CITATION` or failed legal matching according to materiality. Referenced context must not be presented as the primary legal basis; it must retain `contextRole = REFERENCED_CONTEXT` and an xref reason.

## Match Confidence Model

Confidence is deterministic:

```text
requiredFactScore = matchedRequiredFacts / totalRequiredFacts
optionalFactScore = min(matchedOptionalFacts * 0.05, 0.15)
citationScore =
  1.00 if COMPLETE_CITATION
  0.50 if PARTIAL_CITATION
  0.00 if NO_CITATION
corpusScore =
  1.00 if corpus status is approved/current
  0.50 if corpus has non-fatal metadata limitation
  0.00 if corpus obsolete/unavailable
unknownPenalty = 0.25 for each critical unknown, capped at 0.50
blockingPenalty = 1.00 if any blocking fact is present

matchConfidence = clamp(
  (0.45 * requiredFactScore)
  + optionalFactScore
  + (0.35 * citationScore)
  + (0.20 * corpusScore)
  - unknownPenalty
  - blockingPenalty,
  0.00,
  1.00
)
```

Thresholds:

- `>= 0.75` with complete citations: classification-eligible match.
- `0.50..0.74`: degraded match; classification may block if material.
- `< 0.50`: not eligible for material classification conclusion.

## Coverage Model

```text
coveragePercent = completeCitationCount / requiredCitationCount * 100
```

Coverage categories:

- `100%`: all required legal citations complete.
- `50%..99%`: partial coverage; gap list required.
- `< 50%`: insufficient coverage for material conclusions.
- `0%`: no citation basis; block critical classification and final legal output.

Missing coverage means a legal fact, rule or citation required for classification cannot be traced. Coverage gaps and citation gaps must be stored in `LegalMatchingResult.blockingReasons` or `CitationCoverage.citationGaps`.

## Failure Modes

| Failure mode | Trigger | Output |
|---|---|---|
| Missing profile | VerifiedProfile cannot be loaded. | `event.legal-matching.failed.v1`; no classification command. |
| Missing citation | Material rule lacks citation. | Match status `BLOCKED_MISSING_CITATION`; classification blocked/degraded. |
| Out-of-allowlist citation | Rule/LLM output cites a chunk outside the retrieved allowlist. | Reject cited output; block material match. |
| Missing retrieval audit | Retrieval cannot prove primary/parent/referenced assembly. | `event.legal-matching.failed.v1`; no classification command. |
| Ambiguous rule | Multiple candidate rules apply with contradictory conditions. | Match status `BLOCKED_UNKNOWN_FACT` or degraded rationale; no unsupported conclusion. |
| Contradicting citations | Retrieved citations conflict or point to incompatible versions. | Block/degrade and require corpus/rule review. |
| Obsolete corpus version | Corpus status is obsolete/unapproved. | `event.legal-matching.failed.v1`; no classification command. |
| Unknown critical usage | VerifiedProfile has `UNKNOWN` automation/human review/downstream action where rule requires it. | `BLOCKED_UNKNOWN_FACT`. |

## Classification Handoff

Legal matching hands off to classification only after legal matches are persisted.

```text
event.reconciliation.verified-profile-ready.v1
-> command.legal-matching.requested.v1
-> LegalRuleMatch[]
-> event.legal-matching.completed.v1
-> command.classification.requested.v1
```

Classification must not consume `event.reconciliation.verified-profile-ready.v1` directly. The handoff payload contains references only:

```json
{
  "assessmentId": "018f0000-0000-7000-8000-000000000001",
  "verifiedProfileId": "018f0000-0000-7000-8000-000000000411",
  "legalRuleMatchIds": ["018f0000-0000-7000-8000-000000000521"],
  "legalCorpusVersionId": "018f0000-0000-7000-8000-000000000511"
}
```

## Worked Example

### VerifiedProfile Facts

```json
{
  "verifiedProfileId": "018f0000-0000-7000-8000-000000000411",
  "assessmentId": "018f0000-0000-7000-8000-000000000001",
  "mergedProfile": {
    "businessProcess": "loan_approval",
    "automationLevel": "FULLY_AUTOMATED",
    "humanReview": "ABSENT_WITH_BOUNDED_PATH",
    "aiInputTypes": ["financial", "personal_data"],
    "aiOutputTypes": ["score"],
    "downstreamAction": "APPROVE_REJECT",
    "affectedSubjects": ["loan_applicant"],
    "potentialHarmCategories": ["financial_harm"]
  },
  "evidenceRefs": ["ev_invocation_001", "ev_score_001", "ev_branch_001"]
}
```

### Rule Evaluation

| Rule input | Value | Result |
|---|---|---|
| Required fact: financial input | present | pass |
| Required fact: automated approve/reject | present | pass |
| Required fact: affected subject | loan applicant | pass |
| Required fact: human review absent/bounded | present | pass |
| Blocking fact: assistive-only use | absent | pass |
| Citation | complete citation exists | pass |

### LegalRuleMatch Output

```json
{
  "legalRuleMatchId": "018f0000-0000-7000-8000-000000000521",
  "assessmentId": "018f0000-0000-7000-8000-000000000001",
  "verifiedProfileId": "018f0000-0000-7000-8000-000000000411",
  "legalCorpusVersionId": "018f0000-0000-7000-8000-000000000511",
  "ruleId": "AI-HIGH-IMPACT-FINANCIAL-AUTOMATED-DECISION",
  "status": "MATCHED",
  "citationRefs": [
    {
      "citationId": "018f0000-0000-7000-8000-000000000531",
      "sourceTitle": "Pinned legal corpus source",
      "sourceIdentifier": "corpus-rule-ref",
      "locator": "article-or-rule-locator",
      "corpusVersion": "LCSP-LEGAL-CORPUS-v0.1.0",
      "retrievalRef": "018f0000-0000-7000-8000-000000000541"
    }
  ],
  "rationale": {
    "requiredFactsMatched": [
      "loan_approval",
      "FULLY_AUTOMATED",
      "APPROVE_REJECT",
      "financial",
      "loan_applicant"
    ],
    "blockingFactsPresent": [],
    "unknownFacts": []
  },
  "confidence": 0.95,
  "coverage": {
    "coverageStatus": "COMPLETE_CITATION",
    "requiredCitationCount": 1,
    "completeCitationCount": 1,
    "partialCitationCount": 0,
    "missingCitationCount": 0,
    "coveragePercent": 100,
    "citationGaps": [],
    "limitations": []
  }
}
```

---

## Legal Corpus Ingestion, Approval and Retrieval (Phase 5.2L Update)

### Legal Source Hierarchy

1. **PRIMARY SOURCES** (Legally authoritative Vietnamese government decrees, circulars, and decisions):
   - Officially sourced from databases like `vbpl.vn` or `vanban.chinhphu.vn` (subject to source validation).
   - Serves as the sole foundation for mandatory compliance obligations.
2. **SUPPLEMENTARY SOURCES** (Contextual non-authoritative regulatory guidance):
   - Government FAQs, training material, or administrative guidance.
   - May clarify rule interpretations but cannot define new legal rules alone.

### Legal Source Ingestion Requirements

The `Legal Source Ingestion Worker` manages the lifecycle of legal source ingestion:

- **Source Provenance:** Capture and store retrieval metadata: URL, HTTP headers, retrieve timestamp, and redirect history.
- **Immutable Snapshot:** Store the original document (PDF/HTML) in S3 object storage; record its SHA-256 content hash.
- **Normalization:** Parse hierarchical structure into standard legal units: Chapter, Section, Article, Clause, and Point.
- **Metadata Fields:** Track type, number, issuing authority, issue date, effective start date, and effective end date.

```text
If a source URL or document is unavailable:
  → Ingest job fails with LEGAL_SOURCE_UNAVAILABLE
  → Audit trail records failure
  → Downstream classification tasks are blocked (fail-closed)
```

### Legal Corpus Review & Approval Gate

1. **Draft State:** Newly ingested legal documents exist in a DRAFT state.
2. **Review Work:** Authorized legal personnel review the parsed items for correctness and mapping accuracy.
3. **Approval Event:** On approval, an immutable `LegalCorpusVersion` is created. Unapproved versions are blocked from classification.

### ChromaDB Structure-First Vectorless Legal Retriever

Matches verified facts against legal rules using a structure-first vectorless retrieval pipeline in ChromaDB:

- **Stable legal records:** document, article, clause and point chunks use stable hierarchical IDs.
- **Full-text and metadata retrieval:** ChromaDB stores legal records and supports text/metadata candidate lookup without mandatory embeddings.
- **Direct lookup:** known `chunk_id`, `article_id`, `clause_id` or `point_id` can retrieve exact records.
- **Parent-context assembly:** Point matches include parent Clause and Article context; Clause matches include parent Article and document context.
- **Cross-reference expansion:** one-hop referenced chunks are fetched and marked `context_role=REFERENCED_CONTEXT`.
- **Metadata & Version Filtering:**
  - **Pin Version:** Query must only retrieve from the approved `LegalCorpusVersion` pinned at assessment initialization.
  - **Effective Date:** Pinned legal documents must be in legal effect on the assessment date.
- **Citation allowlist:** Legal refs are valid only when they point to `retrieved_chunks` or `referenced_context_chunks`.
- **Fail-Closed Citations:** If retrieval returns no results or missing required citations, the classification is marked `BLOCKED_MISSING_CITATION` and document generation is blocked.

The base retrieval unit is Clause (`Khoản`). Chunks must not split between sentences or clauses solely to satisfy token size. BGE-M3 or another embedding model is optional future work only; it is not required for MVP legal retrieval.

```

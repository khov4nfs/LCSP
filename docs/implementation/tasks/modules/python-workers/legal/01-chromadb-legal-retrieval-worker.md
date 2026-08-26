---
task_id: MW-legal-001
module: python-workers/legal
runtime: deepagents
priority: P0
status: SUPERSEDED_FOR_ACTIVE_MVP
epic_story: 6.1
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
  - python-workers/intelligence/04-verified-profile-worker.md
---

# Legal Matching Worker (Rule Applicability + ChromaDB Citation Retrieval)

> Superseded: the active runtime no longer consumes `verified-profile-ready` to produce `LegalRuleMatch`. Approved LegalRules are compiled into EngineeringRules; the direct assessment runtime uses citations and legal provenance without the legacy legal-rule-match callback surface.

## Outcome

Consume `verified-profile-ready` events and produce `LegalRuleMatch` candidates in two distinct phases that must not be conflated:

1. **Rule applicability evaluation** — deterministic evaluation of the approved `LegalRule` catalog (dataset 2, Postgres-backed, see `docs/specs/legal-rule-catalog-spec.md`) against `VerifiedProfile.mergedProfile` facts. This is NOT a ChromaDB search — rules are never found by full-text/semantic search over legal text.
2. **Citation retrieval** — for each rule that applies, use ChromaDB structure-first vectorless retrieval (see `docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md`) only to fetch the exact cited chunks (`citationLocatorRefs`) and one-hop referenced context, proving the rule's citation basis. ChromaDB never decides which rule applies.

No dense embeddings anywhere in this worker.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/legal/legal/__init__.py` | Create | Package init |
| `deepagents/tools/legal/legal/legal_retrieval_consumer.py` | Create | `ConsumerBase` subclass for `verified-profile-ready` |
| `deepagents/tools/legal/legal/rule_applicability_evaluator.py` | Create | Deterministic `LegalRule` catalog evaluation against `VerifiedProfile.mergedProfile` — no ChromaDB call |
| `deepagents/tools/legal/legal/chromadb_citation_retriever.py` | Create | Citation-only ChromaDB structure-first retrieval for matched rules |
| `deepagents/tools/legal/legal/citation_allowlist_validator.py` | Create | Citation allowlist validation |
| `deepagents/tools/legal/legal/legal_match_builder.py` | Create | Applicability result + citation → `LegalRuleMatch` candidates |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `legal.verified-profile-ready` |
| Routing key | `verified-profile-ready` |
| RBAC preflight | No (system event) |

## Phase 1 — Rule Applicability Evaluation (Deterministic, Not ChromaDB)

1. Load the active `LegalRuleCatalogVersion` (status `APPROVED`) pinned for this assessment/run.
2. For each `LegalRule` in that version: evaluate `requiredFacts`/`optionalFacts`/`blockingFacts`/`unknownFactPolicy` against `VerifiedProfile.mergedProfile`, exactly per `docs/specs/legal-matching-domain-spec.md`'s Rule Applicability Model:
   ```text
   applicable = all(requiredFacts.present && requiredFacts.evidenceBacked)
                && none(blockingFacts.present)
                && no critical unknown facts
   ```
3. Reject facts without evidence refs when they are material (per `Technical Claim Eligibility Threshold` in `legal-matching-domain-spec.md`: evidence ref present, lifecycle `VALIDATED`/`VERIFIED`, confidence `>= 0.75` for material use, no unresolved conflict).
4. Output: a list of `(ruleId, status)` where `status` is `MATCHED`, `NOT_APPLICABLE`, or `BLOCKED_UNKNOWN_FACT` — no citation content yet.

## Phase 2 — ChromaDB Citation Retrieval (Structure-First, Vectorless)

For each rule with `status = MATCHED` in Phase 1, retrieve its `citationLocatorRefs` from ChromaDB:

1. **Direct ID lookup**: fetch each `citationLocatorRefs` chunk by stable hierarchical ID (`{document_id}::art-{n}::cl-{m}::pt-{x}`).
2. **`legal_status` filter**: exclude any chunk where `legal_status = REPEALED` unless historical context is explicitly requested — a rule citing a repealed chunk is a citation failure, not a silent pass (see Failure Behavior below).
3. **Parent context assembly**: fetch parent Clause/Article context for Point-level citations.
4. **One-hop xref expansion**: follow `outgoing_ref_ids`/`incoming_ref_ids` metadata for referenced context, marked `REFERENCED_CONTEXT`.
5. **Citation allowlist**: build from primary + parent + referenced chunks.

No full-text search, no metadata-filter "candidate discovery" of which rule might apply — Phase 2 only fetches citations for rules Phase 1 already determined applicable.

## LegalRuleMatchItem Schema

```python
@dataclass
class LegalRuleMatchItem:
    match_id: str
    rule_id: str                        # LegalRule.legalRuleId
    legal_rule_catalog_version_id: str   # Pinned rule catalog version
    legal_corpus_version_id: str         # Pinned corpus version used for citation
    status: str                         # MATCHED | NOT_APPLICABLE | BLOCKED_UNKNOWN_FACT | DEGRADED
    citation_chunk_ids: list[str]        # Must all be in citation_allowlist and legal_status != REPEALED
    context_roles: list[str]             # PRIMARY_MATCH | PARENT_CONTEXT | REFERENCED_CONTEXT per chunk
    confidence: float                    # Deterministic, per legal-matching-domain-spec.md Match Confidence Model
    coverage_status: str                 # NO_CITATION | PARTIAL_CITATION | COMPLETE_CITATION
    usage_claim_refs: list[str]          # AIUsageFlowClaim IDs backing requiredFacts
```

## Business Rules

1. Rule applicability (Phase 1) is evaluated entirely from `VerifiedProfile.mergedProfile` + `LegalRule` catalog — never from a ChromaDB search.
2. `context_roles` must remain distinct: `PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT` — no merging.
3. All `citation_chunk_ids` in each match must be from retrieved chunks with `legal_status != REPEALED` — never hallucinated chunk IDs, never a repealed chunk presented as current law.
4. Build `citation_allowlist` from: primary chunk IDs + parent context IDs + referenced context IDs.
5. Out-of-allowlist citations → reject the match (do not include in results).
6. `legal_corpus_version_id` must reference an approved `LegalCorpusVersion`; `legal_rule_catalog_version_id` must reference an approved `LegalRuleCatalogVersion`. Both are required — a match pinned to only one is incomplete.
7. If a matched rule's `citationLocatorRefs` resolves to a `REPEALED` chunk with no non-repealed alternative, set `coverage_status = NO_CITATION` and flag for mandatory rule re-review (per `legal-rule-catalog-spec.md`'s Corpus Supersession Impact on Rules) — do not silently degrade.
8. If no rules match → submit with `matches = []`. NestJS callback handles blocked state.
9. No LLM calls anywhere in this worker — pure deterministic rule evaluation and structured ChromaDB queries.
10. Submit to `POST /internal/classification/legal-rule-match-callback`.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | VerifiedProfile matches a rule's requiredFacts, citation resolves cleanly | `MATCHED`, `COMPLETE_CITATION` |
| T02 | No rule's requiredFacts satisfied | `matches = []` submitted |
| T03 | `context_roles` distinct per match | PRIMARY/PARENT/REFERENCED never merged |
| T04 | Citation chunk not in retrieved set | Match rejected from results |
| T05 | Unapproved `LegalCorpusVersion` or `LegalRuleCatalogVersion` | Callback returns 422 |
| T06 | No dense embeddings called | No embedding API calls in trace |
| T07 | One-hop xref expansion | Referenced context retrieved |
| T08 | Matched rule cites a chunk with `legal_status = REPEALED` | `coverage_status = NO_CITATION`; rule flagged for re-review |
| T09 | Rule applicability decided by full-text ChromaDB search instead of deterministic fact evaluation | Test MUST FAIL (architecture violation) |
| T10 | Required fact present but not evidence-backed | `BLOCKED_UNKNOWN_FACT`, not `MATCHED` |

## Definition of Done

- Rule applicability is deterministic against the `LegalRule` catalog — ChromaDB is citation-only, never rule-discovery.
- `legal_status = REPEALED` chunks never presented as valid citations.
- Both `legal_corpus_version_id` and `legal_rule_catalog_version_id` pinned on every match.
- `context_roles` distinct (`PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT`).
- Citation allowlist built from retrieved chunks only — no hallucinated IDs.
- Empty result explicitly submitted (not omitted).

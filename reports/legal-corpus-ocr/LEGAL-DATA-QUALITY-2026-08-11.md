# Legal Corpus + Rule Catalog Data Quality Gate — 2026-08-11

## Scope

This record captures the deterministic quality gates added after the reviewed
Law 134/2025/QH15 and Law 71/2025/QH15 artefacts were approved for LCSP's
targeted corpus scope.

It is an engineering/audit record only. It is not legal advice, legal
certification, or an external regulatory approval.

## Legal Corpus publication gate

The reviewed-corpus builder now publishes only locators covered by
`reviewScope.fullTextReviewedLocators`.

Hierarchy-only and boundary-only locators remain available to validate legal
structure and repeal ranges, but are not emitted as retrievable corpus chunks.
For the current fixture this means, among others:

- Law 134 Articles 28–32 are hierarchy-only and are not retrieval content;
- Law 71 Article 40 and Article 46 are range-boundary assertions and are not
  retrieval content;
- Law 71 `art-34::cl-2::pt-đ` remains reviewable with its parent Article/Clause
  context without widening the reviewed legal text beyond the reviewed artefact.

The builder fails closed when:

- reviewed text or hierarchy review is missing;
- `reviewState` is not `APPROVED`;
- reviewed text/source hashes do not resolve to the reviewed snapshot;
- `fullTextReviewedLocators` is missing or cannot be resolved;
- the Law 134 Article 33 mapping is not identically confirmed by both Law 134
  and Law 71 review records;
- the `art-41..art-45` range expansion is incomplete;
- Law 71 boundary locators `art-40` or `art-46` cannot be found.

### Build the reviewed corpus payload

From the repository root:

```bash
lcsp-python-workers/.venv/bin/python \
  lcsp-python-workers/scripts/build_reviewed_legal_corpus.py \
  --source-manifest reports/legal-corpus-source/LAW-134-2025-QH15.source.json \
  --source-manifest reports/legal-corpus-source/LAW-71-2025-QH15.source.json \
  --reviewed-dir reports/legal-corpus-ocr \
  --version VN-LEGAL-2026-08-REVIEWED \
  --output reports/legal-corpus-source/VN-LEGAL-2026-08-REVIEWED.ingest.json
```

The output provenance is rebound to the source snapshot actually reviewed by
the hierarchy-review artefact. Discovery/crawler manifests are retained as
provenance inputs but do not override the reviewed snapshot hash.

## Article 33 legal-effect materialization

The materialized relationship is:

```text
LAW-134-2025-QH15::art-33
  -> LAW-71-2025-QH15::art-3::cl-9
  -> LAW-71-2025-QH15::art-4::cl-7
  -> LAW-71-2025-QH15::art-12::cl-6
  -> LAW-71-2025-QH15::art-34::cl-2::pt-đ
  -> LAW-71-2025-QH15::art-41..art-45 (including descendants)
```

Each affected published chunk receives:

```json
{
  "legalStatus": "REPEALED",
  "hierarchy": {
    "repealedByRef": {
      "documentId": "LAW-134-2025-QH15",
      "locator": "art-33"
    }
  }
}
```

The payload also records a `sourceManifest.materializedRelationships` audit
entry with declared locators, materialized chunk IDs, and the Article 40/46
boundary assertions.

## Corpus approval and audit-principal policy

Reviewed artefact identity and lifecycle approval identity are separate audit
concerns:

- `reviewedBy` identifies the technical principal that produced/approved the
  reviewed artefact gate;
- the bearer token identifies the authenticated principal authorized by PBAC to
  ingest/approve the corpus lifecycle action.

The orchestrator now declares:

```json
{
  "identityPolicy": "TECHNICAL_AUDIT_PRINCIPALS_INDEPENDENT",
  "approvalActorMayDiffer": true
}
```

The API accepts a differing approval actor only when that exact policy is
present. Legacy/undeclared sign-offs remain fail-closed and still require the
same principal. `CorpusApprovalRecord.approvedBy` records the authenticated
actor who actually performed approval.

## VerifiedProfile legal-fact bridge

The AIUsageFlow callback has two representations:

- compact callback claims used by the existing API contract;
- sanitized `flow_data.claims` from the deterministic worker containing
  `claim_field`, `claim_value`, lifecycle, numeric confidence and conflict refs.

Previously only the compact list was persisted, so reconciliation lost the
field/value/confidence data required to reproduce legal applicability. The API
now joins the rich metadata onto each compact claim by stable `claim_id` before
writing the existing `AIUsageFlow.claims` JSON column. No schema migration or
inferred backfill is used.

`flow_data` remains optional for legacy callers, but when supplied it must be a
complete and consistent companion to the compact claims. The API rejects the
payload unless both claim representations have the same unique `claim_id` set,
the same evidence-ref set per claim, and each rich claim supplies a legal fact
field/value, lifecycle and finite numeric confidence in `[0,1]`. The rich
payload passes the same privacy/secret checks as the compact payload.

The VerifiedProfile worker now materializes three canonical legal-matching
views inside immutable `profile_data`:

- `merged_profile`: reconciled fact values for deterministic evaluation and
  explanation;
- `fact_evidence_refs`: field -> evidence-ref mapping for material legal facts;
- `evidence_refs`: aggregate union for audit/navigation only.

A claim contributes to `fact_evidence_refs` only when it is:

- a material claim (`is_material` is not false);
- `VALIDATED` or `VERIFIED`;
- confidence `>= 0.75`;
- backed by one or more evidence refs;
- free of unresolved conflict refs.

Claims outside that material gate may remain in `merged_profile` as context,
but they cannot independently establish either applicability or
non-applicability. Likewise, an aggregate or unrelated evidence ref cannot
satisfy another field's required fact. The rule evaluator requires evidence on
the exact field before using its value for a match or mismatch decision.

The API `GetVerifiedProfileById` projection now reads only these canonical
fields. Legacy profile payloads without `merged_profile`/`fact_evidence_refs`
fail closed instead of treating the whole profile JSON or unrelated evidence as
a legal fact source.

## Rule Catalog quality gate

Rule applicability evaluation now distinguishes three states that were
previously conflated:

- evidence-backed required fact matched -> candidate may become `MATCHED`;
- evidence-backed required fact is known and different -> `NOT_APPLICABLE`;
- required fact is unknown, unbacked, unclear or not determinable ->
  `BLOCKED_UNKNOWN_FACT` under the fail-closed path.

An unbacked mismatch may not be used to exclude a legal obligation. Similarly,
a blocking fact already present in `merged_profile` is actionable only when its
exact field has eligible evidence. Under `BLOCK_ON_UNKNOWN`, a present but
unknown/unbacked blocking fact blocks the decision rather than silently making
the rule match or become inapplicable.

`NOT_DETERMINABLE_FROM_CODE` is explicitly treated as unknown and cannot be used
as a positive fact proving that a legal obligation applies or has been
violated. Unknown markers inside list-valued facts are also treated as unknown.

Malformed or empty `requiredFacts` now fail closed as `BLOCKED_UNKNOWN_FACT`.
They can no longer behave like a zero-condition rule and become `MATCHED` merely
because the VerifiedProfile contains some evidence reference.

List-valued facts use containment semantics only after the required field has
eligible evidence backing. Blocking facts with an `expectedValue` exclude a
rule only when the evidence-backed actual value matches that expected value.

## Law 134 baseline Rule Catalog authoring

`apps/api/scripts/author-law-134-baseline-catalog.ts` now behaves as a guarded
authoring utility rather than an approval utility:

- duplicate/empty rule IDs are rejected;
- every candidate needs required facts and citation locators;
- unknown values (`UNKNOWN`, `UNCLEAR`, `NOT_DETERMINABLE_FROM_CODE`), including
  unknown markers nested in expected-value arrays, cannot be authored as
  positive required facts;
- only three Article 11/12 review candidates are authored into the DRAFT catalog;
- production approval from this script is blocked while the known applicability
  data-model gaps remain;
- an accidental approval request fails before any catalog/rule write, preventing
  an orphan DRAFT from being created by the blocked path.

### Deferred high-risk and medium-risk families

Articles 9, 10, 13 and 14 are deferred because the current scanner's
`HARM_POTENTIAL_SIGNAL` is only a technical heuristic. It may be emitted from a
domain package or a high-stakes-looking function name such as an approval,
rejection or risk-assessment call. That is not sufficient evidence that the
legal high-risk applicability test has been satisfied.

The current deferred reasons are:

```text
art-9  -> HIGH_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED
art-10 -> HIGH_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED
art-13 -> HIGH_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED
art-14 -> HIGH_RISK_AND_LEGAL_ROLE_APPLICABILITY_NOT_EVIDENCE_BACKED
art-15 -> MEDIUM_RISK_APPLICABILITY_NOT_EVIDENCE_BACKED
```

Article 15 is also deferred because legal matching is an input to risk
classification. A disclosure gap cannot itself prove that a system belongs to
the medium-risk class without creating a circular classification dependency.

The remaining Article 11/12 candidates are still role-sensitive. Because the
current VerifiedProfile does not yet expose an evidence-backed legal role
(provider/deployer/developer/user), the script reports
`LEGAL_ROLE_APPLICABILITY_NOT_MODELED_IN_VERIFIED_PROFILE` and deliberately
rejects a production approval request. The catalog must stay DRAFT until that
applicability dimension is modeled and the rules are re-authored/reviewed.

## Verification targets

The branch adds/extends tests for:

- reviewed full-text publication scope;
- exclusion of hierarchy/boundary-only content;
- bilateral Article 33 repeal confirmation;
- reviewed-dir/source-manifest handoff;
- exact reviewed source provenance;
- rich/compact AIUsageFlow claim preservation and consistency without a DB migration;
- VerifiedProfile `merged_profile` and field-level evidence projection;
- the `>= 0.75` material legal-fact eligibility threshold;
- exclusion of non-material, conflicted and lower-confidence claims from material fact backing;
- rejection of unrelated/global evidence as backing for a required field;
- evidence-backed mismatch versus unbacked/unknown fact behavior;
- evidence requirements for blocking-fact decisions;
- `NOT_DETERMINABLE_FROM_CODE` and unknown-list blocking;
- malformed/empty required-fact fail-closed behavior;
- additive list matching;
- independent technical review/approval audit-principal sign-off policy.

CI remains the final repository-level verification gate before merge.

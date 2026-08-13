# Legal Classification and Gap Tool Tasks

Status: DELIVERED  
Stories: AO-3 — Missing-Input Orchestration; AO-5 — Classification & Gap Gates  
Template: `agentic-tool-implementation-task-template.md`

| Task ID / tool | Implementation instruction | Typed result and safety boundary | Required verification |
|---|---|---|---|
| `TASK-AO-5-01-get-legal-corpus-readiness` / `get_legal_corpus_readiness` | Resolve active pinned corpus/index and exact unavailable requirement. | Readiness/ref or `NEEDS_INPUT`/`BLOCKED`. | Inactive/stale/index-failed corpus. |
| `TASK-AO-5-02-retrieve-legal-basis` / `retrieve_legal_basis` | Retrieve bounded primary/parent/referenced stable chunks from pinned corpus. | Citation-safe chunks/refs only. | Scope/context caps and version pin. |
| `TASK-AO-5-03-get-legal-rule-match` / `get_legal_rule_match` | Resolve rule applicability, required facts, allowlist, coverage from artifact/corpus versions. | Match prerequisites/ref chain, no final legal conclusion. | Missing fact/corpus coverage and version mismatch. |
| `TASK-AO-5-04-validate-citation-set` / `validate_citation_set` | Deterministically validate presence, active status, allowlist, and corpus version. | Pass/fail reason with citation refs. | Repealed/out-of-list/version-mismatch cases. |
| `TASK-AO-5-05-get-classification-baseline` / `get_classification_baseline` | Produce deterministic baseline and prerequisite ledger from immutable inputs. | Baseline/ref or explicit blocked prerequisites. | Evidence/policy version trace. |
| `TASK-AO-5-06-validate-classification-proposal` / `validate_classification_proposal` | Gate a proposal on citation, overclaim, conflict, coverage, and transition state. | Gate verdict; never persist final classification. | Each failed gate and audit trace. |
| `TASK-AO-5-07-get-gap-requirements` / `get_gap_requirements` | Return pinned versioned requirement matrix for eligible classification. | Requirement refs/version only. | Unsupported classification and stale policy. |
| `TASK-AO-5-08-evaluate-gap-matrix` / `evaluate_gap_matrix` | Evaluate each row against cited evidence and coverage. | `SATISFIED`/`MISSING`/`CONTRADICTED`/`UNKNOWN`/`OUT_OF_COVERAGE`. | Trace per row; no implicit completion. |
| `TASK-AO-5-09-get-gap-evidence-trace` / `get_gap_evidence_trace` | Identify source layer behind an evidence deficit. | Trace/ref plus resolver requirement. | Correct resolver routing and privacy. |
| `TASK-AO-5-10-propose-gap-remediation` / `propose_gap_remediation` | Generate structured remediation candidate from a gap matrix row. | Proposal only; cannot close its own gap. | Anti-self-close and independent validation. |

## Definition of Done

- No tool makes a final legal conclusion or persists a final classification/gap decision.
- Every result is traceable to immutable technical/policy/corpus versions and citation allowlists.

## Executable Tool Packets

All packets inherit [shared-tool-contract.md](shared-tool-contract.md). Legal authority is the active pinned structure-first corpus and citation allowlist; an LLM may propose but cannot make a final legal conclusion, classification, or gap transition.

| Tool | Input → output | Execution and LLM context | Failure, seams, tests |
|---|---|---|---|
| `get_legal_corpus_readiness` | `assessmentId,pinnedCorpusVersionId?,effectiveDate` → corpus/index/rule-catalog refs and missing requirement | Resolve pinned historical version first, otherwise active approved corpus with READY index. LLM sees IDs/status only. | Draft/superseded/index-failed returns `NEEDS_INPUT`/`BLOCKED`. API corpus query/contracts; test absent, stale, failed index, valid historical pin. |
| `retrieve_legal_basis` | `verifiedProfileId`, pinned corpus/rule versions, fact/rule/chunk selectors and caps → primary/parent/referenced citation-safe chunks/refs, allowlist, audit | Structure-first exact ID then metadata/full-text; clause unit, parent, one-hop xref; filter effective/repealed status. LLM gets bounded excerpt/locator/context role only. | No arbitrary terms/versions; cap is explicit. Chroma retriever/consumer; test parent/xref, expired/repealed exclusion, historical pin. |
| `get_legal_rule_match` | verified profile/corpus/rule/retrieval refs → applicability ledger, required/missing/unknown facts, allowlist/coverage | Deterministic rule evaluator uses evidence-backed facts and confidence/coverage. LLM sees ledger only, never invents rule/conclusion. | Provider-only, low-confidence/material unknown/conflict/version mismatch block. Rule evaluator/match builder; test each. |
| `validate_citation_set` | corpus/match refs + `citationRefs[]` → per-ref and aggregate validation codes | Validate stable chunk/locator, context role, version, allowlist, effect/source status. Deterministic gate after proposal. | Fabricated/repealed/wrong-role/version citation fails. Citation validator/guardrail; test partial set and audit. |
| `get_classification_baseline` | verified profile + legal match/policy refs → immutable prerequisite ledger, constraints, eligible labels | Require current approved profile, no conflict, eligible match, complete citations/versions; calculate hard-rule baseline. LLM cannot override it. | Stale/conflict/incomplete coverage blocks. Classification service/worker; test all prerequisite failures. |
| `validate_classification_proposal` | baseline ref + schema proposal/citations → gate verdict, violations, safe next state | Apply schema, hard-rule, overclaim, conflict, citation, coverage, state transition; audit proposal hash. LLM proposal only. | Gate never persists final classification. Guardrails/risk calculator; test each individual gate, replay, model contradiction. |
| `get_gap_requirements` | completed classification plus legal/rule/policy refs → pinned requirement-matrix refs | Select obligations only for eligible classification/version. LLM gets requirement/locator refs only. | Block unsupported/stale/missing basis. Gap service/repository; test pin and status. |
| `evaluate_gap_matrix` | requirement matrix + evidence/profile/match/coverage refs → per-row status/citations/rationale/resolver route | Deterministic mapping returns only `SATISFIED|MISSING|CONTRADICTED|UNKNOWN|OUT_OF_COVERAGE`. LLM cannot change row without revalidation. | Missing citation/limited coverage/conflict explicit. Structured evaluator; test all five statuses. |
| `get_gap_evidence_trace` | `{gapId|rowRef}` → source layer, immutable refs, allowed resolvers | Follow row links to Wizard/scanner/profile/legal/citation/reconciliation. LLM receives exact next resolver only. | Missing provenance/tenant mismatch denied. Trace query/AO-3 map; test every layer. |
| `propose_gap_remediation` | gap-row ref + permitted templates + bounded rationale → draft remediation, target evidence, independent validation requirement | Generate schema-constrained candidate from pinned row/template; bind proposer run. It cannot close/update the row. | Stale row/self-close denied. Remediation service; test no mutation and independent validator. |

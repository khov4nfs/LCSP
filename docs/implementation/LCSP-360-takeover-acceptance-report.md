# LCSP-360 takeover acceptance

Status: implementation and focused recovery verified; clean full-corpus acceptance is still in progress. This report supersedes runtime claims in the earlier worker reports, without changing their historical evidence.

## Repository and authority

The takeover started on `fix/LCSP-360-corpus-driven-applicability` at `3417d75682b9c645f6f792cad596987219db92f0`, with the existing implementation uncommitted. The starting patch, file hashes, previous disposable database and observed rows were preserved outside Git. PR #427 remains Draft. No production deployment or `lcsp_dev` lifecycle changes are part of this acceptance.

The selected source is the existing eight-document v4 corpus, copied with original blob/chunk hashes into owned disposable databases. Seven documents are OPERATIVE. Law 71/2025/QH15 is REFERENCE_ONLY: readable and available as a legal-effect target, without independent assessment obligations. The corpus has 1,798 retrieval chunks, 3,263 structural nodes and 2,863 required review units under the corrected Article-title policy. No pinned source was edited or removed.

## Duplicate requirements: root cause and fix

The surviving previous database contains 199 distinct requirement IDs and 32 rules for run `b799f091-fb8e-41c3-976c-8f463557ff38`, version `23f5cadd-cf81-4784-a70d-e00782d1824f`. This was a Law 134-only run, not acceptance of the full eight-document corpus.

Twenty-two groups contain 44 excess requirement rows. The repeated rows bind the same operative claim and have identical normative fields, applicability, exceptions, qualifiers, context, bindings and source references. They are not distinct legal obligations merely sharing wording. There are 155 unique normative representations among the 199 rows.

The groups contain 66 rows: 14 covered by AssessmentRules and 52 NON_ASSESSABLE. The defect therefore also affected assessed obligations.

The Python check protected new authoring calls but did not recheck requirements already present in a restored draft. The API's binding checks tracked duplicates within each requirement and collected owners in a set; they did not reject multiple requirement owners of one operative claim. The last successful authoring segment restored these candidates without creating new requirements. The available evidence establishes this acceptance hole; it does not identify the precise historical call that first created each extra candidate.

The existing semantic-claim integrity validator now rejects a second requirement owner through `CLAIM_REQUIREMENT_MISMATCH`. Shared modifier claims remain allowed. Python authoring keeps stable candidate keys, serializes mutations, accepts exact retries and returns bounded owner diagnostics. The same integrity contract protects restored drafts, validation and submission. The preserved 199-row packet produced 44 owner failures when checked against the corrected owner gate. Later Article-title coverage changes add a separate structural requirement, so that earlier diagnostic count is not a complete revalidation under every subsequent change.

The old output was structurally invalid under the corrected ownership contract. Its old PASSED/ACTIVE state does not establish legal validity; a comprehensive independent legal verdict was not performed.

## Durable authoring: root cause and fix

The original draft save was an unconditional snapshot replacement. A late writer or retry could overwrite newer candidates, and restart needed the exact frozen inventory rather than a newly assembled approximation.

The existing PostgreSQL draft now has a monotonic `draftVersion`. SAVE holds the run lock, validates the typed partial candidate maps, checks the exact run and inventory revision, and uses compare-and-swap. An exact replay after a lost response returns the accepted version without advancing it. Changed stale snapshots fail with `STALE_AUTHORING_DRAFT`. LOAD returns the stored version. The Python mutation lock spans authoring and persistence; each successful mutation is durable before its acknowledgement. Failed saves stay dirty and retryable. Validation failure keeps the draft. Freeze restoration verifies the stored graph, fingerprint and identities; an actual inventory reopen invalidates downstream authoring authority.

Focused tests cover concurrent stale snapshots, lost responses, invalid candidate keys and shapes, rejected saves/loads, revision changes, replay and flush before validate/submit/pause/error/shutdown. Migration `20261025090000_authoring_draft_version` is additive; fresh replay of all 133 migrations and upgrade of a clone containing the previous 199 rows were verified.

Real-model/API recovery evidence:

| Case | Run | Observed result |
| --- | --- | --- |
| Budget pause | `7ece997e-6193-48de-b349-130edbc9b4dd` | Three acknowledged requirements at draft v3 survived Admin HTTP 202 resume unchanged; final v7, six requirements, one rule, PASSED/ACTIVE, zero duplicate owners. |
| Hard crash before local save acknowledgement | `8359ae14-791c-46de-98a9-f578d1aede2e` | Fault injector exited 73 after real HTTP SAVE committed v1. The same requirement JSON survived a new process and Admin HTTP 202 resume; final v9, six requirements, three rules, PASSED/ACTIVE, zero duplicate owners. |

The crash test used a cache-local fault injector, genuine model-authored candidates and the supported Worker failure API after worker death. It did not insert claims or mutate lifecycle rows directly.

## Source semantics and repair feedback

- Article titles can state the operative addressee. The old frontier excluded them while source support correctly refused claims owned by excluded nodes. Nonempty Article titles are now review units in both runtimes. A real Article 42 scope claim cites the title itself, without substituting an unrelated clause quote.
- Instructions preserve source-defined scope, triggers, OR/AND alternatives, exceptions, parent lead-ins, distinct clause branches and distinct permission/duty modalities. Native Agents make semantic decisions; deterministic checks protect source identity, support and relation structure. No second auditor, keyword classifier or fabricated assessment was introduced.
- Automatic release is limited to unreachable DEFINITION and CONTEXT claims. SCOPE, CONDITION, EXCEPTION, QUALIFIER, TEMPORAL_RULE and TRANSITION_RULE require explicit source-supported treatment.
- Unknown repeal targets retain `documentIdentifier`, `locator` and `reason`. Article 44's two out-of-corpus targets remain inspectable, with the source-stated date. Exact/subtree legal-effect tests preserve unaffected provisions rather than expiring a whole law.
- Nested schema errors now identify all invalid legal-effect target fields in one bounded response. Wrong support quotes return bounded pinned source text. Native filesystem errors use the existing argument fingerprint, so different repairs do not collapse into one global no-progress gap; unchanged repeated calls still stop.
- A full run exposed 108 missing-directory errors, all targeting valid but not-yet-created mirrored claim directories. Materialization now creates those empty operative workspace directories. It creates no candidates and preserves existing work. Native listing and reference-only exclusions are tested.
- Article 43 exposed a caller error: one 4,223-character explanation for all unresolved references was copied into 13 unit reasons, exceeding the API's existing 2,000-character limit. Waiting reasons are now deduplicated per owner and bounded in UTF-16 units; all reference IDs and claim facts remain intact. Replaying the retained real-model file passes HTTP validation without another provider call. The live harness now supplies the runner's existing retained-workspace argument, and terminal diagnostics retain the existing safe callback status/code.
- The same Article exposed misdirected citations: nested points inherited no external instrument because clause `title` was empty, although its source lead-in named the law being amended. The existing reference parser now follows explicit instrument identifiers through structural lead-ins. Parser revision `legal-structure-v5` creates new derived materializations; old pins remain readable. In the actual corpus, Article 43 changes from 19 RESOLVED/37 UNRESOLVED references to two cross-document RESOLVED/54 UNRESOLVED references, with no false local resolutions. A focused real-model/API run reviewed all 40 Article units, preserved 31 legal-effect claims, resolved two targets in reference-only Law 71 and retained 54 unresolved targets, with no rejected units or schema errors, then paused as configured.
- Provider errors retain their type across concurrent child calls. Provider cooldowns are honored. An explicit Admin resume can recover a failed MODEL_ERROR/RUNTIME_ERROR run while retaining valid reviews and drafts; terminal source/cancellation cases remain terminal.

The final focused Article 42/44 run `1e76628c-f71a-4f38-b0e1-10228b19a448` completed uninterrupted with eight of eight review units, 13 claims, six requirements, one rule, zero duplicate owners, zero missing-path errors, validator PASSED and API activation ACTIVE. Its 24 physical calls have complete accounting: 76,106 uncached input + 257,117 cached input = 333,223 inclusive input, 30,235 output, 363,458 total. Reasoning tokens (27,961) are included in output.

## Verification and cleanup

The Python suite passed 1,849 tests; 21 integrations were skipped in that process. The 13 database-gated discovery cases were exercised separately against owned PostgreSQL, leaving eight optional external integrations unchecked. Latest checks include 210 domain cases, 36 API/PostgreSQL cases, 12 Python frontier cases, eight resume-unit cases and 69 contract cases. Earlier isolated compliance-rule-set suites include the fresh lifecycle and reactivation databases. Full API TypeScript checking, source/test ESLint, API build, focused web/i18n and usage-recovery checks passed. The reference-dependency exhaustive test explored 1,085,691 states with no false deadlocks. Source graph updates ran with AST extraction only.

Deleted auditor/receipt/lease-scheduler tests were checked against the retained file/frontier tests: UTF-16 boundaries, ambiguous quotations, exact hashes, stable identities, cycles, changed-target invalidation, frozen authority, strict references, closures and no-progress remain covered. The captured historical tool-count fixture was restored unchanged. Active preparation code contains no retired auditor/HMAC tool references. Historical reports and applied migration history remain historical records.

The changed/untracked-file credential-pattern scan covered 204 paths with no credential matches. Private corpus exports, database dumps, fault injectors and model traces stay outside Git under `/home/khovan/.cache/lcsp360-takeover-20261025/`.

## Acceptance boundary and remaining evidence

The clean full-corpus run is pending: run `35aec286-f3da-4c02-8988-5876d5b7e43b`, database `lcsp360_final_clean_corpus8_20261025`. Failed or interrupted debugging runs are not clean reproducibility passes. Their valid reviews remain preserved, and unknown interrupted provider attempts are reported as unknown rather than assigned invented token totals.

The isolated HTTP harness starts the real built API, activates the real copied Legal Source and invokes the production outbox consumer seam. RabbitMQ transport is omitted from this harness. Focused browser verification covered English/Vietnamese activity views and responsive interaction; Chrome DevTools was unavailable. No production deployment, merge or independent model audit is claimed.

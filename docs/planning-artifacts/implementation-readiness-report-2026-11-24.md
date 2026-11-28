---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
includedFiles:
  prd:
    - docs/product/prd.md
  architecture:
    - docs/architecture/architecture.md
    - docs/architecture/assessment-antigravity-work-package-prompts.md
    - docs/architecture/assessment-module-audit-red-test-handoff.md
    - docs/architecture/assessment-shared-wallet-implementation-blockers.md
  epics:
    - docs/planning-artifacts/epics.md
  ux:
    - docs/planning-artifacts/canonical-ux-review-2026-06-25.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-11-24
**Project:** LCSP

## Document Discovery

### PRD

- `docs/product/prd.md` — canonical supplemental document; no PRD was found under `docs/planning-artifacts`.

### Architecture and Prompt 8 authority

- `docs/architecture/architecture.md`
- `docs/architecture/assessment-antigravity-work-package-prompts.md`
- `docs/architecture/assessment-module-audit-red-test-handoff.md`
- `docs/architecture/assessment-shared-wallet-implementation-blockers.md`

No whole/sharded duplicate architecture format was found under `docs/planning-artifacts`.

### Epics and stories

- `docs/planning-artifacts/epics.md`

No sharded duplicate was found.

## PRD Analysis

### Requirement governance

The selected PRD is explicitly marked `conditional` and `Historical pre-freeze documentation`. It states that canonical implementation identifiers live in `docs/specs/functional-requirements.md`; the `FR-E*` entries below are product-narrative aliases and must not be used as canonical story, implementation, acceptance, or traceability identifiers.

### Functional Requirements

- **FR-E1-1 — Create assessment:** Manager can create a new assessment with basic system identity and assessment owner metadata.
- **FR-E1-2 — Retired Developer invitation:** Developer invitation is retired from active MVP.
- **FR-E1-3 — Retired Developer policies:** Developer scoped policy assignment and revocation are retired from active MVP.
- **FR-E1-4 — Restrict Manager-only actions:** System must prevent non-Manager subjects from approving VerifiedProfile, running final classification, generating report, editing business Wizard answers, changing Manager decisions, inviting users or managing assessment settings.
- **FR-E2-1 — Capture WizardProfile:** Manager can answer Wizard questions covering purpose, sector, data type, user group, user impact, decision role, human oversight, external LLM usage and biometric/high-impact use indicators.
- **FR-E2-2 — Use business language:** Wizard questions must be phrased in business/legal language and avoid code-centric terms such as dependency, model call, CI, scanner, repo, API probe or AST unless hidden behind explanation.
- **FR-E2-3 — Show readiness without risk level:** When technical evidence is missing, system shows readiness checklist, missing evidence and preliminary indicators only.
- **FR-E2-4 — Set Wizard-only state:** After Wizard submission without technical evidence, system sets `mode = SELF_DECLARED_READINESS`, `classification_status = LOCKED_EVIDENCE_REQUIRED`, and `risk_level = not_available`.
- **FR-E3-1 — GitHub App read-only evidence path:** Manager can connect a selected repository and run a read-only scan for their own assessment; this is the MVP golden technical-evidence path.
- **FR-E3-2 — Superseded Local/CI evidence upload:** Local/CI scanner report upload is superseded; canonical `FR-050` means `AUTOMATIC_TRUSTED_SCAN_INITIATION`.
- **FR-E3-3 — Removed manual technical evidence JSON upload:** Manual technical evidence JSON upload maps to canonical `FR-051` and is removed from the product.
- **FR-E3-4 — Privacy flags validation:** System validates privacy flags for every technical evidence report.
- **FR-E3-5 — Superseded human technical attestation:** Structured human technical attestation maps to historical `FR-045` and `FR-046` and is superseded for active MVP.
- **FR-E4-1 — Schema completeness gate:** System validates required evidence groups: assessment ID, source type, system identifier, provenance, analysis/report version, timestamp, scope, privacy flags, technical profile, findings, signal confidence, and report hash.
- **FR-E4-2 — Technical profile dimensions:** System requires AI usage, data type, decision flow, and human oversight signal dimensions.
- **FR-E4-3 — Quality threshold gate:** System evaluates evidence quality according to Wizard context.
- **FR-E4-4 — Context-aware threshold:** Evidence requirements change by scenario criticality; low- and high-impact scenarios must not use identical minimum expectations.
- **FR-E5-1 — Compare WizardProfile and TechnicalProfile:** When WizardProfile is linked, system compares business/legal answers with technical evidence across critical fields; without WizardProfile, comparison is skipped.
- **FR-E5-2 — Generate Conflict Score:** System computes a Conflict Score for each conflict; it is the only score that can block workflow.
- **FR-E5-3 — Route technical conflicts to Manager:** Technical conflicts are routed to Manager in MVP; delegated clarification remains deferred and structured attestation remains superseded.
- **FR-E5-4 — Route business/legal conflicts to Manager:** Business/legal conflicts are routed to Manager.
- **FR-E5-5 — Manager resolves MVP conflicts:** Any conflict that can affect risk level creates a Manager conflict-resolution task; Manager resolution is required and sufficient to resume when evidence is adequate.
- **FR-E5-6 — Block critical unresolved conflicts:** Critical conflicts remain blocking until resolved.
- **FR-E6-1 — Preserve reconciled evidence context:** System preserves reconciled AIUsageFlow and technical-evidence context for EngineeringRule investigation.
- **FR-E6-2 — Lock classification until conditions pass:** Classification remains locked until evidence, schema, quality, EngineeringRule, and conflict gates pass; WizardProfile is optional when technical evidence is sufficient.
- **FR-E6-3 — Produce evidence-based risk output:** When unlocked, classification produces risk level, confidence, triggered rules, legal references, and source trace.
- **FR-E6-4 — Degrade or block when legal basis is missing:** Missing required legal rule or citation degrades or blocks classification instead of producing a final result.
- **FR-E6-5 — Preserve rule precedence:** Hard legal/compliance rules take precedence over LLM interpretation.
- **FR-E7-1 — Generate gap analysis after risk result:** System generates gap analysis only after valid evidence-based risk classification.
- **FR-E7-2 — Generate compliance document/report:** Manager can generate the final report only when classification and gap analysis are valid and no material/critical conflict remains unresolved.
- **FR-E7-3 — Support readiness-only export:** Manager may export readiness-only output without technical evidence, but it must not contain HIGH/MEDIUM/LOW.
- **FR-E7-4 — Superseded attestation disclosure:** Active reports must not depend on structured attestation.
- **FR-E8-1 — Audit Wizard answers:** System records Wizard answers, timestamps, Manager identity, and later versions.
- **FR-E8-2 — Audit technical evidence metadata:** System records evidence source, provenance, engine/tool/configuration versions, timestamps, scope, privacy flags, hash, and evidence status.
- **FR-E8-3 — Audit conflict resolution:** System records conflict score/type, resolver role, decision, rationale, and timestamps.
- **FR-E8-4 — Superseded human technical attestation audit:** Active audit covers authorization, triggers, evidence, conflict, classification, and documents without restoring attestation.
- **FR-E8-5 — Audit classification and generated documents:** System records classification output, rule/citation trace, gap analysis, generated-document version, and export timestamp.

**Total narrative functional requirements:** 37.

### Non-Functional Requirements

- **NFR-1:** Raw source code must not be sent to LLM.
- **NFR-2:** Raw source code must not be stored long term.
- **NFR-3:** GitHub App access must be read-only and limited to selected repositories for the MVP default path.
- **NFR-4:** Technical findings shown to Manager must avoid unnecessary source/code exposure.
- **NFR-5:** Secrets must be redacted before evidence snippets or summaries are stored.
- **NFR-6:** Risk classification must be repeatable for the same VerifiedProfile, legal corpus/rule version, and evidence version.
- **NFR-7:** Every final report must be traceable to assessment, evidence, rules, conflict resolutions, and document version.
- **NFR-8:** The legal corpus/rule version used for classification must be recorded.
- **NFR-9:** System must fail closed for missing critical evidence, missing legal trace, or unresolved material conflict.
- **NFR-10:** Manager-facing language must avoid technical implementation terms unless accompanied by a plain-language explanation.
- **NFR-11:** Any future delegated task must contain enough context to act without exposing unnecessary business data.
- **NFR-12:** Evidence statuses must be understandable to Manager users.
- **NFR-13:** MVP UI copy and documents should support Vietnamese as the primary language.
- **NFR-14:** Web UI should target common accessibility expectations for forms, status messages, and document review.

**Total non-functional requirements:** 14.

### Additional Requirements and Constraints

- LCSP is an evidence-based compliance platform, not a legal chatbot, certification service, formal legal-opinion service, or regulator-submission product.
- All asynchronous domain workloads belong to the Python Worker Platform; NestJS remains the synchronous API control plane.
- Real LLM providers are in active MVP scope; deterministic mock gateways are limited to tests/offline development.
- Material decisions, evidence, model runs, retrieval, classification, reports, and authorization outcomes require versioned audit trace and correlation.
- Raw prompts, raw source, secrets, and unnecessary source/code content must not enter persistent audit/telemetry records.
- State and output gates must fail closed; unresolved material/critical conflict blocks classification and final reporting.
- The PRD remains conditional and carries unresolved high-risk assumptions around Wizard completeness, legal-corpus reliability, and authorization/trusted-trigger abuse prevention.
- The PRD contains no requirement for prepaid wallets, top-up-to-credit conversion, direct-credit model tariffs, Admin Model Pricing, per-provider-call debit, negative balance, usage reconciliation, or compensation.

### PRD Completeness Assessment

The PRD is not sufficient authority for Prompt 8 implementation readiness. It is historical/conditional, delegates canonical requirement authority to `docs/specs/functional-requirements.md`, and provides no functional or non-functional requirement for Prompt 8 billing/pricing behavior. Prompt 8 currently originates from the Assessment audit/architecture plan rather than a canonical product requirement. Before implementation readiness can pass, the feature must either be adopted into the canonical requirements catalog with stable IDs and acceptance criteria or be backed by another explicitly approved product authority that the epics/stories trace to.

### UX

- `docs/planning-artifacts/canonical-ux-review-2026-06-25.md`

No sharded duplicate was found.

## Epic Coverage Validation

### Traceability rule used for this assessment

The PRD exposes 37 narrative aliases (`FR-E*`), while the epic artifact claims coverage only for canonical identifiers `FR-001..FR-056`. Neither document supplies a binding alias-to-canonical mapping. The matrix below therefore credits coverage only when a story's acceptance criteria materially implement the PRD requirement; a nearby topic or an epic-level coverage claim is not treated as proof.

### Epic FR Coverage Extracted

The epic artifact claims complete coverage of `FR-001..FR-056` through eight epics, active stories, and explicit negative/deferred guardrails. The relevant story-level paths for the PRD aliases are Epic 1 (workspace and RBAC), Epic 2 (assessment and Wizard), Epic 3 (repository evidence), Epic 4 (AIUsageFlow), Epic 5 (reconciliation), Epic 6 (legal matching), Epic 7 (classification), and Epic 8 (gaps, documents, and audit).

Prompt 8 billing is not part of that coverage map. The only adjacent entry is Story 7.3, which says provider calls have generic "budget controls". The epic artifact contains no wallet, credit tariff, microcredit, ledger, per-call debit, settlement, negative-balance, pricing administration, or compensation requirement/story.

### Coverage Matrix

| PRD FR  | Requirement summary                                                                                               | Epic/story evidence                                                                                                                    | Status                      |
| ------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| FR-E1-1 | Manager creates an assessment.                                                                                    | Epic 2, Story 2.1                                                                                                                      | Covered                     |
| FR-E1-2 | Developer invitation is retired from active MVP.                                                                  | Epic 1, Story 1.5 actively implements Developer invitation instead of retiring it.                                                     | **Missing / contradictory** |
| FR-E1-3 | Developer scoped policies are retired from active MVP.                                                            | Epic 1, Stories 1.5-1.7 actively implement Developer scope and policy behavior.                                                        | **Missing / contradictory** |
| FR-E1-4 | Restrict Manager-only actions.                                                                                    | Epic 1, Story 1.6                                                                                                                      | Covered                     |
| FR-E2-1 | Capture WizardProfile.                                                                                            | Epic 2, Story 2.2                                                                                                                      | Covered                     |
| FR-E2-2 | Use business/legal language in the Wizard.                                                                        | Epic 2, Story 2.2                                                                                                                      | Covered                     |
| FR-E2-3 | Show readiness without risk level.                                                                                | Epic 2, Story 2.3                                                                                                                      | Covered                     |
| FR-E2-4 | Set Wizard-only readiness and classification-lock state.                                                          | Epic 2, Story 2.3 defines the equivalent neutral locked state.                                                                         | Covered                     |
| FR-E3-1 | Use a read-only GitHub App as the golden evidence path.                                                           | Epic 3, Stories 3.1-3.5                                                                                                                | Covered                     |
| FR-E3-2 | Supersede Local/CI evidence upload with automatic trusted scan initiation.                                        | Epic 3, Stories 3.3 and 3.11                                                                                                           | Covered                     |
| FR-E3-3 | Remove manual technical-evidence JSON upload.                                                                     | Epic 3, Story 3.11                                                                                                                     | Covered                     |
| FR-E3-4 | Validate privacy flags for every technical evidence report.                                                       | Epic 3, Story 3.7                                                                                                                      | Covered                     |
| FR-E3-5 | Keep structured human technical attestation superseded.                                                           | Epic 3, Story 3.11 and cross-epic negative guardrail                                                                                   | Covered                     |
| FR-E4-1 | Enforce the complete technical-evidence schema gate.                                                              | Epic 3, Story 3.7                                                                                                                      | Covered                     |
| FR-E4-2 | Require the defined TechnicalProfile dimensions.                                                                  | Epic 3, Story 3.8                                                                                                                      | Covered                     |
| FR-E4-3 | Evaluate evidence quality against Wizard context.                                                                 | Epic 3, Stories 3.6-3.7 provide evidence sufficiency/quality gates.                                                                    | Covered                     |
| FR-E4-4 | Vary minimum evidence thresholds by scenario criticality.                                                         | No story specifies different low-impact and high-impact evidence thresholds.                                                           | **Missing**                 |
| FR-E5-1 | Compare WizardProfile and TechnicalProfile when WizardProfile exists.                                             | Epic 5, Story 5.1                                                                                                                      | Covered                     |
| FR-E5-2 | Compute Conflict Score as the only score permitted to block workflow.                                             | Story 5.2 defines the score as review prioritization and explicitly not legal risk, but does not define it as the sole blocking score. | **Missing / contradictory** |
| FR-E5-3 | Route technical conflicts to Manager.                                                                             | Epic 5, Stories 5.1-5.3                                                                                                                | Covered                     |
| FR-E5-4 | Route business/legal conflicts to Manager.                                                                        | Epic 5, Stories 5.1-5.3                                                                                                                | Covered                     |
| FR-E5-5 | Manager resolution is sufficient to resume when evidence is adequate.                                             | Epic 5, Stories 5.3 and 5.5                                                                                                            | Covered                     |
| FR-E5-6 | Keep critical unresolved conflicts blocking.                                                                      | Epic 5, Story 5.5                                                                                                                      | Covered                     |
| FR-E6-1 | Preserve reconciled AIUsageFlow and technical-evidence context for EngineeringRule investigation.                 | The evidence lineage is preserved, but no epic/story defines `EngineeringRule` investigation or its handoff contract.                  | **Missing**                 |
| FR-E6-2 | Keep classification locked until all gates pass; WizardProfile may be absent if technical evidence is sufficient. | Stories 5.5 and 7.1 require a VerifiedProfile whose generation requires WizardProfile, so the Wizard-optional path is absent.          | **Missing / contradictory** |
| FR-E6-3 | Produce evidence-based risk, confidence, rules, citations, and trace.                                             | Epic 7, Stories 7.2, 7.5, and 7.6                                                                                                      | Covered                     |
| FR-E6-4 | Degrade or block when legal basis/citation is missing.                                                            | Epic 6, Stories 6.6-6.7; Epic 7, Stories 7.5-7.6                                                                                       | Covered                     |
| FR-E6-5 | Preserve hard-rule precedence over model interpretation.                                                          | Epic 7, Story 7.2                                                                                                                      | Covered                     |
| FR-E7-1 | Generate gap analysis after valid classification.                                                                 | Epic 8, Story 8.1                                                                                                                      | Covered                     |
| FR-E7-2 | Generate final report only after valid classification/gaps and resolved conflicts.                                | Epic 8, Story 8.3                                                                                                                      | Covered                     |
| FR-E7-3 | Support readiness-only export without risk labels.                                                                | Epic 2, Story 2.4; Epic 8, Story 8.4                                                                                                   | Covered                     |
| FR-E7-4 | Keep reports independent of superseded attestation.                                                               | Cross-epic negative guardrail and Story 3.11                                                                                           | Covered                     |
| FR-E8-1 | Audit Wizard answers, Manager identity, timestamps, and versions.                                                 | Epic 8, Story 8.6, supported by versioning in Story 2.2                                                                                | Covered                     |
| FR-E8-2 | Audit technical-evidence provenance and status metadata.                                                          | Epic 3, Stories 3.7-3.10; Epic 8, Story 8.6                                                                                            | Covered                     |
| FR-E8-3 | Audit conflict score/type, resolution, rationale, and timestamps.                                                 | Epic 5, Stories 5.2-5.4; Epic 8, Story 8.6                                                                                             | Covered                     |
| FR-E8-4 | Audit active transitions without restoring attestation.                                                           | Cross-epic guardrail; Epic 8, Story 8.6                                                                                                | Covered                     |
| FR-E8-5 | Audit classification, rule/citation trace, gap analysis, documents, and export.                                   | Epic 7, Story 7.6; Epic 8, Stories 8.1 and 8.3-8.7                                                                                     | Covered                     |

### Missing Requirements

#### Critical: Prompt 8 has no canonical FR or implementation story

The shared-wallet/direct-credit design is absent from both the PRD FR inventory and the epic coverage map. Story 7.3's generic budget-control sentence cannot authorize or specify wallet balances, model tariff selection, immutable price assignment, atomic debit, insufficient-funds admission, usage settlement, negative-balance handling, reconciliation, or compensation.

**Impact:** RED contract tests can be drafted against the approved architecture decisions, but production implementation would have no canonical product traceability, story owner, acceptance criteria, or test evidence row.

**Recommendation:** Add stable canonical FR/NFR identifiers and a dedicated billing/pricing epic or coherent story set before production implementation. At minimum, cover the seven Prompt 8 enablement gates and map every requirement to acceptance criteria and test levels.

#### PRD-to-epic inconsistencies

- `FR-E1-2` and `FR-E1-3`: the PRD retires Developer invitation/scoped policies, while Epic 1 actively implements both.
- `FR-E4-4`: no low-impact versus high-impact evidence-threshold behavior is specified.
- `FR-E5-2`: the sole-blocking-score invariant is not represented.
- `FR-E6-1`: no EngineeringRule investigation/handoff is defined.
- `FR-E6-2`: the PRD allows classification without WizardProfile when technical evidence is sufficient, but the epic flow requires WizardProfile through VerifiedProfile generation.

These discrepancies must be resolved against current product authority rather than repaired by guessing. In particular, the current user-approved system direction is RBAC-only with no organization model, while the historical epic artifact repeatedly assumes organization scope; that governance conflict will be evaluated in the architecture-alignment step.

### Coverage Statistics

- Total PRD narrative FRs: **37**
- Materially covered by epic/story acceptance criteria: **31**
- Missing or contradictory: **6**
- Effective coverage: **83.8%**
- Prompt 8 billing FRs covered: **0**, because no canonical Prompt 8 FRs exist in the evaluated PRD/epic artifacts.

## UX Alignment Assessment

### UX Document Status

UX documentation exists at `docs/planning-artifacts/canonical-ux-review-2026-06-25.md`, but it is explicitly historical pre-freeze material and says that the review alone does not authorize implementation. It covers the assessment evidence/classification journey; it does not cover Prompt 8 billing or pricing operations.

### UX ↔ PRD Alignment

- The assessment, Wizard, repository evidence, conflict, VerifiedProfile, legal citation, classification, report, and audit journeys substantially reflect the PRD narrative requirements.
- The UX review still describes an optional Developer workspace, while the PRD and current architecture retire Developer invitation/task collaboration from active MVP. This is an authority mismatch, not merely missing copy.
- The UX review has no user journey, screen state, or acceptance rule for shared wallet balance, top-up, outstanding balance, per-invocation charge history, `PAYMENT_REQUIRED`, or manual Continue after top-up.
- The UX review has no Admin Model Pricing journey for mutable drafts, preview, immutable publish, scheduled/active assignment, fallback-resolution visibility, or audit history.
- The UX review has no operator UX for unknown usage, late receipts, reconciliation, waiver/compensation, or billing-integrity review.

### UX ↔ Architecture Alignment

The Prompt 8 architecture documents require Admin pricing UI/browser verification and customer/admin charge analytics, but do not provide a UX artifact defining the screens, permissions, states, copy keys, validation, concurrency feedback, or recovery behavior. The architecture supplies backend invariants but cannot substitute for product UX acceptance criteria.

Architecture-support gaps that must be resolved in UX/story form include:

1. Customer balance must distinguish `spendableCredits` from `outstandingCredits` without exposing signed-ledger internals ambiguously.
2. Top-up must explain that funds first clear outstanding usage and do not automatically resume an assessment.
3. The paused runtime must expose a deliberate Continue action and preserve independent no-progress blockers.
4. Charge history must group physical invocations under a logical operation while showing retries/fallbacks as separately billable calls.
5. Admin pricing must make draft versus immutable published snapshot unmistakable and show effective intervals/fallback scope before publish.
6. Stale-version, interval-overlap, idempotent replay, incomplete usage, and compensation outcomes need safe actionable UI states.
7. Customer/admin views must avoid raw prompts/content while still exposing enough provider/model, token-bucket, price-version, and correlation metadata to dispute or audit a charge.

### Warnings

- **Implementation blocker for frontend scope:** Prompt 8 has no approved UX specification or story-level UX acceptance criteria.
- **Historical authority conflict:** optional Developer UX remains in the UX review and epics although the PRD/current architecture retire it.
- **Localization/accessibility gap:** no Vietnamese copy keys or accessibility behavior exist for financial states and pricing administration.
- **Architecture aging:** the selected system architecture is itself historical and points to newer freeze/runtime authorities, so it cannot by itself close Prompt 8 readiness.

### UX Readiness Verdict

Assessment-core UX is usable as historical planning context, subject to the Developer-scope conflict. Prompt 8 UX is **NOT READY** for implementation. Backend contract RED tests may proceed, but web implementation should wait for a reviewed Prompt 8 UX/story specification covering the journeys and states above.

## Epic Quality Review

### Epic-level validation

| Epic                                                   | User-value focus                                                                                                         | Dependency direction                                                                                                                              | Quality verdict              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1 — Secure Workspace and RBAC-Scoped Collaboration     | Mixed: authentication and controlled access provide user value, but Stories 1.7-1.10 are platform/governance milestones. | Fails within-epic ordering: Stories 1.1-1.6 already require RBAC, audit, event, localization, and contract behavior introduced later in 1.7-1.10. | **Major revision required**  |
| 2 — Manager Assessment and Wizard Readiness            | Clear Manager value.                                                                                                     | Depends only on Epic 1 conceptually, but inherits the unresolved organization model and audit foundations.                                        | **Conditionally acceptable** |
| 3 — Trusted Repository Evidence and TechnicalProfile   | Clear Manager evidence outcome.                                                                                          | Correct high-level dependency on Epics 1-2; Story 3.5 precedes the governing failure/eligibility policy in Story 3.6.                             | **Major revision required**  |
| 4 — AIUsageFlow Claims and Uncertainty                 | Clear reviewable assessment value despite system-oriented story wording.                                                 | Correctly consumes prior evidence; conflict-candidate ownership overlaps Epic 5.                                                                  | **Revision required**        |
| 5 — Reconciliation and VerifiedProfile                 | Clear Manager decision and approval value.                                                                               | Correctly consumes Epics 2-4, but conflicts with the PRD's Wizard-optional classification path.                                                   | **Major revision required**  |
| 6 — Legal Corpus Retrieval and LegalRuleMatch Evidence | Delivers internal-operator and downstream legal-evidence value; Story 6.4 is a technical implementation story.           | Correctly consumes VerifiedProfile from Epic 5; internal corpus preparation can be delivered independently.                                       | **Conditionally acceptable** |
| 7 — Citation-Backed Classification                     | Clear Manager classification/blocked-state value.                                                                        | Correctly consumes Epics 5-6; Story 7.3's unspecified budget control is insufficient for Prompt 8.                                                | **Major revision required**  |
| 8 — Gap Analysis, Guarded Documents, and Audit Trail   | Clear Manager reporting/audit value.                                                                                     | Correctly consumes classification, but Story 8.6 defines assessment audit after Stories 8.1-8.5 already require audit side effects.               | **Major revision required**  |

### Critical Violations

#### CQ-01 — Prompt 8 has no epic or stories

The requested shared-wallet/direct-credit capability has no user story, acceptance criteria, dependency sequence, migration story, security story, operational rollout story, or test trace. Story 7.3's phrase "budget controls" is neither the same capability nor sufficient specification.

**Remediation:** create a dedicated billing/pricing epic or a coherent cross-epic story set after canonical Prompt 8 FRs are approved. Sequence it as contracts/calculator → migration shadowing → pricing publication → admission binding → shadow settlement/reconciliation → debit enablement → customer/admin UX and operational compensation.

#### CQ-02 — Story authority conflicts with current product direction

Stories 1.4-1.7, 2.1, 3.1, 3.9, 5.6, 6.7, 8.5, 8.6, and 8.7 repeatedly require organization scope or optional Developer collaboration. The current approved direction is RBAC-only, no organization model, and the PRD/current architecture retire Developer invitation/task collaboration.

**Remediation:** resolve and rebase the canonical FRs, UX, epics, contracts, and authorization vocabulary before implementation. Do not mechanically replace `organizationId` without defining the actual customer/user ownership boundary.

#### CQ-03 — Foundational stories are ordered after their consumers

- Stories 1.1-1.6 require audited RBAC decisions, but canonical RBAC runtime and audit/outbox behavior are not introduced until Stories 1.7 and 1.8.
- Earlier auth/blocked-state stories require stable contracts and localized keys, while Story 1.10 establishes those boundaries last.
- Stories 8.1-8.5 require audit side effects, while Story 8.6 defines the assessment audit trail afterward.

This creates forbidden forward dependencies and prevents the earlier stories from being independently complete.

**Remediation:** move shared contract/localization, minimal deny-by-default RBAC, and foundational audit/event slices ahead of the first consumer, or include the minimum vertical slice in each consuming story and reserve later stories for expansion rather than initial authority.

### Major Issues

#### MQ-01 — Evidence policy arrives after repository analysis

Story 3.5 creates repository-analysis evidence before Story 3.6 defines failure severity, coverage, and downstream eligibility. Story 3.6 itself says implementation remains blocked until that policy is approved.

**Remediation:** approve and implement the minimal evidence-acceptance policy before, or as part of, the first evidence-producing story.

#### MQ-02 — Duplicate conflict-detection ownership

Story 4.5 detects Wizard/technical conflict candidates, and Story 5.1 again detects material conflicts across the same artifacts. The boundary between candidate generation and authoritative reconciliation is not precise enough to prevent duplicate or inconsistent conflict records.

**Remediation:** define one authoritative conflict aggregate owner. Let Epic 4 emit non-authoritative comparison signals, or remove its detection responsibility and keep all material conflict creation in Epic 5.

#### MQ-03 — Several acceptance criteria defer essential behavior to undefined policy

Examples include:

- Story 1.8: "where supported" and "according to the domain failure policy".
- Story 1.9: canonical retry budget, lock timeout, DLQ, and replay behavior without binding values or decision references.
- Story 3.6: repository-analysis evidence policy not included.
- Stories 5.1 and 5.5: materiality/gate policy not defined.
- Story 7.3: budget controls not defined.
- Story 8.6: audit failure policy not defined.

These criteria are not independently testable until the referenced policies become approved versioned artifacts.

**Remediation:** replace vague policy references with stable decision IDs, enumerated outcomes, ownership, and measurable acceptance limits.

#### MQ-04 — Wizard-optional PRD path is structurally impossible

The PRD permits classification without WizardProfile when technical evidence is sufficient. Story 5.5 requires WizardProfile to create VerifiedProfile, and Story 7.1 requires approved VerifiedProfile for classification.

**Remediation:** either remove the Wizard-optional requirement from current authority or add an explicit technical-evidence-only VerifiedProfile path with equivalent approval, uncertainty, legal-match, and audit gates.

#### MQ-05 — Brownfield migration/compatibility work is absent for Prompt 8

The repository is brownfield and already contains legacy credit units, model-pricing snapshots, usage telemetry, and runtime override routes. The architecture identifies a mixed-unit migration and cutover, but no story owns writer fencing, backfill, reconciliation, rollback, or old-path retirement.

**Remediation:** create explicit migration/cutover stories with RED/GREEN evidence and rollback acceptance criteria; do not hide them inside a generic implementation story.

#### MQ-06 — Story 1.9 and Story 6.4 are technical milestones

The Python Worker Platform contract and ChromaDB index construction are written primarily as infrastructure delivery. They can be legitimate enablers in a brownfield program, but their current wording does not demonstrate independently consumable user/operator value.

**Remediation:** frame them as vertical outcomes (replay-safe processing visible to operators; approved corpus becomes queryable with validated counts/provenance) and retain technical details in implementation notes.

### Minor Concerns

- Several stories bundle API behavior, persistence, UI, audit, authorization, and failure recovery into one large story (notably 3.9, 6.7, 7.6, and 8.7). Split when a single RED-to-GREEN cycle cannot verify the whole slice.
- Acceptance criteria use alternatives such as "rejects or corrects", "blocks or degrades", and "blocks, retries, or marks degraded" without a decision table. Each input condition needs one deterministic expected outcome.
- Epic coverage claims `PASS` internally despite acknowledging missing AC-level trace rows and decision artifacts; that self-verdict should not be used as readiness evidence.
- No starter-template story is required because this is an existing brownfield repository; the missing concern is migration compatibility, not greenfield bootstrapping.

### Epic Quality Verdict

The assessment workflow has a broadly sensible dependency spine and many strong BDD-style acceptance criteria, but it is not implementation-ready as a backlog. Prompt 8 is absent, foundational dependencies are ordered after consumers, current product authority conflicts with organization/Developer stories, and multiple critical policies remain non-testable placeholders.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY for Prompt 8 production implementation or debit enablement.**

**READY only for requirements correction, story/UX authoring, architecture-spike closure, and contract RED tests.** The existing Prompt 8 architecture is sufficiently detailed to define those tests, but it is not sufficient authority or operational evidence for activating financial writes.

### Critical Issues Requiring Immediate Action

1. **No canonical Prompt 8 product requirement:** the PRD has no shared-wallet, tariff, per-invocation debit, settlement, debt, reconciliation, or compensation FR/NFR.
2. **No Prompt 8 implementation backlog:** the epics contain no dedicated billing/pricing story or acceptance criteria; Story 7.3's generic budget control is insufficient.
3. **No Prompt 8 UX specification:** customer wallet/top-up/charge-history/pause-and-Continue flows and Admin Model Pricing/reconciliation flows are undefined.
4. **Current authority is internally inconsistent:** historical epics/UX assume organization scope and active Developer collaboration, while the approved direction is RBAC-only, no organization model, and retired Developer invitation/task collaboration.
5. **Six PRD requirements lack valid epic coverage:** `FR-E1-2`, `FR-E1-3`, `FR-E4-4`, `FR-E5-2`, `FR-E6-1`, and `FR-E6-2` are absent or contradicted.
6. **Backlog ordering contains forward dependencies:** RBAC, audit/outbox, and contract/localization foundations appear after stories that already require them.
7. **All seven Prompt 8 production enablement gates remain open:** approved tariff values; admission-to-settlement binding; mixed-version microcredit cutover; bounded maximum monetary exposure; immutable pricing assignment/interval enforcement; mandatory admission on every provider-call path; and versioned/idempotent reconciliation-compensation.

### Recommended Next Steps

1. **Establish product authority.** Add stable canonical Prompt 8 FR/NFR identifiers covering shared-wallet ownership, top-up, direct-credit tariff resolution, per-physical-invocation charging, debt projection, pause/Continue, reconciliation, compensation, privacy, audit, and admin pricing governance.
2. **Reconcile stale scope.** Decide and document the final ownership vocabulary for an RBAC-only/no-organization system, remove active Developer collaboration from current MVP artifacts, and update PRD, architecture, UX, epics, contracts, and tests consistently.
3. **Create the Prompt 8 epic/story sequence.** Include explicit brownfield migration/cutover stories and map every FR to story AC IDs, test level, owner, and evidence artifact.
4. **Create and approve Prompt 8 UX.** Specify customer wallet/top-up/outstanding balance/charge history/Continue behavior and Admin pricing draft-preview-publish/history/reconciliation behavior, including Vietnamese copy and accessibility states.
5. **Write contract RED tests only.** Lock microcredit parsing/formatting, tariff resolution, immutable assignment, calculator parity, payment idempotency, admission authority, settlement idempotency, signed projection, pause/Continue, unknown usage, and compensation invariants before production changes.
6. **Close gates in controlled phases.** Prove shadow-unit migration and rollback; pricing publication constraints; mandatory admission inventory; maximum exposure; shadow settlement reconciliation; and operator compensation before enabling debit.
7. **Require a second readiness gate.** Re-run this workflow after canonical artifacts and RED-test receipts exist. Production implementation may begin only when the relevant story is traceable and its prerequisite gates are objectively closed; debit enablement remains a later operational decision.

### Decision Boundary for the Current Team

| Work type                                  | May start now? | Condition                                                                                     |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------- |
| Canonical requirements and story authoring | Yes            | Must resolve RBAC/no-organization/Developer scope first.                                      |
| Prompt 8 UX design and acceptance criteria | Yes            | Must use approved financial terminology and server-authoritative states.                      |
| Contract RED tests                         | Yes            | Tests must fail against current behavior and must not require invented tariff values.         |
| Production pricing/wallet implementation   | No             | Requires approved stories plus the applicable enablement-gate designs/tests.                  |
| Production model-usage debit enablement    | No             | Requires all seven gates, GREEN evidence, reconciliation, rollback, and operational approval. |
| Paid-tool billing                          | No             | Explicitly deferred outside Prompt 8.                                                         |

### Final Note

This assessment identified **12 material issues across five categories**: requirement authority, traceability, UX alignment, epic/story quality, and financial enablement safety. The strongest part of the current package is the Prompt 8 architectural invariant set; the weakest part is its absence from canonical product/backlog/UX authority. Do not discard the architecture work—use it to author the missing canonical artifacts and RED tests, then repeat readiness review before production implementation.

**Assessment date:** 2026-11-24
**Assessor:** Codex using `bmad-check-implementation-readiness`

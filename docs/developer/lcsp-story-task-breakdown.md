# LCSP Story-Task Breakdown

Regenerated backlog model for the next Jira project.

## Operating Model

- `Epic` = business module.
- `Story` = acceptance and traceability anchor linked to an implementation artifact.
- `Task` = smallest shippable feature slice under one story, assigned directly to a dev owner.
- `Sub-task` = removed from this operating model.

## Summary

| Epic | Feature Tasks | Story Refs | Points | Primary Owners |
|---|---:|---|---:|---|
| Epic 1 - Authentication and Access Control | 30 | `1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10` | 41 | `L`, `A` |
| Epic 2 - Assessment and Wizard | 16 | `2.1, 2.2, 2.3, 2.4` | 20 | `L`, `C`, `A` |
| Epic 3 - Repository Scan and Technical Evidence | 38 | `3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11` | 50 | `L`, `B`, `C` |
| Epic 4 - AI Usage Analysis | 19 | `4.1, 4.2, 4.3, 4.4, 4.5, 4.6` | 27 | `C`, `A` |
| Epic 5 - Reconciliation and Verified Profile | 21 | `5.1, 5.2, 5.3, 5.4, 5.5, 5.6` | 27 | `L`, `A`, `C` |
| Epic 6 - Legal Corpus and Matching | 22 | `6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7` | 32 | `D` |
| Epic 7 - Classification | 19 | `7.1, 7.2, 7.3, 7.4, 7.5, 7.6` | 29 | `L`, `D`, `A` |
| Epic 8 - Reporting and Audit | 22 | `8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7` | 29 | `D`, `A`, `L` |

## Owner Totals

| Owner | Task Points |
|---|---:|
| `A` | 55 |
| `B` | 29 |
| `C` | 47 |
| `D` | 57 |
| `L` | 67 |

## Epic 1 - Authentication and Access Control

Stories: `1.1`, `1.2`, `1.3`, `1.4`, `1.5`, `1.6`, `1.7`, `1.8`, `1.9`, `1.10`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E1-S11-F1 Approved Account Entry and Workspace Access` | 3 | `L` | `1.1` | `none` | `D1-D5` |
| `E1-S12-F1 Model MFA enrollment/challenge/recovery state separate from base session and keep membership/RBAC gate intact` | 2 | `A` | `1.2` | `E1-S11-F1` | `D1-D5` |
| `E1-S12-F2 Add OTP validation rules for invalid, expired, replayed and rate-limited attempts before workspace access is granted` | 1 | `A` | `1.2` | `E1-S12-F1` | `D1-D5` |
| `E1-S12-F3 Implement session expiry/revocation handling so protected routes fail closed with safe recovery/sign-in actions` | 1 | `A` | `1.2` | `E1-S12-F2` | `D1-D5` |
| `E1-S12-F4 Audit MFA/recovery/profile-safety success and failure paths without exposing secret values in UI, API, logs or audit records` | 1 | `A` | `1.2` | `E1-S12-F3` | `D1-D5` |
| `E1-S13-F1 Implement OAuth/OIDC callback validation for redirect URI, state, nonce, issuer, audience and expiry` | 2 | `A` | `1.3` | `E1-S12-F4` | `D6-D10` |
| `E1-S13-F2 Create LCSP identity/session only after safe account linking` | 1 | `A` | `1.3` | `E1-S13-F1` | `D6-D10` |
| `E1-S13-F3 Harden audit and blocked state handling so login never creates repository authorization` | 1 | `A` | `1.3` | `E1-S13-F2` | `D6-D10` |
| `E1-S14-F1 Materialize active organization/workspace context for authenticated users` | 2 | `L` | `1.4` | `E1-S13-F3` | `D11-D15` |
| `E1-S14-F2 Bind Manager subject attributes and policy versioning into RBAC evaluation context` | 1 | `L` | `1.4` | `E1-S14-F1` | `D11-D15` |
| `E1-S14-F3 Project safe allow/deny results into workspace UX while auditing server-side decisions` | 1 | `L` | `1.4` | `E1-S14-F2` | `D11-D15` |
| `E1-S15-F1 Add Developer invitation issuance, acceptance and scoped membership/policy binding` | 2 | `A` | `1.5` | `E1-S14-F3` | `D6-D10` |
| `E1-S15-F2 Persist optional collaborator scope without making Developer mandatory for Manager golden path` | 1 | `A` | `1.5` | `E1-S15-F1` | `D6-D10` |
| `E1-S15-F3 Audit invitation lifecycle, scope assignment and revocation-safe acceptance behavior` | 1 | `A` | `1.5` | `E1-S15-F2` | `D6-D10` |
| `E1-S16-F1 Enumerate Manager-only actions and wire RBAC-protected API guard plus service recheck` | 2 | `L` | `1.6` | `E1-S15-F3` | `D11-D15` |
| `E1-S16-F2 Hide or block Manager-only UX actions based on backend capability projection` | 1 | `L` | `1.6` | `E1-S16-F1` | `D11-D15` |
| `E1-S16-F3 Audit allow/deny with policy id/version and correlation ID` | 1 | `L` | `1.6` | `E1-S16-F2` | `D11-D15` |
| `E1-S17-F1 Implement evaluator contract for subject, organization, resource, action, context and policy version` | 2 | `L` | `1.7` | `E1-S16-F3` | `D11-D15` |
| `E1-S17-F2 Define fail-closed behavior for cache miss, evaluator failure and missing policy/state gate` | 1 | `L` | `1.7` | `E1-S17-F1` | `D11-D15` |
| `E1-S17-F3 Persist `AuthorizationDecision` and expose safe failure reasons to callers` | 1 | `L` | `1.7` | `E1-S17-F2` | `D11-D15` |
| `E1-S18-F1 Define foundational audit event schema for auth/RBAC/session and early workflow actions` | 2 | `L` | `1.8` | `E1-S17-F3` | `D1-D10` |
| `E1-S18-F2 Introduce outbox ownership and event naming conventions for future async domains` | 1 | `L` | `1.8` | `E1-S18-F1` | `D1-D10` |
| `E1-S18-F3 Ensure append-only audit plus correlation ID propagation across sync-to-async boundary` | 1 | `L` | `1.8` | `E1-S18-F2` | `D1-D10` |
| `E1-S19-F1 Define command/event schemas and handoff envelope for Python worker platform` | 2 | `L` | `1.9` | `E1-S18-F3` | `D1-D10` |
| `E1-S19-F2 Set idempotency, lease, retry/DLQ and replay expectations shared by all workers` | 1 | `L` | `1.9` | `E1-S19-F1` | `D1-D10` |
| `E1-S19-F3 Align API outbox publisher and worker consumer contracts before scanner/legal flows start` | 1 | `L` | `1.9` | `E1-S19-F2` | `D1-D10` |
| `E1-S110-F1 Define or refine public exports for auth/workspace problem contracts, required actions, locale-safe DTOs, and blocked-state keys` | 2 | `A` | `1.10` | `E1-S11-F1` | `D1-D5` |
| `E1-S110-F2 Define typed `vi/en` dictionaries and resolver helpers in `packages/i18n` without placing customer-facing prose inside `packages/contracts`` | 1 | `A` | `1.10` | `E1-S110-F1` | `D1-D5` |
| `E1-S110-F3 Update API, Web, and tests to consume public package exports only and fail typecheck if shared contract shape drifts` | 1 | `A` | `1.10` | `E1-S110-F2` | `D1-D5` |
| `E1-S110-F4 Add repository validation and tests that cover key-based blocked-state rendering plus import-policy enforcement` | 1 | `A` | `1.10` | `E1-S110-F3` | `D1-D5` |

## Epic 2 - Assessment and Wizard

Stories: `2.1`, `2.2`, `2.3`, `2.4`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E2-S21-F1 Create assessment aggregate with Manager ownership, organization scope and initial workflow state` | 2 | `L` | `2.1` | `none` | `D6-D10` |
| `E2-S21-F2 Add create-assessment UI/API path with RBAC gating and safe denial handling` | 1 | `L` | `2.1` | `E2-S21-F1` | `D6-D10` |
| `E2-S21-F3 Scaffold Wizard entry surfaces from assessment overview, including Wizard landing and initial section-progress projection` | 1 | `L` | `2.1` | `E2-S21-F2` | `D6-D10` |
| `E2-S21-F4 Emit audit event and neutral readiness/Wizard entry projection after creation without implying any legal/risk result` | 1 | `L` | `2.1` | `E2-S21-F3` | `D6-D10` |
| `E2-S22-F1 Implement the two-phase Wizard flow: `pre-screen` followed by detailed sectioned intake` | 2 | `C` | `2.2` | `E2-S21-F4` | `D6-D10` |
| `E2-S22-F2 Implement the wizard question registry and structured field mapping from `WIZARD-MAPPING.md` for all critical facts` | 1 | `C` | `2.2` | `E2-S22-F1` | `D6-D10` |
| `E2-S22-F3 Persist versioned WizardProfile drafts/submissions with business-language validation and explicit unknown-state support` | 1 | `C` | `2.2` | `E2-S22-F2` | `D6-D10` |
| `E2-S22-F4 Add progressive disclosure/examples and helper-drawer hooks while keeping code-centric terms out of Manager UX` | 1 | `C` | `2.2` | `E2-S22-F3` | `D6-D10` |
| `E2-S23-F1 Project readiness-only overview when WizardProfile exists but technical evidence does not` | 2 | `A` | `2.3` | `E2-S22-F4` | `D11-D15` |
| `E2-S23-F2 Lock classification with neutral status and missing-evidence checklist` | 1 | `A` | `2.3` | `E2-S23-F1` | `D11-D15` |
| `E2-S23-F3 Project explicit unknown-state and unresolved business/legal context in readiness messaging from `WIZARD-MAPPING.md` without implying final legal consequence` | 1 | `A` | `2.3` | `E2-S23-F2` | `D11-D15` |
| `E2-S23-F4 Audit transition when evidence later becomes available without mutating original WizardProfile version` | 1 | `A` | `2.3` | `E2-S23-F3` | `D11-D15` |
| `E2-S24-F1 Create readiness-only export generation path from wizard/assessment entry points` | 2 | `A` | `2.4` | `E2-S23-F4` | `D11-D15` |
| `E2-S24-F2 Apply output guardrails to title, metadata, artifact history and file content` | 1 | `A` | `2.4` | `E2-S24-F1` | `D11-D15` |
| `E2-S24-F3 Persist versioned export artifact with owner, assessment ID, timestamp and audit event` | 1 | `A` | `2.4` | `E2-S24-F2` | `D11-D15` |
| `E2-S24-F4 Ensure readiness export template mirrors Wizard package semantics and `WIZARD-MAPPING.md`: readiness-only badge, missing-evidence checklist, unresolved unknowns, and next-step CTA set` | 1 | `A` | `2.4` | `E2-S24-F3` | `D11-D15` |

## Epic 3 - Repository Scan and Technical Evidence

Stories: `3.1`, `3.2`, `3.3`, `3.4`, `3.5`, `3.6`, `3.7`, `3.8`, `3.9`, `3.10`, `3.11`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E3-S31-F1 Implement GitHub App connection flow with read-only permissions and authorized repo selection` | 2 | `L` | `3.1` | `none` | `D1-D5` |
| `E3-S31-F2 Persist RepositoryConnection metadata without exposing raw tokens` | 1 | `L` | `3.1` | `E3-S31-F1` | `D1-D5` |
| `E3-S31-F3 Separate OAuth identity login from repository authorization and audit denial paths` | 1 | `L` | `3.1` | `E3-S31-F2` | `D1-D5` |
| `E3-S32-F1 Resolve branch/ref/commit into immutable RepositorySnapshot metadata tied to assessment` | 2 | `L` | `3.2` | `E3-S31-F3` | `D6-D10` |
| `E3-S32-F2 Ensure downstream scan references snapshot ID rather than mutable branch head` | 1 | `L` | `3.2` | `E3-S32-F1` | `D6-D10` |
| `E3-S32-F3 Enforce cleanup and no long-term raw source persistence after snapshot operations` | 1 | `L` | `3.2` | `E3-S32-F2` | `D6-D10` |
| `E3-S33-F1 Persist `RepositoryScanJob` with `assessmentId`, `repositorySnapshotId`, `triggerSource`, `idempotencyKey`, `status`, `attemptCount`, and `correlationId`` | 2 | `B` | `3.3` | `E3-S32-F3` | `D6-D10` |
| `E3-S33-F2 Return existing job or safe resume projection when duplicate trigger delivery matches canonical idempotency rules` | 1 | `B` | `3.3` | `E3-S33-F1` | `D6-D10` |
| `E3-S33-F3 Resolve trigger context into exactly one of `READY_TO_SNAPSHOT`, `PENDING_MAPPING`, `BLOCKED_MAPPING`, or `WAITING_FOR_CONTEXT` before scan execution` | 1 | `B` | `3.3` | `E3-S33-F2` | `D6-D10` |
| `E3-S33-F4 Surface Manager-visible recovery reason for missing or ambiguous repository/account/assessment mapping` | 1 | `B` | `3.3` | `E3-S33-F3` | `D6-D10` |
| `E3-S33-F5 Reject out-of-order or replayed commands from mutating completed scan/evidence/profile history` | 1 | `B` | `3.3` | `E3-S33-F4` | `D6-D10` |
| `E3-S33-F6 Persist audit and queue outcome for trusted-trigger authorization, enqueue, retry, DLQ, and replay handling` | 1 | `B` | `3.3` | `E3-S33-F5` | `D6-D10` |
| `E3-S33-F7 Enforce replay authority and operator recovery rules from the trusted-trigger retry/DLQ/replay decision artifact` | 1 | `B` | `3.3` | `E3-S33-F6` | `D6-D10` |
| `E3-S34-F1 Materialize pinned snapshot into restricted temporary scanner workspace with lease metadata` | 2 | `B` | `3.4` | `E3-S33-F7` | `D11-D15` |
| `E3-S34-F2 Block build/test/install/docker/runtime execution inside scanner flow` | 1 | `B` | `3.4` | `E3-S34-F1` | `D11-D15` |
| `E3-S34-F3 Verify cleanup on success, failure and timeout before marking job outcome` | 1 | `B` | `3.4` | `E3-S34-F2` | `D11-D15` |
| `E3-S35-F1 Build language-profile-aware execution plan for approved static tools` | 2 | `B` | `3.5` | `E3-S34-F3` | `D11-D15` |
| `E3-S35-F2 Record tool versions, config hash, ruleset hash and coverage limitations per run` | 1 | `B` | `3.5` | `E3-S35-F1` | `D11-D15` |
| `E3-S35-F3 Skip unsupported tools explicitly instead of treating absence as success` | 1 | `B` | `3.5` | `E3-S35-F2` | `D11-D15` |
| `E3-S36-F1 Implement canonical severity classification for failure, partial result and accepted-with-limitation outcomes` | 2 | `B` | `3.6` | `E3-S35-F3` | `D11-D15` |
| `E3-S36-F2 Bind severity outcomes to downstream evidence eligibility and retryability` | 1 | `B` | `3.6` | `E3-S36-F1` | `D11-D15` |
| `E3-S36-F3 Block readiness when tool/config/ruleset approval authority is missing` | 1 | `B` | `3.6` | `E3-S36-F2` | `D11-D15` |
| `E3-S37-F1 Assemble TechnicalEvidenceReport schema with provenance, tool metadata, refs, privacy flags and coverage limitations` | 2 | `B` | `3.7` | `E3-S36-F3` | `D11-D15` |
| `E3-S37-F2 Run schema/privacy/provenance gate checks before downstream use` | 2 | `B` | `3.7` | `E3-S37-F1` | `D11-D15` |
| `E3-S37-F3 Emit accepted vs insufficient vs rejected outcome with explicit reasons and audit trail` | 1 | `B` | `3.7` | `E3-S37-F2` | `D11-D15` |
| `E3-S38-F1 Load only accepted `TechnicalEvidenceReport` versions and reject stale or insufficient evidence before profile derivation` | 2 | `C` | `3.8` | `E3-S37-F3` | `D16-D20` |
| `E3-S38-F2 Derive technical observations into immutable `TechnicalProfile` fields with evidence refs, confidence and coverage limitation metadata` | 1 | `C` | `3.8` | `E3-S38-F1` | `D16-D20` |
| `E3-S38-F3 Mark unknown or low-confidence technical dimensions explicitly instead of inferring unsupported facts from declarations` | 1 | `C` | `3.8` | `E3-S38-F2` | `D16-D20` |
| `E3-S38-F4 Emit downstream AIUsageFlow request only from current accepted profile version and preserve immutable lineage for reruns` | 1 | `C` | `3.8` | `E3-S38-F3` | `D16-D20` |
| `E3-S39-F1 Build review surface for technical findings with redacted evidence context and scoped access rules` | 2 | `C` | `3.9` | `E3-S38-F4` | `D21-D25` |
| `E3-S39-F2 Separate Manager/business-safe views from Developer technical scope where required by RBAC` | 1 | `C` | `3.9` | `E3-S39-F1` | `D21-D25` |
| `E3-S39-F3 Audit findings access and prevent exposure of raw source, secrets or out-of-scope data` | 1 | `C` | `3.9` | `E3-S39-F2` | `D21-D25` |
| `E3-S310-F1 Add rerun request path that creates new scan generation from immutable snapshot/evidence lineage` | 2 | `B` | `3.10` | `E3-S39-F3` | `D21-D25` |
| `E3-S310-F2 Mark superseded status/history without mutating prior accepted artifacts` | 1 | `B` | `3.10` | `E3-S310-F1` | `D21-D25` |
| `E3-S310-F3 Project rerun status and audit trail clearly in history/read models` | 1 | `B` | `3.10` | `E3-S310-F2` | `D21-D25` |
| `E3-S311-F1 Make removed/deferred evidence paths explicit in API/UI/worker boundaries` | 2 | `C` | `3.11` | `E3-S310-F3` | `D21-D25` |
| `E3-S311-F2 Reject manual evidence upload and deferred clarification pathways with safe messaging` | 1 | `C` | `3.11` | `E3-S311-F1` | `D21-D25` |
| `E3-S311-F3 Document and test absence of superseded flows in active MVP path` | 1 | `C` | `3.11` | `E3-S311-F2` | `D21-D25` |

## Epic 4 - AI Usage Analysis

Stories: `4.1`, `4.2`, `4.3`, `4.4`, `4.5`, `4.6`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E4-S41-F1 Load WizardProfile, TechnicalProfile and accepted TechnicalEvidenceReport refs into AIUsageFlow generation` | 2 | `C` | `4.1` | `none` | `D16-D20` |
| `E4-S41-F2 Create claim set for business process, purpose, inputs/outputs, downstream action, subjects, human review, automation and harm categories` | 2 | `C` | `4.1` | `E4-S41-F1` | `D16-D20` |
| `E4-S41-F3 Preserve unknown/unclear material dimensions with audit trail instead of inventing claims` | 1 | `C` | `4.1` | `E4-S41-F2` | `D16-D20` |
| `E4-S42-F1 Keep AIUsageFlow storage/versioning distinct from TechnicalProfile artifacts` | 2 | `C` | `4.2` | `E4-S41-F3` | `D16-D20` |
| `E4-S42-F2 Track declaration and technical source refs separately when both contribute to a claim` | 1 | `C` | `4.2` | `E4-S42-F1` | `D16-D20` |
| `E4-S42-F3 Prevent downstream readers from treating AIUsageFlow as raw scanner evidence or final profile` | 1 | `C` | `4.2` | `E4-S42-F2` | `D16-D20` |
| `E4-S43-F1 Attach claim-level source refs, evidence refs, confidence, generation method and profile versions to each material claim` | 2 | `C` | `4.3` | `E4-S42-F3` | `D16-D20` |
| `E4-S43-F2 Differentiate declaration-backed claims from evidence-backed claims in persistence and read models` | 1 | `C` | `4.3` | `E4-S43-F1` | `D16-D20` |
| `E4-S43-F3 Preserve coverage limitations when claim depends on technical evidence` | 1 | `C` | `4.3` | `E4-S43-F2` | `D16-D20` |
| `E4-S44-F1 Model explicit UNKNOWN/UNCLEAR/low-confidence states per material usage dimension` | 2 | `C` | `4.4` | `E4-S43-F3` | `D16-D20` |
| `E4-S44-F2 Prevent provider/framework-only evidence from inferring business usage facts` | 2 | `C` | `4.4` | `E4-S44-F1` | `D16-D20` |
| `E4-S44-F3 Explain uncertainty in business-language status/read models` | 1 | `C` | `4.4` | `E4-S44-F2` | `D16-D20` |
| `E4-S45-F1 Compare Manager declarations and technical observations during AIUsageFlow generation for material disagreement` | 2 | `C` | `4.5` | `E4-S44-F3` | `D21-D25` |
| `E4-S45-F2 Persist conflict candidates with source refs, affected claims, confidence and explanation` | 1 | `C` | `4.5` | `E4-S45-F1` | `D21-D25` |
| `E4-S45-F3 Route low-materiality or coverage-limited disagreements into uncertainty rather than forced conflict` | 1 | `C` | `4.5` | `E4-S45-F2` | `D21-D25` |
| `E4-S46-F1 Build Manager review read model for claims, source refs, confidence, uncertainty and conflict candidates` | 2 | `A` | `4.6` | `E4-S45-F3` | `D21-D25` |
| `E4-S46-F2 Render declaration-backed versus scanner-backed claims distinctly so provenance is visible at a glance` | 1 | `A` | `4.6` | `E4-S46-F1` | `D21-D25` |
| `E4-S46-F3 Apply RBAC-scoped filtering for Developer access so out-of-scope business declarations and Manager-only actions stay hidden` | 1 | `A` | `4.6` | `E4-S46-F2` | `D21-D25` |
| `E4-S46-F4 Keep copy, labels and next actions neutral so the surface cannot be mistaken for VerifiedProfile approval or final classification` | 1 | `A` | `4.6` | `E4-S46-F3` | `D21-D25` |

## Epic 5 - Reconciliation and Verified Profile

Stories: `5.1`, `5.2`, `5.3`, `5.4`, `5.5`, `5.6`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E5-S51-F1 Compare WizardProfile, TechnicalProfile and AIUsageFlow across material dimensions` | 2 | `L` | `5.1` | `none` | `D16-D20` |
| `E5-S51-F2 Record conflict candidates, no-conflict decisions and missing/unknown states with version refs` | 1 | `L` | `5.1` | `E5-S51-F1` | `D16-D20` |
| `E5-S51-F3 Apply materiality threshold and known coverage limitation rules before creating review work` | 1 | `L` | `5.1` | `E5-S51-F2` | `D16-D20` |
| `E5-S52-F1 Compute conflict score with business-language explanation and evidence/materiality rationale` | 2 | `L` | `5.2` | `E5-S51-F3` | `D16-D20` |
| `E5-S52-F2 Expose redacted evidence context and coverage limitations in review view` | 1 | `L` | `5.2` | `E5-S52-F1` | `D16-D20` |
| `E5-S52-F3 Persist score explanation separately from legal risk or compliance labels` | 1 | `L` | `5.2` | `E5-S52-F2` | `D16-D20` |
| `E5-S53-F1 Provide guided resolution choices, rationale capture and downstream impact preview for each conflict` | 2 | `A` | `5.3` | `E5-S52-F3` | `D21-D25` |
| `E5-S53-F2 Validate stale-version submissions and reject refresh-required decisions` | 1 | `A` | `5.3` | `E5-S53-F1` | `D21-D25` |
| `E5-S53-F3 Persist Manager interpretation as separate reconciliation decision without overwriting evidence` | 1 | `A` | `5.3` | `E5-S53-F2` | `D21-D25` |
| `E5-S54-F1 Keep TechnicalEvidenceReport and TechnicalProfile immutable while storing reconciliation decisions separately` | 2 | `A` | `5.4` | `E5-S53-F3` | `D21-D25` |
| `E5-S54-F2 Carry evidence/report/profile version trail into reconciliation history and exports` | 1 | `A` | `5.4` | `E5-S54-F1` | `D21-D25` |
| `E5-S54-F3 Handle rerun-triggered new evidence by creating new reconciliation version or review-needed state` | 1 | `A` | `5.4` | `E5-S54-F2` | `D21-D25` |
| `E5-S55-F1 Verify immutable input set for current run: `WizardProfile`, `TechnicalProfile`, `AIUsageFlow`, evidence-gate status, and Manager reconciliation outcomes` | 2 | `C` | `5.5` | `E5-S54-F3` | `D21-D25` |
| `E5-S55-F2 Persist `VerifiedProfile` version with source profile version refs, evidence refs, confidence, gate outcome, and allowed non-critical unresolved unknowns` | 1 | `C` | `5.5` | `E5-S55-F1` | `D21-D25` |
| `E5-S55-F3 Reject generation when any material conflict remains unresolved or required evidence gate is not satisfied` | 1 | `C` | `5.5` | `E5-S55-F2` | `D21-D25` |
| `E5-S55-F4 Distinguish `non-critical unresolved unknowns` that may be preserved from `critical unknown/unclear/conflicted` dimensions that must block approval/classification` | 1 | `C` | `5.5` | `E5-S55-F3` | `D21-D25` |
| `E5-S55-F5 Mark downstream legal matching and classification readers to consume only `VerifiedProfile` facts, never raw unresolved upstream fields` | 1 | `C` | `5.5` | `E5-S55-F4` | `D21-D25` |
| `E5-S55-F6 Preserve stale/superseded behavior when upstream evidence or reconciliation inputs change after profile creation` | 1 | `C` | `5.5` | `E5-S55-F5` | `D21-D25` |
| `E5-S56-F1 Build review surface for verified facts, refs, remaining unknowns and readiness state` | 2 | `L` | `5.6` | `E5-S55-F6` | `D21-D25` |
| `E5-S56-F2 Persist Manager approval/rejection with policy version and audit event` | 1 | `L` | `5.6` | `E5-S56-F1` | `D21-D25` |
| `E5-S56-F3 Gate downstream legal matching on explicit approval plus current version checks` | 1 | `L` | `5.6` | `E5-S56-F2` | `D21-D25` |

## Epic 6 - Legal Corpus and Matching

Stories: `6.1`, `6.2`, `6.3`, `6.4`, `6.5`, `6.6`, `6.7`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E6-S61-F1 Implement ingestion of approved legal source URL/file/reference into immutable source snapshot` | 2 | `D` | `6.1` | `none` | `D1-D10` |
| `E6-S61-F2 Persist source metadata, checksum, operator, retrieval timestamp and ingestion run identity` | 1 | `D` | `6.1` | `E6-S61-F1` | `D1-D10` |
| `E6-S61-F3 Reject retrieval/metadata/checksum failures without creating usable corpus version` | 1 | `D` | `6.1` | `E6-S61-F2` | `D1-D10` |
| `E6-S62-F1 Parse document/article/clause/point hierarchy and emit stable hierarchical IDs` | 2 | `D` | `6.2` | `E6-S61-F3` | `D1-D10` |
| `E6-S62-F2 Assemble clause-level retrieval units with parent article context and preserve cross-references` | 1 | `D` | `6.2` | `E6-S62-F1` | `D1-D10` |
| `E6-S62-F3 Track unresolved references as warnings/errors per corpus rules` | 1 | `D` | `6.2` | `E6-S62-F2` | `D1-D10` |
| `E6-S63-F1 Validate parsed corpus candidate and persist approved LegalCorpusVersion metadata` | 2 | `D` | `6.3` | `E6-S62-F3` | `D1-D10` |
| `E6-S63-F2 Block approval on structural, metadata, checksum or provenance errors` | 1 | `D` | `6.3` | `E6-S63-F1` | `D1-D10` |
| `E6-S63-F3 Respect effective/not-yet-effective/superseded status in active retrieval selection` | 1 | `D` | `6.3` | `E6-S63-F2` | `D1-D10` |
| `E6-S64-F1 Write approved corpus records into ChromaDB with stable IDs, metadata filters, full-text fields and xref metadata` | 2 | `D` | `6.4` | `E6-S63-F3` | `D11-D15` |
| `E6-S64-F2 Record successful build with counts/checksum/index reference` | 2 | `D` | `6.4` | `E6-S64-F1` | `D11-D15` |
| `E6-S64-F3 Block use of failed/invalid index for legal matching` | 2 | `D` | `6.4` | `E6-S64-F2` | `D11-D15` |
| `E6-S65-F1 Retrieve primary legal chunks from approved corpus using structure-first/vectorless methods` | 2 | `D` | `6.5` | `E6-S64-F3` | `D16-D20` |
| `E6-S65-F2 Assemble parent clause/article context and one-hop referenced context with explicit roles` | 1 | `D` | `6.5` | `E6-S65-F1` | `D16-D20` |
| `E6-S65-F3 Persist provenance including reference reason, chunk IDs and corpus version separately per context role` | 1 | `D` | `6.5` | `E6-S65-F2` | `D16-D20` |
| `E6-S66-F1 Validate every citation against retrieved primary/parent/referenced context allowlist for current run` | 2 | `D` | `6.6` | `E6-S65-F3` | `D16-D20` |
| `E6-S66-F2 Preserve context role semantics when displaying or persisting cited context` | 1 | `D` | `6.6` | `E6-S66-F1` | `D16-D20` |
| `E6-S66-F3 Emit block/degrade reasons and audit metadata on out-of-allowlist citations` | 1 | `D` | `6.6` | `E6-S66-F2` | `D16-D20` |
| `E6-S67-F1 Persist `LegalMatchingResult` with version, classification eligibility, coverage summary and blocking reasons tied to current VerifiedProfile/corpus versions` | 2 | `D` | `6.7` | `E6-S66-F3` | `D21-D25` |
| `E6-S67-F2 Persist each `LegalRuleMatch` with matched rule, rationale, citation refs, primary/parent/referenced chunk IDs and retrieval audit ID` | 1 | `D` | `6.7` | `E6-S67-F1` | `D21-D25` |
| `E6-S67-F3 Mark result stale when VerifiedProfile or corpus/index version changes and prevent stale result reuse in classification` | 2 | `D` | `6.7` | `E6-S67-F2` | `D21-D25` |
| `E6-S67-F4 Build citation drawer contract that visually demotes parent/referenced context while preserving allowlist validation and provenance metadata` | 1 | `D` | `6.7` | `E6-S67-F3` | `D21-D25` |

## Epic 7 - Classification

Stories: `7.1`, `7.2`, `7.3`, `7.4`, `7.5`, `7.6`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E7-S71-F1 Validate Manager request against VerifiedProfile approval, LegalMatchingResult readiness and classification eligibility gates` | 2 | `L` | `7.1` | `none` | `D21-D25` |
| `E7-S71-F2 Persist classification request with version refs, linked LegalRuleMatch refs, actor and correlation metadata` | 2 | `L` | `7.1` | `E7-S71-F1` | `D21-D25` |
| `E7-S71-F3 Return neutral readiness explanation when prerequisites are missing or stale` | 1 | `L` | `7.1` | `E7-S71-F2` | `D21-D25` |
| `E7-S72-F1 Apply deterministic hard rules and LegalRuleMatch constraints before model interpretation` | 2 | `D` | `7.2` | `E7-S71-F3` | `D21-D25` |
| `E7-S72-F2 Reject or correct model output when it conflicts with rule precedence` | 1 | `D` | `7.2` | `E7-S72-F1` | `D21-D25` |
| `E7-S72-F3 Audit precedence source, rule IDs and rejection reasons` | 1 | `D` | `7.2` | `E7-S72-F2` | `D21-D25` |
| `E7-S73-F1 Invoke only configured real provider via LLM Gateway with approved prompt/template version and schema-constrained output` | 2 | `L` | `7.3` | `E7-S72-F3` | `D1-D5; D16-D20` |
| `E7-S73-F2 Enforce timeout, retry and budget controls while recording provider/model/request/token metadata` | 2 | `L` | `7.3` | `E7-S73-F1` | `D1-D5; D16-D20` |
| `E7-S73-F3 Return blocked/degraded state on provider failure or invalid schema beyond retry policy` | 2 | `L` | `7.3` | `E7-S73-F2` | `D1-D5; D16-D20` |
| `E7-S74-F1 Enforce sufficiency check that blocks provider/framework-only evidence from final classification` | 2 | `D` | `7.4` | `E7-S73-F3` | `D21-D25` |
| `E7-S74-F2 Map unknown/unclear/conflict-bearing critical facts into blocked or degraded classification state` | 1 | `D` | `7.4` | `E7-S74-F1` | `D21-D25` |
| `E7-S74-F3 Expose neutral explanations for missing evidence without unsupported final risk labels` | 1 | `D` | `7.4` | `E7-S74-F2` | `D21-D25` |
| `E7-S75-F1 Validate classification legal refs against current LegalMatchingResult allowlist and metadata` | 2 | `A` | `7.5` | `E7-S74-F3` | `D21-D30` |
| `E7-S75-F2 Reject fabricated locators or mismatched corpus/chunk/context-role combinations` | 1 | `A` | `7.5` | `E7-S75-F1` | `D21-D30` |
| `E7-S75-F3 Persist validation failure details that explain blocked/degraded outcome` | 1 | `A` | `7.5` | `E7-S75-F2` | `D21-D30` |
| `E7-S76-F1 Create read model and UI labels that cleanly separate `FINAL_CLASSIFICATION`, `BLOCKED_NO_CLASSIFICATION`, and `DEGRADED_NOT_FINAL`` | 2 | `A` | `7.6` | `E7-S75-F3` | `D21-D30` |
| `E7-S76-F2 Show cited legal evidence, version refs and provider/model metadata only where policy allows, while preserving blocker/degraded explanations` | 2 | `A` | `7.6` | `E7-S76-F1` | `D21-D30` |
| `E7-S76-F3 Keep final report and download actions locked whenever classification is not final` | 1 | `A` | `7.6` | `E7-S76-F2` | `D21-D30` |
| `E7-S76-F4 Persist new classification versions on rerun without mutating historical results and reflect current versus superseded state in history` | 1 | `A` | `7.6` | `E7-S76-F3` | `D21-D30` |

## Epic 8 - Reporting and Audit

Stories: `8.1`, `8.2`, `8.3`, `8.4`, `8.5`, `8.6`, `8.7`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E8-S81-F1 Generate gap items from classification, LegalRuleMatch, VerifiedProfile and evidence limitations` | 2 | `D` | `8.1` | `none` | `D21-D25` |
| `E8-S81-F2 Differentiate final compliance gaps from evidence-readiness or blocker gaps when classification is blocked/degraded` | 1 | `D` | `8.1` | `E8-S81-F1` | `D21-D25` |
| `E8-S81-F3 Persist priority, rationale, refs and remediation area per gap item` | 1 | `D` | `8.1` | `E8-S81-F2` | `D21-D25` |
| `E8-S82-F1 Build gap review UI with title, priority, status, evidence/legal refs and recommended action` | 2 | `D` | `8.2` | `E8-S81-F3` | `D21-D25` |
| `E8-S82-F2 Show redacted provenance, corpus/evidence versions and limitation notes on inspection` | 1 | `D` | `8.2` | `E8-S82-F1` | `D21-D25` |
| `E8-S82-F3 Differentiate evidence gaps from classification-backed compliance gaps in presentation` | 1 | `D` | `8.2` | `E8-S82-F2` | `D21-D25` |
| `E8-S83-F1 Validate final-report prerequisites against current VerifiedProfile, LegalMatchingResult, final classification, citation validation and GapAnalysis versions` | 2 | `D` | `8.3` | `E8-S82-F3` | `D21-D30` |
| `E8-S83-F2 Generate versioned final report artifact with constrained claims, citations, limitations and artifact metadata only after all gates pass` | 1 | `D` | `8.3` | `E8-S83-F1` | `D21-D30` |
| `E8-S83-F3 Run output guardrails to block unsupported certification, legal certainty, out-of-allowlist citation or ungrounded risk wording` | 1 | `D` | `8.3` | `E8-S83-F2` | `D21-D30` |
| `E8-S83-F4 Persist blocked generation outcome, safe next action and audit event whenever final report gates or output guardrails fail` | 1 | `D` | `8.3` | `E8-S83-F3` | `D21-D30` |
| `E8-S84-F1 Generate readiness-only evidence report from document pipeline when final classification is unavailable` | 2 | `D` | `8.4` | `E8-S83-F4` | `D21-D30` |
| `E8-S84-F2 Carry explicit readiness-only labeling across title, badge, metadata, preview and artifact history` | 1 | `D` | `8.4` | `E8-S84-F1` | `D21-D30` |
| `E8-S84-F3 Block or strip any content that implies final risk/legal/compliance conclusion` | 1 | `D` | `8.4` | `E8-S84-F2` | `D21-D30` |
| `E8-S85-F1 Expose artifact history with type, version, status, checksum and source assessment versions` | 2 | `A` | `8.5` | `E8-S84-F3` | `D26-D30` |
| `E8-S85-F2 Enforce RBAC on download serving and audit every access or denial` | 1 | `A` | `8.5` | `E8-S85-F1` | `D26-D30` |
| `E8-S85-F3 Mark current vs superseded artifacts while preserving immutable historical versions` | 1 | `A` | `8.5` | `E8-S85-F2` | `D26-D30` |
| `E8-S86-F1 Write immutable redacted audit events for all material domains from auth through exports` | 2 | `L` | `8.6` | `E8-S85-F3` | `D26-D30` |
| `E8-S86-F2 Apply redaction/omission policy to secrets, tokens, raw source, full prompts and out-of-scope details` | 1 | `L` | `8.6` | `E8-S86-F1` | `D26-D30` |
| `E8-S86-F3 Handle audit write failure by blocking/retrying/degrading per configured policy instead of silent drop` | 1 | `L` | `8.6` | `E8-S86-F2` | `D26-D30` |
| `E8-S87-F1 Build filtered redacted audit timeline view with RBAC checks and access audit` | 2 | `L` | `8.7` | `E8-S86-F3` | `D26-D30` |
| `E8-S87-F2 Generate redacted audit export with checksum, filter criteria and version metadata` | 1 | `L` | `8.7` | `E8-S87-F1` | `D26-D30` |
| `E8-S87-F3 Deny and audit out-of-scope export/view requests without exposing hidden data` | 1 | `L` | `8.7` | `E8-S87-F2` | `D26-D30` |

## Practical Jira Rule

- Import `Epic` first, then `Story`, then `Task`.
- Fill `Epic Link` in story/task CSV after Jira returns new epic issue keys.
- Use `Task` as the only dev-assigned implementation item.
- Keep `Story` open until all mapped `Task` items are done and acceptance passes.
- Do not create `Sub-task` items in the new project.

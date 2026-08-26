---
name: LCSP
status: rebased_canonical_draft
sources:
  - docs/product/prd.md
  - docs/specs/user-task-flows.md
  - docs/specs/functional-requirements.md
  - docs/specs/non-functional-requirements.md
  - docs/specs/requirements-traceability-summary.md
  - docs/specs/scanner-spec.md
  - docs/specs/legal-matching-domain-spec.md
  - docs/architecture/architecture.md
  - docs/architecture/multi-agent-system-architecture.md
  - docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md
updated: 2026-06-25
---

# LCSP Experience Spine

## Rebase Status

This experience spine is rebased against the Phase 5.2L active authority set and is the active UX behavior draft for canonical UX review and epic/story generation.

The deprecated pre-rebase UX specification has been removed from the active doc set. Use git history only if historical comparison is required. It must not be used as active UX authority where it preserves structured attestation, manual evidence upload, Local/CI upload as an MVP path, RBAC authority, or stale legal retrieval wording.

## Foundation

Responsive web application for an evidence-based compliance support workflow. `DESIGN.md` is the visual identity reference; this spine owns information architecture, behavior, states, interactions, accessibility, and journeys.

[ASSUMPTION] Desktop/laptop is the primary surface for Managers completing assessments and reviewing evidence. Tablet and mobile support status review, lightweight edits, approvals, and downloads.

LCSP must not feel like a chatbot, legal opinion generator, or certification portal. It is a gate-driven workbench that shows what basis exists for each next step.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Sign in / MFA / recovery | Public entry | Authenticate user without exposing provider internals and render failure states from approved stable copy keys |
| Organization switcher | Authenticated entry | Select tenant workspace |
| Assessment list | Sidebar / app open | Create, resume, filter, and inspect assessment status |
| Assessment overview | Assessment row | Show workflow stage, blockers, readiness, next action, and audit refs |
| WizardProfile | Overview / stepper | Capture business/legal context in non-technical language |
| Repository connection | Overview / stepper | Connect read-only GitHub repository and separate OAuth identity from repository authorization |
| Snapshot and scan | Repository step | Select commit, create snapshot, trigger/monitor Python scanner |
| Evidence review | Scan completed | Review redacted findings, AIUsageFlow, confidence, limitations, and evidence refs |
| Conflict resolution | Overview / blocker / task list | Compare declared and detected facts; Manager resolves with rationale |
| VerifiedProfile review | Conflict-free state | Review merged facts, evidence provenance, and version |
| Classification | VerifiedProfile ready | Run/review citation-backed classification or blocked/degraded state |
| Gap analysis | Classification ready | Review obligation gaps, evidence gaps, priorities, and citations |
| Documents | Gap ready / readiness-only path | Generate/download final report or readiness-only export |
| Audit trail | Assessment nav | Filter/export redacted event and decision trail |
| Developer task workspace | Invitation / task link | Accept scoped task and review assigned redacted technical findings |
| Settings | Workspace menu | Profile, session, MFA, theme, provider/account status where user-visible |

Legal corpus ingestion, corpus approval, ChromaDB index build, and corpus administration are not Manager/Developer product surfaces for MVP. Manager-facing screens may display only assessment-relevant corpus version, effective date, citation provenance, and blocked legal-retrieval state.

## Voice and Tone

Microcopy must be precise, calm, and non-certifying.

| Do | Don't |
|---|---|
| "Chưa thể phân loại rủi ro vì thiếu bằng chứng kỹ thuật." | "Hệ thống của bạn rủi ro thấp." before gates pass |
| "Báo cáo readiness-only không chứa risk level." | "Báo cáo tuân thủ đã sẵn sàng." for readiness-only output |
| "Citation này đến từ Khoản 3 Điều 12, phiên bản corpus 2026-06-24." | "Theo luật hiện hành..." without citation detail |
| "Developer chỉ thấy task được cấp quyền." | "Developer có quyền xem assessment." |
| "Không tìm thấy citation hợp lệ; classification bị chặn." | "AI không chắc." |
| "Thông báo bị chặn được render từ key đã được duyệt." | Tin trực tiếp backend prose như final UI copy |

## Component Patterns

| Component | Use | Behavioral rules |
|---|---|---|
| Workflow stepper | Assessment overview | Shows stage, completed gates, blockers, and next action. It never skips hidden gates. |
| Readiness panel | Wizard-only and intermediate states | Shows preparation guidance and missing evidence. It must never show HIGH/MEDIUM/LOW risk. |
| Evidence summary card | Scan/evidence/reconciliation | Shows state, source, confidence, limitations, and redacted evidence refs. Raw source and secrets never display. |
| Conflict comparison | Reconciliation | Left: Manager declaration. Right: evidence-derived fact. Bottom: resolution choice and required rationale. |
| Citation detail drawer | Classification/gap/document | Shows document title, article, clause, point, context role, corpus version, effective date, legal status, source URL/checksum, and allowlist status. |
| Blocked-state banner | Any blocked stage | Shows reason code, business explanation, next action, retry/re-run availability, and audit/correlation ID; auth and blocked-state surfaces render approved copy from stable title/detail/action keys rather than trusting backend prose as the final UI message. |
| Audit event table | Audit trail | Supports filters by stage, actor/service, action, outcome, correlation ID, policy ID/version, evidence/citation ref. |
| Developer scope panel | Developer workspace | Shows granted action/resource scope, expiry/revocation state, and what is hidden. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Wizard draft incomplete | WizardProfile | Inline field validation and section progress; no risk terminology. |
| Wizard submitted, no evidence | Overview | Readiness-only state with missing evidence checklist and repository connection action. |
| Repository access failed | Repository connection | Explain app/scope/revocation issue and offer reconnect or select another repository. |
| Snapshot pinned | Snapshot and scan | Show branch, commit SHA, author/date, and immutable snapshot ID. |
| Scan queued/running | Snapshot and scan | Persistent progress with safe stage names; no raw code output. |
| Scan failed cleanup/privacy/schema | Snapshot and scan | Fail closed; show safe reason and retry/re-run rules. |
| Evidence insufficient | Evidence review | Show missing/uncertain claims, coverage limitations, and blocked downstream stage. |
| Conflict open | Overview + conflict task | Workflow pauses; Manager action required. |
| VerifiedProfile ready | VerifiedProfile review | Show merged facts, provenance, unresolved-warning count zero, and version. |
| Legal corpus unavailable/unapproved | Classification | Classification blocked; show corpus/version reason and no risk result. |
| Citation outside allowlist | Classification/document | Reject result and show guardrail failure. |
| Classification ready | Classification | Show risk level only with evidence basis, legal matches, citation detail, model metadata summary, and audit ref. |
| Gap analysis blocked | Gap analysis | Explain upstream classification/citation dependency. |
| Readiness-only export | Documents | Label as readiness-only in title, status badge, preview, and download metadata. |
| Final report generated | Documents | Show document version, inputs, classification/gap refs, corpus version, and download. |
| Permission denied | Any surface | Hide inaccessible data where possible; otherwise show denied action and recovery path, not internal policy details. |

## Legal Citation UX Requirements

Every classification, gap item, and final report citation must expose:

- document title and document number;
- article number/title;
- clause number and point code where applicable;
- context role: `PRIMARY_MATCH`, `PARENT_CONTEXT`, or `REFERENCED_CONTEXT`;
- corpus version ID;
- effective-from/effective-to dates;
- legal status, including expired/superseded warning;
- source URL/checksum when available;
- allowlist validation result.

Referenced context must never be visually promoted as the primary legal basis. It appears below the primary match with the reason, for example: "Referenced because Khoản 3 Điều 12 cites Khoản 2 Điều 8."

## Interaction Primitives

- Primary navigation: sidebar on desktop, sheet on smaller screens.
- Step navigation: users can inspect previous completed stages but cannot force downstream stages before gates pass.
- Forms: autosave drafts where safe; explicit submit for WizardProfile, conflict resolution, report generation, and destructive/re-run actions.
- Tables: filter, sort, wrap long refs, and copy safe IDs.
- Retry/re-run: always explain whether the action creates a new version or resumes an idempotent command.
- Keyboard: all workflow actions, drawers, dialogs, tables, and filters are keyboard reachable.
- Banned: manual technical evidence JSON upload, Local/CI scanner report upload, structured attestation forms, delegated free-form clarification screens, and customer-facing corpus administration.

## Accessibility Floor

- WCAG 2.2 AA target for web surfaces.
- All blocked, failed, loading, completed, and generated states must be announced to assistive tech.
- Focus order follows workflow order and table reading order.
- Status must not rely on color alone; pair badges with text and icons.
- Citation drawers and conflict dialogs trap focus while open and return focus to the invoking control on close.
- Long IDs and legal references must be copyable without requiring precise mouse selection.
- Reduce Motion disables non-essential transitions and progress animations.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| Desktop | Sidebar visible; overview may use two columns for workflow and blockers/evidence summary. |
| Tablet | Sidebar collapses; workflow panels stack; tables use column controls. |
| Phone | Review-first mode; creation/edit flows remain possible but prioritize one task per screen. Citation and audit details open full-screen. |

## Key Flows

### Flow 1 — Manager completes the golden path alone

1. Linh, a compliance Manager, signs in and selects her organization.
2. She creates an assessment for an AI-enabled product.
3. She completes WizardProfile in business/legal language.
4. **Climax:** LCSP shows readiness guidance without a risk level and points to repository evidence as the next required gate.
5. Linh connects a read-only GitHub repository, selects a commit, and starts a trusted scan.
6. The scan completes; she reviews redacted evidence, AIUsageFlow, confidence, and limitations.
7. No material conflicts remain; VerifiedProfile becomes ready.
8. Linh runs classification and reviews cited legal matches.
9. She reviews gap analysis and generates the final report.
10. Final document shows risk result, citations, corpus version, evidence basis, and audit trail.

Failure: scan fails privacy cleanup. LCSP blocks downstream stages, shows a safe failure reason, and offers retry/re-run according to the versioning rule.

### Flow 2 — Manager resolves a material conflict

1. Minh submits WizardProfile saying the system has human review.
2. Scanner/AIUsageFlow evidence suggests automated downstream action without clear review.
3. Assessment overview shows a conflict blocker.
4. Minh opens the conflict comparison.
5. He reviews declared value, evidence-derived value, evidence refs, confidence, and uncertainty reason.
6. He selects a resolution, enters rationale, and submits.
7. **Climax:** LCSP reruns reconciliation and either clears the blocker into VerifiedProfile ready or keeps a specific unresolved blocker.

Failure: rationale is missing or stale. The submit action is rejected inline; no hidden state transition occurs.

### Flow 3 — Classification blocks unsafe legal output

1. An assessment reaches VerifiedProfile ready.
2. Legal retrieval runs against the approved ChromaDB vectorless legal index.
3. The candidate rule cites a chunk outside retrieved/referenced allowlist.
4. **Climax:** LCSP rejects the classification output, shows "citation outside retrieved allowlist", and displays no risk level.
5. Audit trail records the blocked legal matching/classification event.

Failure recovery: re-run after legal index/corpus issue is corrected by internal operations. The Manager sees only the resolved corpus/index status and assessment-level next action.

### Flow 4 — Developer handles a scoped task

1. An invited Developer opens a task link.
2. LCSP shows organization, assessment label, granted RBAC scope, and hidden data boundaries.
3. Developer accepts and reviews assigned redacted technical findings.
4. **Climax:** Developer can help inspect assigned findings without gaining Manager-only powers or creating structured attestation.
5. Manager's golden path remains available whether Developer participates or not.

Failure: permission is revoked. Developer sees task revoked and cannot view findings; Manager sees audit event and can continue independently.

### Flow 5 — Readiness-only export before evidence is available

1. A Manager completes WizardProfile but cannot connect repository evidence yet.
2. Overview shows readiness-only eligible state and explicitly says no risk level is available.
3. Manager requests readiness-only export.
4. **Climax:** Generated document is labeled readiness-only in title, badge, preview, and metadata, and contains missing-evidence guidance without classification.

Failure: export text tries to imply legal conclusion. Guardrail blocks generation and shows report overclaim reason.

## Open Questions (Resolved 2026-07-11)

1. **Frontend UI system** — RESOLVED: shadcn/ui (Base UI primitives) is the confirmed system, in use under `apps/web/src/components/ui` with tokens wired in `apps/web/src/app/globals.css`. `DESIGN.md`'s Colors/Components sections now bind to it explicitly (see "Token Binding" note under Auth Surface).
2. **Product language policy** — RESOLVED: bilingual (Vietnamese + English), not Vietnamese-only. `@lcsp/i18n` ships parallel `en`/`vi` dictionaries with a `resolveMessage(locale, key)` resolver (`packages/i18n/src/resolver.ts`). Every customer-facing string must be a message key, never hardcoded in `apps/web`. **Known implementation gap:** `apps/web/src/features/auth/config/locale.ts` currently hardcodes `authLocale = "en"` with no session/user locale wired in — flagged as follow-up work, not a spec gap.
3. **Key-screen mockups required for approval** — RESOLVED: not required. Per-page `UI Components` / `UI States` tables in each `docs/implementation/tasks/modules/web/*.md` task file (established convention since `MW-web-002`) are the approval bar, together with this spine's tokens and the Auth Surface / component patterns. Pixel-level mockups are optional, not blocking.

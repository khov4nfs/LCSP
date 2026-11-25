---
title: "LCSP - Product Requirements Document"
status: "final"
readiness: "conditional_for_production_model_usage_debit"
conditional_capabilities:
  - wizard_critical_unknown_behavior
  - legal_corpus_acceptance
  - source_retention_and_evidence_quality_policy
  - production_model_usage_debit
created: "2026-06-16"
updated: "2026-11-24"
sources:
  - docs/product/product-brief.md
  - docs/brainstorming/brainstorming-summary.md
  - docs/brainstorming/open-questions.md
  - docs/brainstorming/decision-candidates.md
  - docs/brainstorming/next-step-recommendation.md
  - LCSP_Technical_Specification.html
  - docs/planning-artifacts/sprint-change-proposal-2026-11-24.md
---

> **Conditional product authority.** Historical implementation descriptions remain subordinate to the canonical FR/NFR catalogs and active ADRs. The approved 2026-11-24 course correction adds Prompt 8 shared-wallet product authority while production debit remains separately gated.

# PRD: LCSP - Legal Compliance Support Platform

## 1. Overview

LCSP là nền tảng hỗ trợ tuân thủ pháp lý cho doanh nghiệp sử dụng AI tại Việt Nam. PRD này là product-direction authority đã được chốt cho phạm vi MVP và course correction ngày 2026-11-24. Trạng thái `final` xác nhận requirement spine đủ ổn định để kiến trúc, UX, epic/story decomposition và RED tests tiếp tục; nó không cấp implementation acceptance cho các capability được liệt kê trong `conditional_capabilities`. Wizard critical-unknown behavior, legal-corpus acceptance, source-retention/evidence-quality policy và production model-usage debit không được đưa story sang accepted/done cho đến khi validation gate tương ứng đóng bằng evidence. Các assumption A1-A4 và bảy financial enablement gates vẫn phải được đóng downstream.

Định vị bắt buộc: LCSP là **evidence-based compliance platform**, không phải chatbot pháp lý, không phải checklist tự khai đơn giản. Risk classification thật sự chỉ được chạy sau technical evidence, evidence gates, reconciliation/technical-only eligibility, VerifiedProfile và legal/citation gates. WizardProfile bổ sung business context nhưng không phải điều kiện bắt buộc cho technical-only investigation.

PRD này không tạo architecture document, backlog, implementation plan hoặc code. Các quyết định kỹ thuật sâu hơn phải được xử lý ở artifact downstream sau khi PRD được review.

### Phase 5.2L Active Scope Correction

Phase 5.2L là authority hiện hành cho các điểm sau:

- RBAC là nguồn quyết định authorization duy nhất. Role chỉ còn là subject attribute, grouping label hoặc policy template.
- Structured attestation bị loại khỏi active MVP: `FR-045`, `FR-046`, `UC-018`, `AC-013` và các route/entity/event/audit/report dependency tương ứng là `SUPERSEDED_FOR_ACTIVE_MVP`.
- Compliance certification, formal legal opinion, direct regulator submission và manual technical evidence JSON upload (`FR-051`) là `REMOVED_FROM_PRODUCT`.
- `FR-050` không còn là Local/CI scanner report upload. `FR-050` là `AUTOMATIC_TRUSTED_SCAN_INITIATION`.
- Asynchronous domain workloads thuộc Python Worker Platform. Node.js chỉ còn hợp lệ cho NestJS API và web/tooling; repository analysis không còn phụ thuộc analyzer CLI riêng theo ngôn ngữ.
- Repository analysis dùng full Deep Agents harness trên commit-pinned repository; Codebase Memory MCP là structural memory tùy chọn và source trực tiếp là evidence authority.
- Active MVP authorization is owner/resource-scoped and has no organization boundary. Organization creation/membership and Developer invitation/task collaboration are retired.
- Prompt 8 adds one shared prepaid wallet per customer, immutable direct-credit model pricing, per-physical-invocation admission and settlement, customer payment-required/Continue behavior, and governed reconciliation/compensation. Paid-tool billing remains deferred.

Mọi đoạn PRD cũ bên dưới nhắc attestation, Local/CI upload, manual JSON upload, RBAC, Node.js downstream worker hoặc removed product concepts phải được đọc theo marker Phase 5.2L ở trên.

### Requirement Governance

Canonical implementation requirement identifiers live in `docs/specs/functional-requirements.md`.

- `FR-001..FR-056` and `FR-083..FR-094` are the canonical functional requirement identifiers for implementation, acceptance, traceability and future story work.
- `FR-057..FR-082` remain historical aliases and must not be reused.
- PRD `FR-E*` headings below are product narrative/source aliases only.
- PRD `FR-E*` aliases must not be used as canonical story, implementation, acceptance or traceability identifiers.
- When this PRD and a canonical requirements catalog disagree on identifier status, the canonical catalog wins for implementation planning.

For source extraction, use this adjacent mapping; the detailed one-to-many registry remains in `docs/specs/requirements-baseline.md`:

| Narrative group | Canonical implementation IDs       | Status                                                                                                                   |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `FR-E1-*`       | `FR-012`, `FR-013`                 | Active owner/assessment requirements; Developer aliases map to retired `FR-010`, `FR-011`, `FR-047`.                     |
| `FR-E2-*`       | `FR-014`, `FR-015`                 | Active Wizard/readiness requirements.                                                                                    |
| `FR-E3-*`       | `FR-016..FR-020`, `FR-048..FR-050` | Active repository evidence requirements; manual upload/attestation aliases map to removed/superseded `FR-051`, `FR-046`. |
| `FR-E4-*`       | `FR-020..FR-025`                   | Active evidence-quality and technical-profile requirements.                                                              |
| `FR-E5-*`       | `FR-026..FR-029`                   | Active reconciliation requirements; delegated clarification `FR-052` is deferred.                                        |
| `FR-E6-*`       | `FR-030..FR-037`, `FR-053..FR-056` | Active verification, legal retrieval and classification requirements.                                                    |
| `FR-E7-*`       | `FR-038..FR-041`                   | Active gap/report/readiness requirements; attestation disclosure is superseded.                                          |
| `FR-E8-*`       | `FR-042..FR-044`                   | Active audit/version requirements; attestation audit is superseded.                                                      |
| Prompt 8        | `FR-083..FR-094`                   | Active shared-wallet and governed model-usage requirements.                                                              |

## 2. Goals & Success Metrics

### Product Goals

- Giúp Manager hoàn tất assessment bằng ngôn ngữ nghiệp vụ/pháp lý, không cần hiểu scanner, GitHub Actions hoặc source code.
- Thu thập technical evidence qua GitHub App read-only Repository Scan trong workflow do Manager dẫn dắt.
- Ngăn hệ thống tạo risk level khi chỉ có self-report từ Wizard.
- Tạo VerifiedProfile qua một trong hai verification path hợp lệ trước classification: reconciled path khi có WizardProfile hoặc `TECHNICAL_ONLY` path khi WizardProfile vắng mặt.
- Đảm bảo final report có audit trail: wizard answers, evidence metadata, conflict resolution, classification output, legal citation, RBAC decision trace và document version.
- Giữ ranh giới rõ: LCSP hỗ trợ tuân thủ, không phải compliance certification, formal legal opinion hoặc direct regulator submission product.
- Cho phép customer sử dụng một shared prepaid wallet và xem được charge provenance theo từng physical model invocation mà không trộn billing với runtime safety controls.

### Success Metrics

- **SM-1: Manager completion quality.** Manager có thể hoàn tất Wizard mà không cần trả lời câu hỏi kỹ thuật trực tiếp. Validates FR-E2-1, FR-E2-2.
- **SM-2: Evidence-gated classification.** 100% risk classification chỉ chạy khi technical evidence pass schema/quality/legal gates, một verification path hợp lệ đã tạo VerifiedProfile, và không còn material/critical conflict unresolved. Reconciled path so sánh WizardProfile với technical evidence; `TECHNICAL_ONLY` path tạo VerifiedProfile từ TechnicalProfile/AIUsageFlow khi WizardProfile vắng mặt. Validates FR-020..FR-035.
- **SM-3: No Wizard-only risk level.** 0 màn hình hoặc report hiển thị HIGH/MEDIUM/LOW khi assessment chỉ ở `SELF_DECLARED_READINESS` hoặc `EVIDENCE_PENDING`. Validates FR-E2-3, FR-E2-4.
- **SM-4: Conflict accountability.** 100% material conflicts có đúng role confirmation và audit trail. Validates FR-E5-3 đến FR-E5-6.
- **SM-5: Report traceability.** Final report trace được risk result về evidence, rule/citation, conflict resolution, RBAC decision trace và document version. Validates FR-E6-5, FR-E7-2, FR-E8-5.
- **SM-6: Financial idempotency.** 100% confirmed payment retries and invocation-settlement replays produce at most one authoritative credit/debit for the same financial identity. Validates FR-084, FR-089.
- **SM-7: Governed provider-call coverage.** 100% enabled paid provider-call paths obtain immutable server admission before dispatch. Validates FR-088, NFR-040.
- **SM-8: Payment recovery usability.** Provisional discovery target: ít nhất 80% người tham gia trong tối thiểu 5 moderated Customer sessions hoàn tất `PAYMENT_REQUIRED` → checkout → manual Continue mà không nghĩ hệ thống tự resume; Product Owner phải phê duyệt baseline/production target trước UX story acceptance. Validates FR-090, AC-058.
- **SM-9: Charge comprehension.** Provisional discovery target: ít nhất 80% người tham gia trong tối thiểu 5 moderated Customer sessions phân biệt đúng logical operation với physical retry/fallback charge và tìm được pricing/outcome reference; Product Owner phải phê duyệt production target trước UX story acceptance. Validates FR-091, AC-059.

### Counter-Metrics

- **SM-C1: Avoid shallow completion.** Không tối ưu completion rate bằng cách bỏ critical Wizard fields.
- **SM-C2: Avoid scanner bypass.** Không tối ưu unlock classification bằng human assertion, role label hoặc untrusted upload thay thế metadata khách quan.
- **SM-C3: Avoid false certainty.** Không dùng ngôn ngữ khiến readiness/preliminary indicators bị hiểu là risk classification.
- **SM-C4: Avoid revenue by hidden charging.** Không tối ưu revenue bằng cách charge unknown usage, hide retry/fallback invocations, or let callbacks choose financial authority.
- **SM-C5: Avoid paper margin.** Không coi suggested tariff là lợi nhuận thực tế; Pricing Operations phải so sánh approved tariff revenue với realized provider, settlement-fee và infrastructure cost trước khi kết luận margin.

## 3. Target Users

### Manager

Manager là assessment owner. Trong MVP, Manager bao gồm business owner, legal/compliance owner, product owner hoặc người chịu trách nhiệm cuối cùng cho assessment.

Manager owns business/legal truth:

- hệ thống dùng để làm gì;
- ảnh hưởng ai;
- có human review không;
- quyết định nghiệp vụ là gì;
- ý nghĩa pháp lý/nghiệp vụ của technical evidence;
- final assessment confirmation.

### Customer

Customer là chủ tài khoản thanh toán và shared wallet; trong MVP Customer thường là cùng authenticated subject với Manager nhưng hai khái niệm không đồng nghĩa. Customer nạp credit, xem spendable/outstanding balance, kiểm tra charge history, xử lý `PAYMENT_REQUIRED` và chủ động Continue. Customer không được thấy internal margin assumptions hoặc dùng payment để vượt runtime safety blocker.

### Billing and Pricing Admin

Billing and Pricing Admin là subject có RBAC permission rõ ràng cho pricing publication, reconciliation, billing-integrity review và bounded compensation. ADMIN label một mình không cấp quyền. Admin không được đọc raw prompt/output, tự sửa ledger history hoặc dùng runtime override để tạo credit.

### Cộng tác viên kỹ thuật

Developer invitation/task workspace đã retired khỏi active MVP. Không còn active screen, BFF/API handler, Prisma entity/table, RBAC action, mock fixture hoặc delivery task cho invitation acceptance, scoped task workspace hay membership revocation.

### Non-Users for MVP

- External legal counsel như một role riêng trong sản phẩm.
- Organization Admin/IAM administrator như một role riêng.
- Multi-country compliance operator.

### Canonical Glossary

| Term                      | Canonical meaning                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Manager                   | Assessment owner chịu trách nhiệm business/legal truth và quyết định assessment.                                            |
| Customer                  | Chủ shared wallet và payment relationship; có thể cùng user với Manager nhưng authority được đánh giá theo resource/action. |
| Billing and Pricing Admin | Subject có explicit RBAC permission cho pricing/billing operations; role label không tự tạo authority.                      |
| Owner scope               | Quan hệ hiện hành qua `assessment.ownerId` hoặc `wallet.userId`; không phải organization membership.                        |
| Logical operation         | Một ý định nghiệp vụ như classify/generate report, có thể tạo nhiều physical invocations do retry/fallback.                 |
| Physical invocation       | Một lần dispatch thực tế tới provider, có `invocationId`, admission, usage outcome và charge identity riêng.                |
| Admission                 | Server-issued authority cho phép một physical invocation được dispatch trong pricing/exposure/run constraints đã pin.       |
| Pricing snapshot          | Bộ tariff microcredit-per-token bất biến đã publish.                                                                        |
| Pricing assignment        | Khoảng hiệu lực gắn pricing snapshot vào exact model, provider default hoặc approved global default.                        |
| Outstanding usage         | Phần confirmed charge làm signed wallet balance âm; hiển thị riêng và được top-up thanh toán trước spendable credit.        |

## 4. RBAC Policy Model

Trong assessment decision flow, `Manager` là customer-facing assessment role duy nhất. Prompt 8 bổ sung Customer wallet/payment actions và permissioned Billing and Pricing Admin operations; các actor này không tạo organization boundary hoặc Developer collaboration. RBAC là authorization source of truth. Role labels chỉ là subject attributes, grouping labels hoặc policy templates; chúng không phải final authorization authority khi đứng một mình.

Authorization evaluation must include authenticated subject, customer-account/owner scope, resource, action, request/runtime context, policy and policy version. Enforcement is deny-by-default, owner/resource-scoped, server-side, versioned and auditable. Customer assessment and wallet access is bound to `assessment.ownerId` and `wallet.userId`; ADMIN actions require explicit RBAC authority for the requested resource/action.

### Manager Policy Template

Manager policy template grants the assessment owner actions needed to complete an assessment:

- `CREATE_ASSESSMENT`
- `EDIT_WIZARD`
- `CONNECT_REPOSITORY`
- `RUN_REPOSITORY_SCAN`
- `VIEW_TECHNICAL_FINDINGS`
- `REVIEW_AI_USAGE_FLOW`
- `VIEW_ALL_PROGRESS`
- `RESOLVE_BUSINESS_CONFLICTS`
- `RESOLVE_TECHNICAL_CONFLICTS`
- `FINALIZE_CONFLICT_RESOLUTION`
- `REVIEW_VERIFIED_PROFILE`
- `UNLOCK_CLASSIFICATION_AFTER_GATES`
- `GENERATE_REPORT`
- `EXPORT_AUDIT_TRAIL`

Manager is the required and sufficient subject profile for completing an MVP assessment, subject to RBAC evaluation and state gates.

The active MVP has no organization creation, membership or organization-scoped authorization flow. Historical organization identifiers may remain only where required to interpret immutable legacy records and cannot grant current access.

### Retired Developer Policy Scope

The active MVP no longer includes Developer invitation, task acceptance, scoped workspace, policy assignment, or membership revocation flows. Non-Manager subjects without explicit current RBAC policy are denied by default.

### MVP Conflict Resolution Rule

Trong MVP, mọi conflict được route thành Manager conflict resolution task. Manager reviews WizardProfile, TechnicalProfile và AIUsageFlow evidence, sau đó resolve hoặc update thông tin liên quan. Structured attestation không phải active MVP input. Delegated technical clarification workflow thuộc `FR-052` và là `DEFERRED_POST_MVP`.

Any reintroduction of delegated technical clarification requires a new scope decision, new RBAC policy contracts, and new persistence/API design.

### OAuth/OIDC Login Boundary

OAuth/OIDC user login is an active MVP authentication capability. OAuth/OIDC login dùng để xác thực danh tính người dùng vào LCSP. GitHub App connection dùng để cấp read-only repository access cho Repository Scan. Hai boundary này tách biệt:

| Capability            | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| OAuth/OIDC Login      | Đăng nhập/xác thực danh tính người dùng vào LCSP     |
| GitHub App Connection | Cấp quyền read-only để LCSP scan repository          |
| Repository Scan       | Tạo TechnicalEvidenceReport từ repository đã kết nối |

OAuth/OIDC login không tự kết nối GitHub repository, không cấp repository scan permission và không thay thế LCSP RBAC authorization.
Authentication and blocked-state responses for Web/API must use stable shared keys for title, detail, and next action so Web can render approved user-facing copy without depending on backend hardcoded prose.

Enterprise SSO/SAML/directory federation remains Deferred/Future unless explicitly activated later.

## 5. End-to-End User Journey

### UJ-1: Manager starts an evidence-based assessment

Manager tạo assessment mới, đăng nhập bằng password/email hoặc OAuth/OIDC, điền Wizard bằng ngôn ngữ nghiệp vụ, xem readiness/preliminary indicators, kết nối GitHub repository và chạy Repository Scan. Giá trị đạt được khi Manager có thể hoàn tất MVP flow mà không cần external collaborator assignment.

### UJ-2: Customer recovers from payment required

Khi shared wallet không còn positive spendable balance, LCSP dừng tạo paid invocation mới và hiển thị `PAYMENT_REQUIRED` cùng spendable, outstanding và next action. Customer mở checkout có service value, tax, total và credited amount, hoàn tất top-up, rồi chủ động chọn Continue. LCSP kiểm tra lại wallet, pricing, run/lease và runtime blockers; payment không tự resume assessment.

### UJ-3: Manager resolves a conflict

LCSP phát hiện conflict có thể ảnh hưởng risk level. Orchestrator pause workflow, API tạo Manager conflict resolution task, Manager review WizardProfile, TechnicalProfile và AIUsageFlow, rồi resolve hoặc cập nhật thông tin liên quan. Giá trị đạt được khi VerifiedProfile chỉ được tạo sau khi conflict đã resolve, không phụ thuộc external collaborator assignment.

### UJ-4: Manager generates final compliance report after classification is unlocked

Sau khi evidence pass gates, reconciled hoặc `TECHNICAL_ONLY` verification path tạo VerifiedProfile và không còn material/critical conflict unresolved, LCSP chạy Risk Classification Agent, tạo gap analysis và cho Manager generate final report. Giá trị đạt được khi report có risk result, legal citation/rule trace và audit trail.

### UJ-5: Manager exports readiness-only output when evidence is unavailable

Nếu chưa thể cung cấp technical evidence, Manager có thể xuất readiness-only output không có risk level để biết thông tin còn thiếu. Giá trị đạt được là preparation guidance, không phải compliance conclusion.

### UJ-6: Admin publishes governed model pricing

Billing and Pricing Admin mở Pricing Draft, chọn cost-source evidence và editable assumptions, xem suggested tariff/projected margin, rồi publish immutable snapshot/assignment. Hệ thống từ chối stale version, overlapping effective interval hoặc model ngoài allowlist. Publish history cho biết ai duyệt, evidence nào được dùng và tariff nào đang hiệu lực mà không phơi internal margin cho Customer.

### UJ-7: Admin reconciles unknown usage and compensates safely

Admin mở reconciliation queue cho `OUTCOME_UNKNOWN`, xem redacted invocation/pricing/provider evidence, rồi đóng case bằng late receipt, non-billable resolution hoặc escalation theo authority. Khi charge hợp lệ cần sửa, Admin tạo bounded compensation tham chiếu debit gốc; lịch sử không bị chỉnh sửa hoặc xóa.

## 6. MVP Scope

### In Scope

- Manager-led assessment flow.
- OAuth/OIDC user login as active MVP authentication capability.
- Authentication, blocked-state, and safe failure responses for Web/API using stable shared error-contract keys so Web can render approved user-facing copy without relying on backend hardcoded prose.
- Shared customer-facing auth/workspace contracts implemented through TypeScript shared packages, provided public export boundaries are preserved.
- Web Wizard cho Manager.
- Inherited approved architecture constraint: Python Worker Platform cho tất cả asynchronous domain workloads.
- Repository Deep Agent thực thi Repository Scan trên durable LCSP Docker repository workspace.
- Repository analysis dùng native filesystem/search/shell/subagent tools và có thể dùng Codebase Memory MCP; không còn language-specific static-scanner toolchain.
- Kết nối GitHub repository (read-only) và Automatic Trusted Scan Initiation.
- Tích hợp nhà cung cấp LLM thật (Gemini, Claude, hoặc GPT) cho happy-path risk classification và document generation.
- Legal corpus bảo toàn provenance từ nguồn chính phủ chính thức, tổ chức thành các phiên bản `LegalCorpusVersion` bất biến.
- Inherited approved architecture constraint: ChromaDB structure-first vectorless legal retriever dùng stable legal hierarchy IDs, metadata/full-text lookup, direct ID lookup, one-hop xref expansion, parent-context assembly và citation allowlist validation để truy xuất cơ sở pháp lý.
- Inherited approved architecture constraint: lưu trữ tài liệu kết quả bằng real S3-compatible object storage.
- Self-signup and Manager-owned workspace entry.
- Evidence schema completeness gate.
- Context-aware quality threshold gate ở mức MVP.
- Verification gồm reconciled path giữa WizardProfile, TechnicalProfile và AIUsageFlow, hoặc `TECHNICAL_ONLY` path khi WizardProfile vắng mặt.
- Conflict Score, Evidence Confidence Score và AI Intervention Score.
- VerifiedProfile creation sau một verification path hợp lệ.
- Risk classification chỉ sau VerifiedProfile.
- Gap analysis dựa trên risk result.
- Guarded report/document generation với gating.
- Audit trail cho toàn bộ decision path (bao gồm retrieval audit và model run audit).
- Một shared prepaid wallet cho mỗi customer; confirmed payment credit pre-tax service value idempotently.
- Direct-credit model pricing bằng immutable microcredit-per-token snapshots và versioned effective assignments.
- Server-issued admission và actual-usage settlement theo từng physical provider invocation.
- Customer wallet balance, outstanding usage, charge history, `PAYMENT_REQUIRED`, top-up và manual Continue.
- Admin Model Pricing, unknown-usage reconciliation, billing-integrity review và immutable compensation.

### Out of Scope for MVP

- Multi-country compliance frameworks.
- Full enterprise IAM hoặc nhiều role riêng ngoài Manager.
- Structured attestation must not appear as an active MVP feature.
- CI/CD production-grade GitHub Action or Local/CI scanner report upload must not appear as a product evidence path.
- Direct editing of raw legal corpus/rules by end users.
- Final report khi còn material/critical conflict unresolved.
- Enterprise SSO/SAML/directory federation, domain-restricted login, SCIM provisioning hoặc advanced organization identity policy.
- Manual technical evidence JSON upload (`FR-051`) must not appear in active scope, roadmap, future scope, UX, APIs, entities, or delivery plans.
- Risk level khi chỉ có Wizard/self-report.
- Deterministic mock LLM gateway làm mặc định cho happy-path classification (chỉ dùng cho tests, offline CI, dev không cấu hình key).
- Local JSONL legal corpus seed làm nguồn dữ liệu chính thức (chỉ dùng làm test fixture).
- Local filesystem artifact storage làm kho lưu trữ chính thức (chỉ dùng cho local development).
- Credit allocation hoặc reservation riêng cho từng assessment.
- Runtime FX/markup/tax calculation cho từng model invocation.
- Interest hoặc penalty trên outstanding usage.
- Automatic assessment resume sau top-up.
- Paid-tool billing; Prompt 8 chỉ bao phủ model-usage debit.
- Arbitrary lower business token/output caps trước khi có telemetry policy được phê duyệt.

## 7. Functional Requirements

### Epic 1 - Assessment Setup & Account Management

**Description:** Manager tạo và sở hữu assessment. Developer invitation/task collaboration is retired from active MVP.

#### FR-E1-1: Create assessment

Manager can create a new assessment with basic system identity and assessment owner metadata.

**Consequences:**

- New assessment starts in `WIZARD_IN_PROGRESS`.
- Manager is recorded as assessment owner.

#### FR-E1-2: Retired Developer invitation

Developer invitation is retired from active MVP.

**Consequences:**

- No active invitation API, BFF route, UI, Prisma table, or mock fixture.
- Historical audit resource values may remain for old records only.

#### FR-E1-3: Retired Developer policies

Developer scoped policy assignment and revocation are retired from active MVP.

**Consequences:**

- No active `invite:developer` or `membership:revoke` contract.
- Non-Manager subjects without explicit current RBAC policy fail closed.

#### FR-E1-4: Restrict Manager-only actions

System must prevent non-Manager subjects from approving VerifiedProfile, running final classification, generating report, editing business Wizard answers, changing Manager decisions, inviting users or managing assessment settings.

**Consequences:**

- Unauthorized action is blocked.
- Blocked action is auditable if attempted.

### Epic 2 - Web Wizard & Self-Declared Readiness

**Description:** Manager provides business/legal truth through Wizard. Wizard-only output is readiness/preliminary indicators, never risk level.

#### FR-E2-1: Capture WizardProfile

Manager can answer Wizard questions covering purpose, sector, data type, user group, user impact, decision role, human oversight, external LLM usage and biometric/high-impact use indicators.

**Consequences:**

- WizardProfile is created after submission.
- Each Wizard answer maps to a WizardProfile field.
- Critical WizardProfile fields are explicitly tracked for completeness and reconciliation use.

#### FR-E2-2: Use business language

Wizard questions must be phrased in business/legal language and avoid code-centric terms such as dependency, model call, CI, scanner, repo, API probe or AST unless hidden behind explanation.

**Consequences:**

- Critical questions include examples or help text.
- Progressive disclosure is used for complex questions.

#### FR-E2-3: Show readiness without risk level

When technical evidence is missing, system shows readiness checklist, missing evidence and preliminary indicators only.

**Consequences:**

- System must not show HIGH/MEDIUM/LOW.
- System must not use wording equivalent to "preliminary risk level".

#### FR-E2-4: Set Wizard-only state

After Wizard submission without technical evidence, system sets:

```text
mode = SELF_DECLARED_READINESS
classification_status = LOCKED_EVIDENCE_REQUIRED
risk_level = not_available
```

**Consequences:**

- Risk Classification Agent remains locked.
- Manager receives evidence collection next steps.

### Epic 3 - Technical Evidence Collection

**Description:** Manager provides MVP technical evidence by connecting GitHub repository and running Repository Scan. Enterprise-safe alternatives are Deferred/Future.

#### FR-E3-1: GitHub App read-only evidence path

Manager can connect selected repository and run read-only scan for own assessment. This GitHub App read-only Repository Scan is the MVP golden technical-evidence path.

**Consequences:**

- Raw source code must not be sent to LLM.
- Raw source code must not be stored long term.
- Evidence report must include provenance metadata.
- Manager can complete the A-to-Z golden path without external collaborator participation.

#### FR-E3-2: Superseded Local/CI evidence upload

Local/CI scanner report upload is `SUPERSEDED_FOR_ACTIVE_MVP`. Canonical `FR-050` now means `AUTOMATIC_TRUSTED_SCAN_INITIATION`, not report upload.

**Consequences:**

- There is no manual scanner report upload UI/API.
- Trusted triggers create or resume pending scan workflows from integration context.
- Missing or ambiguous mapping creates safe pending/blocked/waiting states instead of scanning the wrong repository or assessment.

#### FR-E3-3: Removed manual technical evidence JSON upload

Manual technical evidence JSON upload maps to canonical `FR-051` and is `REMOVED_FROM_PRODUCT`.

**Consequences:**

- It must not appear in active scope, roadmap, future scope, requirements, UX, APIs, entities, stories or delivery plans.
- Historical decision records may retain evidence that it was previously considered.

#### FR-E3-4: Privacy flags validation

System validates privacy flags for every technical evidence report.

**Consequences:**

- Evidence is rejected if privacy flags indicate raw source uploaded/stored improperly, full AST uploaded when disallowed, raw source sent to LLM, or secrets not redacted where required.

#### FR-E3-5: Superseded human technical attestation

Structured human technical attestation maps to historical `FR-045` and `FR-046` and is `SUPERSEDED_FOR_ACTIVE_MVP`.

**Consequences:**

- It must not support active reconciliation.
- It must not appear as optional evidence, Manager review input, classification dependency, or any workflow retained solely for attestation.
- Reintroduction requires separate Project Owner approval.

### Epic 4 - Evidence Quality Gate

**Description:** LCSP checks whether evidence is structurally acceptable and sufficient for classification.

#### FR-E4-1: Schema completeness gate

System validates required evidence report groups: `assessment_id`, `source_type`, `system_identifier`, `provenance`, `repository_analysis_version` or `report_version`, timestamp/generated_at, scope, privacy_flags, technical_profile, findings array, confidence_per_signal and report_hash.

**Consequences:**

- Missing required schema results in `TECHNICAL_EVIDENCE_REJECTED`.
- Rejected evidence cannot enter reconciliation.

#### FR-E4-2: Technical profile dimensions

System requires technical_profile to include four dimensions: AI usage signals, data type signals, decision flow signals and human oversight signals.

**Consequences:**

- Each dimension may be DETECTED, NOT_DETECTED or UNKNOWN.
- Missing dimension causes rejection or insufficient status depending on severity.

#### FR-E4-3: Quality threshold gate

System evaluates evidence quality according to Wizard context.

**Consequences:**

- Valid schema but low quality results in `TECHNICAL_EVIDENCE_INSUFFICIENT`.
- Passing schema and quality results in `TECHNICAL_EVIDENCE_READY`.

#### FR-E4-4: Context-aware threshold

Evidence requirement changes by scenario criticality. Internal chatbot, public chatbot, finance credit scoring, healthcare diagnosis and biometric use case must not use identical minimum evidence expectations.

**Consequences:**

- High-impact contexts require stronger evidence for data type, decision flow and human oversight.
- Low-impact contexts may unlock with narrower evidence if no material conflict exists.

### Epic 5 - Reconciliation

**Description:** When WizardProfile is linked, LCSP compares WizardProfile and TechnicalProfile to create conflicts, route confirmations and produce VerifiedProfile only after required resolution. When WizardProfile is absent, there is nothing to compare — VerifiedProfile is produced directly from TechnicalProfile/AIUsageFlow as `verificationSource: TECHNICAL_ONLY`.

#### FR-E5-1: Compare WizardProfile and TechnicalProfile (when WizardProfile is linked)

System compares business/legal answers with technical evidence across critical fields such as AI usage, data types, decision flow, human oversight, external LLM, biometric/high-impact use and production scope.

**Consequences:**

- Conflict records include field, Wizard value, technical evidence value, evidence refs, score and required resolver.
- When no WizardProfile is linked, this comparison is skipped and no conflict records are produced.

#### FR-E5-2: Generate Conflict Score

System computes Conflict Score for each conflict.

**Consequences:**

- Conflict Score is the only score that can block workflow.
- Evidence Confidence Score and AI Intervention Score are supporting signals only.

#### FR-E5-3: Route technical conflicts to Manager

Technical conflicts such as dependency use, false positive/negative, repo/branch/commit or production scope are routed to Manager in MVP. Manager may request re-analysis/correction and may consider repository-analysis evidence and coverage limitations. Structured attestation under `FR-046` is `SUPERSEDED_FOR_ACTIVE_MVP`; delegated clarification in `FR-052` is `DEFERRED_POST_MVP`.

**Consequences:**

- Manager is the final resolver for MVP technical conflicts.
- Structured attestation is not active MVP input and cannot unlock classification.
- Delegated technical clarification workflow (`FR-052`) is `DEFERRED_POST_MVP`.
- Resolution is audited.

#### FR-E5-4: Route business/legal conflicts to Manager

Business/legal conflicts such as purpose, affected users, human review process or legal meaning are routed to Manager.

**Consequences:**

- Manager can resolve business/legal truth.
- Resolution is audited.

#### FR-E5-5: Manager resolves MVP conflicts

Any conflict that can affect risk level creates a Manager conflict resolution task. Manager resolution is required and sufficient to resume MVP workflow when evidence is adequate.

**Consequences:**

- Final classification remains blocked until Manager resolves the conflict and reconciliation passes.
- LCSP must not infer final truth without required confirmation.

#### FR-E5-6: Block critical unresolved conflicts

Critical conflicts remain blocking until resolved.

**Consequences:**

- No final report is generated while critical conflict is unresolved.
- Assessment state remains `RECONCILIATION_REQUIRED`, `CONFLICT_RESOLUTION_REQUIRED` or `MANAGER_CONFIRMATION_REQUIRED`.
- `DEVELOPER_CONFIRMATION_REQUIRED` is not an MVP blocking state; delegated clarification is Deferred/Future under `FR-052` and cannot unlock classification by itself.

### Epic 6 - Evidence-Provenance Classification

**Description:** LCSP runs Risk Classification through direct EngineeringRule assessment after evidence, legal corpus, citation and conflict gates pass.

#### FR-E6-1: Preserve reconciled evidence context

System preserves reconciled AIUsageFlow and technical evidence context for EngineeringRule investigation.

**Consequences:**

- Classification cannot proceed with unresolved material/critical conflict.
- Evidence context and rule evaluation versions are auditable.

#### FR-E6-2: Lock classification until conditions pass

Risk Classification remains locked until technical evidence is received, schema gate passed, quality gate passed, EngineeringRules are available or fail closed with diagnostics, and no material/critical conflict remains unresolved. WizardProfile submission is optional: when submitted, it supplements the direct investigation context; when absent, technical evidence alone may proceed and business-declaration-dependent fields resolve `UNKNOWN` instead of being invented.

**Consequences:**

- Wizard-only assessments (no technical evidence yet) never trigger Risk Classification Agent.
- Evidence-pending assessments never show risk level.
- Technical-only assessments (no WizardProfile) may trigger Risk Classification once evidence and EngineeringRule gates pass.

#### FR-E6-3: Produce evidence-based risk output

When unlocked, Risk Classification Agent produces risk result with risk level, confidence, triggered rules, legal refs and trace to retrieved/legal-approved sources.

**Consequences:**

- Output must include rule/citation trace.
- Every risk output must trace to `rule_id` where a structured rule applies.
- Output without sufficient legal trace is not final.

#### FR-E6-4: Degrade or block when legal rule/citation is missing

If required legal rule or citation is missing, classification must be degraded or blocked rather than presented as final.

**Consequences:**

- System surfaces missing legal basis.
- Gap analysis and final report cannot rely on unsupported classification.
- LLM must not create legal conclusion when retrieved legal rule/citation is missing for a required conclusion.

#### FR-E6-5: Preserve rule precedence

Hard legal/compliance rules take precedence over LLM interpretation.

**Consequences:**

- LLM output cannot lower risk below hard-rule floor.
- Triggered hard rules are shown in trace.

### Epic 7 - Gap Analysis & Document Generation

**Description:** LCSP uses risk result and legal obligations to create gap analysis and compliance report, subject to gating.

#### FR-E7-1: Generate gap analysis after risk result

System generates gap analysis only after valid evidence-based risk classification exists.

**Consequences:**

- Gap items reference applicable obligations and evidence status.
- Gap analysis is not generated from Wizard-only readiness.

#### FR-E7-2: Generate compliance document/report

Manager can generate compliance document/report only when classification and gap analysis are valid and no material/critical conflict remains unresolved.

**Consequences:**

- Report includes classification, gap summary, legal refs, evidence trace and audit summary.
- Report cannot be generated as final from `SELF_DECLARED_READINESS`.

#### FR-E7-3: Support readiness-only export

Manager may export readiness-only output when technical evidence is unavailable.

**Consequences:**

- Readiness-only output contains missing evidence checklist and preliminary indicators.
- Readiness-only output does not contain HIGH/MEDIUM/LOW.

#### FR-E7-4: Superseded attestation disclosure

Attestation disclosure is `SUPERSEDED_FOR_ACTIVE_MVP` because structured attestation is removed from the active MVP.

**Consequences:**

- Active reports must not depend on attestation use.
- Historical decision records may preserve previous attestation disclosure discussions.

### Epic 8 - Audit Trail

**Description:** LCSP records every material input, decision and generated artifact required to trace assessment outcome.

#### FR-E8-1: Audit Wizard answers

System records Wizard answers, timestamps and Manager identity.

**Consequences:**

- Later edits are versioned.
- Audit can distinguish original and updated answers.

#### FR-E8-2: Audit technical evidence metadata

System records evidence source type, provenance, repository-analysis/report version, Deep Agents/tool versions, configuration hash where applicable, timestamp, scope, privacy flags, report hash and evidence status.

**Consequences:**

- Evidence can be traced to source and version.
- Missing metadata prevents final classification.

#### FR-E8-3: Audit conflict resolution

System records conflict score, conflict type, resolver role, decision, rationale and timestamps.

**Consequences:**

- Conflict resolution shows Manager final resolution and safe evidence/context references used as input.

#### FR-E8-4: Superseded human technical attestation audit

Human technical attestation audit is `SUPERSEDED_FOR_ACTIVE_MVP` because structured attestation is removed from active MVP.

**Consequences:**

- Active audit requirements cover RBAC decisions, trigger decisions, evidence, conflict, classification and document events.
- Historical records must not be silently deleted.

#### FR-E8-5: Audit classification and generated documents

System records classification output, rule/citation trace, gap analysis output, generated document version and report/export timestamp.

**Consequences:**

- Final report can trace back to evidence, rules and decisions.

### Product Capability 9 - Shared Wallet and Governed Model Usage

**Description:** Customer model usage is funded from one shared prepaid wallet and charged per physical provider invocation through immutable pricing, server-issued admission, actual-usage settlement and auditable recovery. Billing does not grant or override runtime safety allowances.

#### FR-083: Shared prepaid wallet

Each customer has one shared prepaid wallet across assessments. Customer reads expose `spendableCredits` and `outstandingCredits` rather than an ambiguous signed balance.

**Consequences:**

- Assessments do not receive separate credit allocations or reservations.
- Wallet reads and mutations are scoped to the authenticated owner; ADMIN access requires explicit RBAC authority.

#### FR-084: Idempotent confirmed-payment credit

Confirmed payment credits pre-tax service value exactly once. Checkout and payment records separate service value, customer transaction tax, payment total and credited microcredits.

**Consequences:**

- Tax never becomes spendable credit.
- Payment retry does not double-credit and does not create runtime token/call allowance.

#### FR-085: Governed model-pricing publication

Admin can edit pricing drafts and publish immutable pricing snapshots plus non-overlapping effective assignments with audit provenance.

**Consequences:**

- Initial draft assumptions are `26,500 VND/USD`, infrastructure overhead `10%` of converted provider cost and markup multiplier `1.8` on estimated loaded cost.
- These values are editable, versioned planning inputs, not runtime constants or universal approved tariffs.
- Provider cost source, billing currency, realized settlement source and customer transaction tax remain distinct.

#### FR-086: Deterministic pricing resolution

Pricing resolves in order: exact resolved model, provider default, then optional global default. Fallback pricing applies only to a resolved model already allowed by runtime policy.

**Consequences:**

- Wildcards or defaults cannot legitimize an unknown model or spelling error.
- Each physical invocation pins requested model, resolved model, pricing snapshot and pricing-resolution reason.

#### FR-087: Canonical microcredit calculator

Pricing preview and settlement use one deterministic integer-microcredit calculator for input, cached input, cache write, visible output and reasoning buckets supported by the provider receipt.

**Consequences:**

- Missing required bucket rates fail closed instead of becoming zero.
- Runtime settlement never fetches FX, reapplies markup or recalculates customer transaction tax.

#### FR-088: Server-issued invocation admission

Every paid physical provider invocation requires immutable server admission that validates wallet spendability, assessment/run/lease state, runtime allowlist, pricing resolution, maximum exposure and wallet in-flight policy before dispatch.

**Consequences:**

- Admission derives owner, wallet, assessment, run, lease, resolved model, pricing and policy authority server-side.
- Callback or worker payloads cannot override financial identity or charge authority.

#### FR-089: Atomic actual-usage settlement

Provider-confirmed usage settles per physical `invocationId` as one indivisible authoritative financial effect: either the durable debit, wallet projection, usage outcome and audit obligations all become visible consistently, or none becomes authoritative.

**Consequences:**

- Same-identity replay cannot double-debit; conflicting replay fails closed.
- An admitted in-flight invocation may settle into an outstanding balance within its admitted maximum exposure.
- Confirmed usage remains billable when output is truncated, schema-invalid or rejected by downstream domain validation.

#### FR-090: Payment-required and manual Continue

When spendable balance is not positive, LCSP blocks new paid invocations and exposes `PAYMENT_REQUIRED`. Top-up clears outstanding usage before creating spendable balance and never resumes an assessment automatically.

**Consequences:**

- Customer explicitly selects Continue after top-up.
- Continue re-evaluates wallet, run/lease, pricing and applicable runtime safety gates. No-progress is not an assessment blocker.

#### FR-091: Customer charge history

Customer can inspect charges grouped by logical operation and expanded into separately billable physical retry/fallback invocations.

**Consequences:**

- Safe details include provider/model, token buckets, pricing version/resolution, credits, outcome and correlation reference.
- Raw prompt/output, secrets and internal margin assumptions are excluded.

#### FR-092: Unknown-usage reconciliation

Timeout or incomplete usage metadata becomes `OUTCOME_UNKNOWN`; it is not silently treated as zero usage or a successful settlement.

**Consequences:**

- Late receipt processing follows explicit terminal precedence.
- Unbound callbacks may be quarantined as non-billable telemetry but cannot create financial state.

#### FR-093: Immutable compensation

An eligible waiver/refund creates a bounded immutable compensation entry linked to the original debit.

**Consequences:**

- Compensation cannot exceed the uncompensated amount and never edits/deletes the original debit.
- Goodwill credit is a distinct action and cannot masquerade as compensation.

#### FR-094: Billing/runtime separation

Wallet/payment authority answers whether customer funds may start paid work; runtime safety answers whether work may continue safely. Admin runtime override cannot add wallet credits, and payment cannot grant model-call/token allowance. No-progress does not require an Admin unlock.

**Consequences:**

- Paid-tool billing remains deferred outside Prompt 8.
- Production model-usage debit remains disabled until all seven approved enablement gates have GREEN, rollback and operational evidence.

## 8. Non-Functional Requirements

### Product-Level Security and Privacy

- NFR-1: Raw source code must not be sent to LLM.
- NFR-2: Raw source code must not be stored long term.
- NFR-3: GitHub App access must be read-only and limited to selected repositories for MVP default path.
- NFR-4: Technical findings shown to Manager must avoid unnecessary source/code exposure.
- NFR-5: Secrets must be redacted before any evidence snippet or summary is stored.

### Reliability and Governance

- NFR-6: Risk classification must be repeatable for the same VerifiedProfile, legal corpus/rule version and evidence version.
- NFR-7: Every final report must be traceable to assessment, evidence, rules, conflict resolutions and document version.
- NFR-8: Legal corpus/rule version used for classification must be recorded.
- NFR-9: System must fail closed for missing critical evidence, missing legal trace or unresolved material conflict.

### Financial Integrity and Billing Safety

- NFR-036: Authoritative credit/tariff arithmetic uses integer microcredits and canonical decimal-string wire formats; floating point, exponent notation and implicit rounding are forbidden.
- NFR-037: Payment credit, admission, settlement, reconciliation and compensation are idempotent; each authoritative financial effect is atomic, externally consistent and cannot expose partial credit/debit state.
- NFR-038: Financial identity and amount authority is derived from immutable server records; missing, foreign, expired or mismatched admission fails closed without financial writes.
- NFR-039: Legacy-credit migration must preserve exact value, prevent mixed-unit corruption, reconcile every wallet before authority cutover, support rollback and avoid reinterpreting an existing stored unit in place. Migration mechanics belong to ADR-028.
- NFR-040: Every enabled synchronous, asynchronous, retry, fallback and preparation provider-call path obtains valid wallet admission before dispatch.
- NFR-041: Billing telemetry preserves pricing provenance, invocation/outcome and correlation metadata without raw prompts, outputs, secrets or provider credentials.
- NFR-042: Production debit enablement requires approved tariffs plus GREEN, rollback and operational evidence for all seven enablement gates.

### Usability

- NFR-10: Manager-facing language must avoid technical implementation terms unless accompanied by plain-language explanation.
- NFR-11: Any future delegated task must include enough assessment context to act without exposing unnecessary business data.
- NFR-12: Evidence statuses must be understandable to Manager users.

### Accessibility and Localization

- NFR-13: MVP UI copy and documents should support Vietnamese as primary language.
- NFR-14: Web UI must target WCAG 2.2 AA for forms, status messages, payment-required recovery, pricing operations and document review, including keyboard operation and programmatic status announcements.

## 9. Status / State Model

PRD-level state model:

- `WIZARD_IN_PROGRESS`: Manager đang điền Wizard.
- `SELF_DECLARED_READINESS`: Wizard submitted, chưa có technical evidence, chỉ readiness/preliminary indicators.
- `TECHNICAL_EVIDENCE_REQUIRED`: Cần GitHub Repository Scan result; Manager can complete this path without external collaborator assignment.
- `DEVELOPER_INVITED`: Retired historical state; not active in MVP runtime.
- `EVIDENCE_COLLECTION_IN_PROGRESS`: Legacy umbrella state; MVP uses Manager-owned repository connection/scan states.
- `TECHNICAL_EVIDENCE_MISSING`: Chưa có report.
- `TECHNICAL_EVIDENCE_REJECTED`: Report thiếu schema hoặc vi phạm privacy.
- `TECHNICAL_EVIDENCE_INSUFFICIENT`: Report hợp lệ nhưng quality thấp.
- `TECHNICAL_EVIDENCE_READY`: Report đủ schema và đạt quality.
- `RECONCILIATION_REQUIRED`: Có conflict cần xử lý.
- `CONFLICT_RESOLUTION_REQUIRED`: Có conflict, cần Manager xử lý trước khi classification.
- `MANAGER_CONFIRMATION_REQUIRED`: Cần Manager resolve conflict hoặc confirm business/legal/technical interpretation.
- `DEVELOPER_CONFIRMATION_REQUIRED`: Legacy/post-MVP optional delegated clarification; không phải MVP blocking state.
- `VERIFIED_PROFILE_READY`: VerifiedProfile đã sẵn sàng.
- `READY_FOR_CLASSIFICATION`: Đủ điều kiện chạy Risk Classification Agent.
- `CLASSIFIED`: Risk classification hoàn tất với legal trace.
- `GAP_ANALYZED`: Gap analysis hoàn tất.
- `REPORT_READY`: Có thể generate final report.
- `BLOCKED_BY_CONFLICT`: Có material/critical conflict chưa resolve.
- `PAYMENT_REQUIRED`: Wallet cannot fund a new paid invocation; completed artifacts remain preserved.
- `WAITING_FOR_CUSTOMER_CONTINUE`: Top-up has restored spendable credits but the customer has not explicitly resumed the assessment.
- `OUTCOME_UNKNOWN`: A dispatched invocation lacks durable terminal usage evidence and awaits bounded reconciliation.
- `BILLING_INTEGRITY_REVIEW`: Usage, exposure, pricing or projection evidence is contradictory and financial automation has failed closed for operator review.

## 10. Scoring Model

### Evidence Confidence Score

Purpose: evidence kỹ thuật đáng tin tới đâu.

Rules:

- Supporting signal only.
- Không tự block workflow.
- Có thể kích hoạt Manager conflict resolution nếu cao và mâu thuẫn với Wizard.

### AI Intervention Score

Purpose: AI can thiệp sâu tới đâu vào workflow/decision.

Rules:

- Supporting signal only.
- Không tự block workflow.
- Dùng làm input cho classification sau VerifiedProfile.

### Conflict Score

Purpose: WizardProfile và TechnicalProfile mâu thuẫn nghiêm trọng không.

Rules:

- Score duy nhất có thể block workflow.
- Material conflict threshold candidate: `>= 0.75`.
- Critical conflict threshold candidate: `>= 0.85` trên critical fields.

Critical fields:

- `auto_decision`
- `data_types`
- `sector`
- `ai_type`
- `human_oversight`
- `external_llm_user_facing`
- `biometric_processing`

Blocking rule:

```text
Conflict Score >= 0.75
AND conflict ảnh hưởng đến risk classification hoặc nghĩa vụ pháp lý
```

## 11. Evidence Requirements

### Minimum Evidence Sources

Accepted evidence sources:

**Active MVP golden evidence path**

- GitHub App read-only Repository Scan created or resumed through `FR-050` Automatic Trusted Scan Initiation.

**Removed or inactive paths**

- Structured human technical attestation is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Local/CI scanner report upload is `SUPERSEDED_FOR_ACTIVE_MVP` by `FR-050`.
- Manual technical evidence JSON upload (`FR-051`) is `REMOVED_FROM_PRODUCT`.
- Delegated technical clarification (`FR-052`) is `DEFERRED_POST_MVP`.
- API probe evidence, unless separately approved through change control.

### Minimum Evidence Schema Groups

Technical evidence report must include:

- `assessment_id`
- `source_type`
- `system_identifier`
- `provenance`
- `repository_analysis_version` or `report_version`
- `timestamp` or `generated_at`
- `scope`
- `privacy_flags`
- `technical_profile`
- `findings[]`
- `confidence_per_signal`
- `report_hash`

### Minimum Technical Profile Dimensions

`technical_profile` must include:

- `ai_usage_signals`
- `data_type_signals`
- `decision_flow_signals`
- `human_oversight_signals`

Each dimension may be `DETECTED`, `NOT_DETECTED` or `UNKNOWN`, but the field must exist.

### Superseded Attestation Guardrails

Human technical attestation is `SUPERSEDED_FOR_ACTIVE_MVP`. Prior guardrail discussion remains historical only and must not create active UX, API, entity, event, audit, report, epic, story or delivery work.

No human assertion can replace these machine-generated or external metadata:

- report hash;
- repository-analysis version;
- tool/configuration hash;
- scan timestamp;
- repo/commit metadata;
- privacy flags generated by repository analysis;
- dependency inventory/SBOM;
- legal corpus version;
- evidence report integrity;
- machine-generated privacy flags;
- vendor compliance documents.

## 12. Reconciliation Rules

- LCSP compares WizardProfile, TechnicalProfile and AIUsageFlow only after technical evidence is accepted for reconciliation.
- Any MVP conflict pauses workflow and creates a Manager conflict-resolution task.
- Manager reviews WizardProfile, TechnicalProfile and AIUsageFlow evidence, then resolves or updates relevant information.
- Manager remains final resolver for technical, business/legal and cross-boundary MVP conflicts.
- Delegated technical correction input is not active in MVP; any future version requires change control.
- LCSP coordinates and records the process but does not act as the human authority.
- VerifiedProfile cannot be created while any conflict remains unresolved.
- Every conflict resolution must be auditable.

Examples:

- Repository analysis detects evidence of AI-related dependency/package use: Manager resolves or requests re-analysis/correction.
- Repository-analysis false positive/false negative: Manager resolves with evidence review, re-analysis/correction, and safe context references; structured attestation under `FR-046` is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Wizard business purpose is wrong: Manager resolves.
- AI affects decision/workflow: Manager resolves using WizardProfile, TechnicalProfile and AIUsageFlow evidence.
- Auto decision or human oversight conflict: Manager resolves; structured attestation does not participate in active MVP conflict completion, and delegated clarification remains `DEFERRED_POST_MVP` under `FR-052`.

## 13. Reporting Rules

- Final report cannot be generated before evidence-based classification and gap analysis are valid.
- Final report cannot be generated while material/critical conflict remains unresolved.
- Readiness-only export is allowed without technical evidence but must not include HIGH/MEDIUM/LOW.
- Classification output must include legal citation/rule trace.
- If required legal rule/citation is missing, classification must be degraded or blocked, not finalized.
- Report must include enough audit summary to trace major decisions.

## 14. Audit Trail Expectations

LCSP audit trail must record:

- Wizard answers and versions.
- Assessment owner and RBAC policy decisions.
- Evidence source metadata.
- Repository-analysis engine/model/tool versions and configuration hashes where applicable.
- Report hash and timestamp.
- Scope and privacy flags.
- Evidence gate result and reason.
- Conflict records, score and required resolver.
- Manager conflict resolutions and safe context references that materially influence a decision.
- RBAC policy ID/version and decision trace for material authorization decisions.
- Automatic scan trigger source, delivery/correlation refs, and mapping decision.
- VerifiedProfile version.
- Classification output and rule/citation trace.
- Gap analysis output.
- Generated document version and export timestamp.

Audit trail must support the question: "Why did LCSP reach this conclusion, based on what evidence, under which rules, and who confirmed unresolved ambiguity?"

## 15. High-Risk Assumptions & Validation Requirements

### A1. Wizard simplicity vs completeness

**Risk:** Wizard quá đơn giản thì thiếu business/legal truth. Wizard quá chi tiết thì Manager không hoàn tất được hoặc phải cần hỗ trợ kỹ thuật ngoài luồng.

**PRD Requirements:**

- Wizard question design must use business/legal language, not code terms.
- Wizard must use progressive disclosure for complex topics.
- Wizard must include examples for high-risk fields such as auto decision, human review, affected rights, personal/sensitive data, external LLM and biometric use.
- Every Wizard question must map to a WizardProfile field.
- Wizard must capture enough critical fields for MVP:
  - purpose;
  - sector;
  - data type;
  - user group;
  - user impact;
  - decision role;
  - human oversight;
  - external LLM usage.
- Every required WizardProfile field must map to reconciliation use, classification use, document output or compliance trace.
- Critical unknown answers must route to evidence/readiness tasks rather than silently becoming final input.

**Validation Plan:**

- Prototype Wizard question set for at least public chatbot, credit scoring and internal HR screening.
- Test with non-technical Manager-like users.
- Measure completion, confusion points and fields requiring out-of-band technical help.
- Revise Wizard before implementation acceptance if users cannot answer critical fields.

### A2. Legal corpus/rule reliability

**Risk:** Classification is weak if legal rules are not versioned, cited and traceable. LCSP must not let LLM infer law without legal basis.

**PRD Requirements:**

- Classification output must include citation from legal corpus/rules.
- Legal rules must be versioned.
- Important rules must trace to legal source.
- Every important risk output must trace to a `rule_id`.
- Legal corpus/rule version must be recorded in audit.
- If rule/citation is missing for a required conclusion, classification must be degraded or blocked.
- LLM must not create legal conclusion if retrieved legal rule/citation is missing.
- LLM output cannot override hard rules or invent legal references outside approved sources.

**Validation Plan:**

- Define MVP legal corpus inventory.
- Draft sample compliance rules for representative scenarios.
- Create scenario/evaluation fixtures with expected risk, rules and citations.
- Validate citation accuracy before implementation acceptance for classification scope.

### A3. RBAC and trusted-trigger abuse risk

**Risk:** A subject, service identity, role label, or integration trigger could be misused to bypass RBAC or start a scan for the wrong owner, repository, wallet, or assessment.

**PRD Requirements:**

- RBAC must evaluate subject, owner/resource scope, action, request/runtime context, policy and policy version.
- Authorization must be deny-by-default, owner/resource-scoped, server-side enforced, versioned and auditable.
- Trusted scan triggers must validate source identity, assessment owner, repository connection, assessment mapping, configured branch and commit SHA.
- Missing or ambiguous mapping must produce `PENDING_MAPPING`, `BLOCKED_MAPPING` or `WAITING_FOR_CONTEXT` instead of scanning.
- Every authorization and trigger decision must include safe context refs and correlation ID.
- Structured attestation remains removed from active MVP and cannot be used to legitimize weak evidence.

**Validation Plan:**

- Define RBAC policy model and engine decision before implementation.
- Test abuse cases: wrong owner/wallet, ambiguous assessment mapping, revoked repository connection, duplicate trigger, out-of-order trigger, policy unavailable, callback mass assignment and service identity overreach.
- Verify no role label alone grants final authority.
- Verify no trigger can scan the wrong repository or assessment.

### A4. Prompt 8 financial enablement

**Risk:** Editable Pricing Draft assumptions, incomplete provider-call coverage, mixed accounting units or unresolved usage could create incorrect customer charges even when individual APIs appear functional.

**PRD Requirements:**

- Suggested tariffs must disclose their approved cost-source, fee, infrastructure and risk-buffer inputs.
- Production debit remains disabled through contract RED, shadow accounting/pricing, mandatory admission-with-debit-off and shadow settlement phases.
- Gates `G-01..G-07` in `docs/product/addendum.md` define accountable owners, measurable exit conditions and minimum evidence.
- Payment and pricing authority must remain independent from applicable runtime safety controls.

**Validation Plan:**

- Complete the approved delivery sequence in the PRD Addendum without skipping a shadow phase.
- Run contract, concurrency, BOLA/mass-assignment, migration/rollback, provider-path inventory and reconciliation tests required by `G-01..G-07`.
- Obtain joint Product Owner, Finance Owner and Release Authority go/no-go approval; any missing or RED evidence keeps debit disabled.

## 16. Open Questions

### Wizard

- Minimum business/legal truth required for MVP classification is not fully validated.
- Exact Wizard field list and wording still need user testing.
- Behavior for Manager "I don't know" on critical fields needs final product decision.
- Wizard stories that depend on critical-unknown routing cannot reach implementation acceptance until Product Owner approves the state/next-action rule from A1 validation.

### Legal Corpus and Rules

- MVP legal corpus inventory needs confirmation.
- Minimum compliance rule schema needs confirmation.
- Rule review/approval owner is not yet defined.
- Behavior for incomplete legal corpus in a scenario needs final decision.
- Legal classification stories cannot reach implementation acceptance until Legal/Product owners approve corpus inventory, rule schema, review authority and incomplete-corpus fail behavior from A2 validation.

### Evidence and Repository Analysis

- GitHub App read-only acceptance by target MVP users needs validation.
- Scope coverage for monorepos needs definition.
- Stale evidence behavior when commit/branch changes needs decision.
- `FR-050` Automatic Trusted Scan Initiation technical behavior is `TECHNICAL_DECISION_REQUIRED` for final idempotency, retry/DLQ and replay details.
- Manual evidence JSON (`FR-051`) is `REMOVED_FROM_PRODUCT`.
- Delegated technical clarification (`FR-052`) and API probe evidence are inactive unless reopened by change control.
- Source-retention/evidence-quality stories may be decomposed and tested, but cannot reach implementation acceptance until Product, Security and Data owners approve a numeric retention/deletion bound, deletion evidence, versioned scenario thresholds and fail behavior. No implementation may invent these values locally.

### Attestation

- Exact list of optional human-attestable claims remains historical and out of active MVP.
- RBAC engine/storage/cache/invalidation/topology/failure behavior is `TECHNICAL_DECISION_REQUIRED`.
- Repository-analysis failure/coverage policy follows the Agent Runtime contract and fail-closed evidence rules.

### Reporting

- Exact contents of readiness-only export need definition.
- Manager-visible wording for automatic trigger mapping states needs UX design after documentation remediation.

### Shared Wallet and Pricing Operations

- Initial customer tariffs remain blocked until provider cost sources and token-bucket rates are verified and approved; `26,500`, `10%` and `1.8` are Pricing Draft assumptions only.
- Exact customer/provider tax treatment requires approved finance/accounting policy; tax is structurally separated from spendable credits now and no tax rate is hardcoded.
- The 500,000 VND monthly infrastructure baseline must be compared with realized infrastructure cost to validate or revise the 10% overhead assumption.
- No business output/token cap is approved until usage telemetry supports a separate policy decision.

## 17. Acceptance Criteria

### Product Acceptance Criteria

- AC-1: A Wizard-only assessment never displays HIGH/MEDIUM/LOW.
- AC-2: Risk Classification cannot run before direct EngineeringRule assessment has evidence refs and legal-rule provenance.
- AC-3: Technical evidence must pass schema completeness gate before reconciliation.
- AC-4: Technical evidence must pass quality threshold gate before classification unlock.
- AC-5: Any unresolved conflict blocks final classification/report until resolved.
- AC-6: Manager conflict resolution is required and sufficient for MVP conflict completion when evidence gates pass.
- AC-7: Evidence Confidence Score and AI Intervention Score never block workflow alone.
- AC-8: Conflict handling uses binary MVP routing: conflict exists or not. Conflict Score may explain seriousness but does not create multiple routes.
- AC-9: Human assertion, role label, or untrusted upload cannot replace machine-generated metadata listed in A3.
- AC-10: Final report includes legal citation/rule trace or is not final.
- AC-11: Final report has no attestation dependency and discloses evidence, legal basis, RBAC/trigger trace and limitations.
- AC-12: Audit trail records wizard, evidence, conflict, RBAC/trigger decisions, classification and document generation events.
- AC-051: Customer wallet reads expose exact spendable and outstanding credit projections scoped to the authenticated owner.
- AC-052: Confirmed payment retry credits pre-tax service value at most once and never creates runtime allowance.
- AC-053: Admin publishes immutable pricing snapshots/assignments atomically with audit; stale version and overlapping effective intervals are rejected.
- AC-054: Pricing resolution follows exact model, provider default, then optional global default and rejects a model outside the runtime allowlist.
- AC-055: Preview and settlement produce identical integer-microcredit results for the same snapshot/usage; missing required buckets fail closed.
- AC-056: No enabled paid provider invocation dispatches without immutable server admission bound to owner, wallet, assessment/run/lease, resolved model, pricing and maximum exposure.
- AC-057: Settlement replay cannot double-debit; a settlement exposes one complete, auditable financial effect or no authoritative debit, with no externally visible partial wallet state.
- AC-058: Wallet without positive spendable balance blocks new paid work; top-up clears outstanding first and never resumes an assessment without customer Continue.
- AC-059: Customer charge history distinguishes logical operation from each physical retry/fallback invocation without exposing raw content or internal margin.
- AC-060: Missing or late usage remains outcome-unknown until durable evidence closes or escalates the case; it is not silently zeroed.
- AC-061: Compensation is append-only, references an original debit, and cannot exceed its uncompensated amount.
- AC-062: Production model-usage debit cannot be enabled until gates `G-01..G-07` in the PRD Addendum each satisfy their measurable exit condition, named owner approval and required evidence package.
- AC-063: Payment/top-up cannot grant or extend runtime safety allowance, runtime override cannot create wallet credit, and Continue re-evaluates both authorities independently before dispatch.

### PRD Acceptance Criteria

- AC-13: PRD preserves all mandatory product decisions from Product Brief.
- AC-14: PRD contains section for high-risk assumptions and validation requirements.
- AC-15: PRD does not introduce new implementation design, backlog or code; inherited approved architecture constraints are labeled explicitly and remain governed by active architecture records.
- AC-16: PRD is clear enough for Architect Agent to identify product constraints and unresolved assumptions.

## 18. PRD Readiness for Architecture

**Current status:** Final product authority is ready for Prompt 8 architecture and UX correction plus contract RED-test design. Production readiness remains conditional: this PRD does not authorize production model-usage debit or approve customer tariff values.

Architecture may proceed to explore system boundaries and feasibility only if it preserves these non-negotiable product constraints:

- no risk level without technical evidence;
- no Risk Classification before VerifiedProfile;
- no human assertion, role label or untrusted upload bypass for machine-generated metadata;
- any unresolved conflict blocks classification/report until Manager resolution is complete;
- Wizard-only remains readiness/preliminary indicators only.
- shared-wallet billing remains separate from runtime safety authority;
- customer transaction tax never becomes spendable credit;
- immutable per-invocation admission and pricing authority precede any financial settlement;
- paid-tool billing remains deferred;
- production debit remains disabled until all seven enablement gates have approved evidence.

Before final architecture signoff, product must validate or carry forward these blockers:

1. Wizard question model can collect enough business/legal truth without technical wording.
2. Legal corpus/rule reliability can support cited, traceable classification.
3. RBAC and trusted-trigger guardrails prevent authorization and scan-initiation bypass.
4. Provider cost sources, tax treatment and initial immutable customer tariffs receive owner/finance approval.
5. Mixed-unit migration, provider-call admission coverage, reconciliation and rollback are proven before debit enablement.

Recommended next step:

```text
Proceed with ADR-028, Prompt 8 UX, epic correction and contract RED tests using this PRD plus the canonical FR/NFR catalogs.
Do not enable production debit or publish initial ACTIVE tariffs until the financial open items and seven enablement gates have approved evidence.
```

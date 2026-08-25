---
baseline_commit: fad76ae81090f42c749c507960588b9b79cda385
---

# Story 1.1: Approved Account Entry and Workspace Access

Status: done

Implementation update 2026-08-25: LCSP now supports self-signup without an
invitation or acceptance token through `POST /auth/sign-up` and `/sign-up`.
This path creates a new Manager-owned organization workspace, Manager PBAC
policy, active membership, and scoped session atomically. Invitation acceptance
remains the path for Developer/scoped collaborator onboarding.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to register or enter LCSP through an approved authentication path,
so that I can access only the workspace I am authorized to use.

## Acceptance Criteria

1. Given a user has an approved account or invitation, when the user registers or signs in with valid credentials, then LCSP creates an authenticated session scoped to the correct user identity, denies workspace access until organization membership is confirmed, rejects invalid credentials / invalid invite state / missing membership with safe user-facing messages, and records success or failure in audit without secrets.
2. Given a user attempts to access a protected workspace without authentication, when the request reaches Web/API, then LCSP blocks access, routes the user to the approved sign-in flow, and returns no workspace data.

## Tasks / Subtasks

- [x] Thiết lập auth entry flow theo boundary của Story 1.1 trong Web + NestJS API, chỉ cho approved account/invitation path (AC: 1, 2)
  - [x] Tạo public entry screens/routes cho đăng ký hoặc đăng nhập bằng approved path; không ghép OAuth/OIDC callback/provider handling vào story này.
  - [x] Tạo self-signup path cho Manager khởi tạo workspace mới mà không cần invitation acceptance.
  - [x] Định nghĩa DTO/validation cho register/sign-in với stable error code, safe message, correlation id và không echo secret/token/password.
  - [x] Giữ rõ boundary: OAuth/OIDC login thuộc Story 1.3; MFA/session recovery/profile safety thuộc Story 1.2.
- [x] Tạo session đăng nhập và gate truy cập workspace theo membership/verification policy (AC: 1)
  - [x] Chỉ tạo session sau khi identity proof hợp lệ qua approved path.
  - [x] Chặn sensitive workspace access khi chưa có `OrganizationMembership` active hoặc invite/email verification chưa hợp lệ theo policy.
  - [x] Trả về trạng thái chặn rõ lý do an toàn cho các case `invalid_credentials`, `invalid_invite_state`, `membership_missing`, `email_verification_required`.
- [x] Bảo vệ workspace ở cả Web và API theo deny-by-default (AC: 2)
  - [x] Protected web routes phải redirect về sign-in flow trước khi render workspace data.
  - [x] Protected API endpoints phải fail closed khi thiếu session hoặc session không hợp lệ, và không trả dữ liệu tenant/workspace.
  - [x] UI capability là non-authoritative; enforcement thực tế phải nằm ở backend guard + service recheck.
- [x] Tạo persistence/audit contract tối thiểu cho auth + membership + authorization decision (AC: 1, 2)
  - [x] Tạo hoặc scaffold các model/tables cần cho `User`, `Session`, `Organization`, `OrganizationMembership`, `Policy`, `PolicyVersion`, `AuthorizationDecision`, `AuditEvent`.
  - [x] Bảo đảm session token và MFA/OAuth secret không được lưu plaintext.
  - [x] Ghi audit cho login success/failure, access denied, session creation/revocation, policy decision allow/deny với correlation id và policy id/version khi áp dụng.
- [x] Thiết kế safe messages và state handling cho blocked auth states (AC: 1, 2)
  - [x] Web copy phải an toàn, không rò membership nội bộ, token, policy internals hoặc secret material.
  - [x] Permission-denied / blocked states phải có `required_action` rõ ràng như sign in, verify email, accept valid invite, hoặc contact organization owner.
- [x] Bổ sung test coverage cho happy path và negative path auth/workspace gating (AC: 1, 2)
  - [x] API integration/contract tests cho valid sign-in, invalid credential, invalid invite, missing membership, expired/revoked session, protected route without auth.
  - [x] Auth abuse tests cho repeated failed login theo rate-limit/temporary lock expectation.
  - [x] Web tests cho redirect-to-sign-in, no workspace data leak, safe blocked copy, và capability projection không thay thế server enforcement.

### Review Findings

- [x] [Review][Patch] Approved invites can be replayed indefinitely [apps/api/src/app.js:203]
- [x] [Review][Patch] Registration invents Manager-scoped membership instead of honoring invite-derived scope [apps/api/src/app.js:226]
- [x] [Review][Patch] Workspace authorization ignores policy state gates and reduces PBAC to role/action matching [apps/api/src/app.js:56]
- [x] [Review][Patch] Protected workspace access ignores requested organization scope mismatch [apps/api/src/app.js:378]
- [x] [Review][Patch] Orphaned sessions can crash workspace access instead of failing closed [apps/api/src/app.js:406]
- [x] [Review][Patch] Sign-in can crash on malformed stored password hashes [apps/api/src/security.js:8]
- [x] [Review][Patch] Registration stores email keys inconsistently with sign-in lookup normalization [apps/api/src/app.js:218]
- [x] [Review][Patch] Web routing redirects all denied states to sign-in instead of surfacing the required blocked action [apps/web/src/workspace-routes.js:3]

## Dev Notes

- Đây là story mở epic 1 và cũng là story auth/workspace đầu tiên của repo. Hiện tại repo chưa có application code; implementation phải bám authority docs, không tự phát minh topology hoặc framework wiring ngoài tài liệu hiện hành.
- Story này chỉ bao phủ approved account entry, authenticated session, membership gate và workspace protection. Không triển khai OAuth/OIDC end-to-end ở đây ngoài chừa interface seam cần thiết; OAuth/OIDC thuộc Story 1.3. Không triển khai MFA/recovery/profile safety ngoài seam cần thiết; phần đó thuộc Story 1.2.
- Manager phải có thể hoàn tất MVP không phụ thuộc Developer. Vì vậy auth/workspace foundation phải phục vụ Manager golden path trước, còn Developer chỉ là scoped collaborator ở các story sau.

### Current State and Scope Guardrails

- Repo hiện là documentation-first; chưa có file mã nguồn để update. Dev agent được phép tạo mã mới, nhưng phải đi theo retained package topology thay vì tạo thư mục ad hoc.
- Topology được giữ lại cho runtime TypeScript-first là `apps/api` cho NestJS API, `apps/web` cho Next.js web, và `packages/*` cho shared contracts/helpers. Python worker monorepo là workstream khác và không thuộc story này. [Source: docs/architecture/adr/adr-022-typescript-first-npm-only-controlled-prototype.md]
- Nếu `module task catalog` chưa được hiện thực hóa, dev agent chỉ nên tạo bootstrap tối thiểu cần cho auth/workspace slice này và vẫn giữ tương thích với layout bootstrap chung về sau; không mở rộng sang scanner/worker/legal stacks. [Source: docs/implementation/tasks/modules/README.md]

### Architecture Compliance

- Web Frontend chỉ gọi Backend API; mọi enforcement authz thực tế là server-side. [Source: docs/implementation/backend-implementation.md#Implementation Boundaries]
- NestJS API là synchronous control plane cho auth, session, PBAC enforcement boundary, domain validation, audit emission và async work creation; không đẩy long-running logic vào request cycle. [Source: docs/architecture/architecture.md] [Source: docs/implementation/backend-implementation.md]
- PBAC là authorization source of truth. Role label `Manager`/`Developer` chỉ là subject attribute hoặc policy template. Không được dùng role label đơn thuần để authorize workspace access. [Source: docs/product/prd.md#4-pbac-policy-model] [Source: docs/implementation/decisions/pbac-runtime-decision.md]
- Mọi protected action phải evaluate `subject + organization + resource + action + runtime context + policy version + state gate`. Thiếu policy, thiếu attribute, cache/evaluator failure, state gate unavailable đều phải deny-by-default trừ public unauthenticated routes. [Source: docs/implementation/decisions/pbac-runtime-decision.md]
- OAuth/OIDC identity và GitHub repository authorization là hai boundary riêng biệt. Story này không được tạo side effect repository access nào từ login/session. [Source: docs/architecture/architecture.md] [Source: docs/product/business-rules.md#BR-088]

### Functional and Domain Requirements

- Story này thực hiện trực tiếp `FR-001` và `FR-002`, đồng thời phải giữ compatibility với `FR-003..FR-006` sẽ đi ở story kế tiếp trong cùng use case `UC-001`. [Source: docs/specs/functional-requirements.md]
- `UC-001` yêu cầu thiết lập organization-scoped session an toàn qua password/MFA hoặc OAuth/OIDC approved path; invalid identity/callback/MFA/session/rate-limit state phải bị deny an toàn và audited. [Source: docs/specs/use-cases.md#uc-001-authenticate-and-manage-account]
- `BR-001`, `BR-002`, `BR-003`, `BR-005`, `BR-074`, `BR-086..BR-088`, `BR-094` là business rules cốt lõi cho password/invite verification, login protection, session expiration, email verification gate, OAuth safe handling và audit. [Source: docs/product/business-rules.md]
- `NFR-001`, `NFR-002`, `NFR-004`, `NFR-005`, `NFR-006`, `NFR-008`, `NFR-010` là NFR tối thiểu cho auth/session/PBAC/audit mà implementation phải chứng minh bằng tests. [Source: docs/specs/non-functional-requirements.md]

### Data and Persistence Requirements

- Persistence group cần có ít nhất các model `User`, `OAuthIdentity`, `UserMfaMethod`, `Session`, `Organization`, `OrganizationMembership`, `Policy`, `PolicyVersion`, `AuthorizationDecision`, `AuditEvent`. [Source: docs/implementation/persistence-implementation.md#identity-and-access]
- `OrganizationMembership` phải mang tenant/user link, subject label, policy scope và status `invited/active/revoked`; workspace access phải chặn nếu membership chưa active. [Source: docs/specs/domain-model.md#organizationmembership]
- `AuthorizationDecision` phải lưu actor/service, organization, resource ref, action, policy id/version, decision, context refs, correlation id và timestamp. Đây là dữ liệu quan trọng cho deny/allow auditability. [Source: docs/specs/domain-model.md#authorizationdecision]
- Không lưu plaintext session token, OAuth provider token, MFA secret. [Source: docs/implementation/persistence-implementation.md]

### State and Audit Requirements

- Assessment workflow về sau phụ thuộc guard `Manager authorized` ngay từ state tạo assessment; story auth/workspace phải cung cấp actor + org context đủ sạch để state machine kế tiếp dựa vào. [Source: docs/specs/domain-state-machines.md]
- `AuditEvent` là append-oriented; mọi auth success/failure và access deny quan trọng phải ghi audit với correlation id và safe metadata. [Source: docs/implementation/persistence-implementation.md] [Source: docs/specs/event-catalog.md]
- Event/domain fact tối thiểu cần được chuẩn hóa trong implementation slice này gồm login success/failure, session expired/revoked, `PBAC_DECISION_RECORDED`, và auth-related denied actions. Tên cụ thể có thể nằm ở sync audit/domain layer dù chưa thành async queue event. [Source: docs/specs/event-catalog.md]

### File Structure Notes

- Ưu tiên layout:
  - `apps/api` cho auth, organization-membership, session, PBAC guard/service recheck, audit emission.
  - `apps/web` cho sign-in/register/public entry pages và protected workspace routing.
  - `packages/contracts` hoặc shared package tương đương cho DTO/error-code/authz contracts nếu bootstrap đã có.
- Không tạo scanner, worker, legal retrieval, document generation code trong story này.
- Không tạo fake “temporary” top-level folders như `auth-service/`, `frontend/`, `backend/` ngoài topology retained trừ khi bootstrap authority chính thức đã chọn khác và được cập nhật trước.

### Implementation Guidance for the Dev Agent

- Bắt đầu bằng public password/invite path và protected workspace gate; đừng cố nhét OAuth provider UX vào story này chỉ vì architecture có nhắc OAuth/OIDC.
- Membership gate phải chạy sau identity proof nhưng trước khi trả workspace-scoped data. “Có session” không đồng nghĩa “được vào workspace”.
- Safe user-facing messages phải tránh xác nhận thừa về nội bộ tenant. Ví dụ: không phân biệt quá chi tiết giữa “email không tồn tại” và “sai mật khẩu” nếu điều đó làm lộ account existence; nhưng vẫn cần machine-readable error code cho client flow.
- Backend guard chỉ là lớp đầu. Với mọi state-changing endpoint liên quan workspace, service layer phải recheck domain scope/PBAC để tránh bypass từ controller wiring sai. [Source: docs/implementation/backend-implementation.md] [Source: docs/implementation/decisions/pbac-runtime-decision.md]
- UI chỉ được render capability do backend projection trả về; không tự suy luận permission từ role label local state.
- Không tạo bất kỳ `RepositoryConnection`, repo token hay scan permission nào từ auth/session flow. Đó là regression trực tiếp với `FR-006`/`AC-023`. [Source: docs/specs/acceptance-criteria-catalog.md]

### Testing Requirements

- Auth contract tests:
  - self-signup tạo user, workspace, Manager policy, active membership, session và vào được `/workspace`;
  - approved registration/sign-in tạo session thành công;
  - invalid credentials bị reject an toàn;
  - invalid invite state bị reject an toàn;
  - membership missing hoặc membership revoked không được vào workspace;
  - expired/revoked session không gọi protected route được.
- PBAC negative tests:
  - deny-by-default khi thiếu policy/subject attributes/state gate;
  - `AUTHZ_*` failure reason codes map đúng vào safe response;
  - protected download/read/write không được authorize chỉ dựa vào role label.
- Web tests:
  - unauthenticated access redirect về approved sign-in flow;
  - workspace payload không render trước auth thành công;
  - blocked states có next action rõ ràng.
- Audit tests:
  - login success/failure, session revoke/expire, access deny đều có audit record;
  - audit không chứa password, token, plaintext secret hoặc policy internals nhạy cảm.

### Git Intelligence

- 5 commit gần nhất đều là documentation/readiness work (`fad76ae`, `73f4756`, `b1d1444`, `95e7fe0`, `839953a`); chưa có code pattern sản phẩm hiện hữu để bắt chước.
- Kết luận thực dụng: story phải định hướng dev agent bằng authority docs và retained topology, không dựa vào “mã đang có”.

### Previous Story Intelligence

- Không có story trước trong epic này. Đây là story mở đầu nên mọi auth/membership/session guardrails được coi là foundation cho các story 1.2-1.6.

### Latest Technical Information

- NestJS documentation hiện tại vẫn đặt Guards, Authentication, Authorization, Session, Cookies và Rate Limiting trong core guidance; story này nên dùng NestJS guard/interceptor/validation patterns chuẩn thay vì custom middleware tùy hứng. [Source: https://docs.nestjs.com/]
- OpenID Connect Core 1.0 errata set 2 (December 15, 2023) tiếp tục yêu cầu validate chặt `redirect_uri`, `state`, `nonce`, issuer, audience và token expiry trong Authorization Code Flow; đây là seam cần chuẩn bị cho Story 1.3. [Source: https://openid.net/specs/openid-connect-core-1_0.html]
- RFC 9700 nhấn mạnh PKCE áp dụng cho mọi loại OAuth client, gồm cả web applications, và `S256` là challenge method nên dùng; nếu dev agent chuẩn bị abstraction cho OAuth từ bây giờ thì phải để mặc định tương thích với hướng này. [Source: https://datatracker.ietf.org/doc/html/rfc9700]

### References

- [Source: docs/planning-artifacts/epics.md#story-11-approved-account-entry-and-workspace-access]
- [Source: docs/product/prd.md#4-pbac-policy-model]
- [Source: docs/product/business-rules.md]
- [Source: docs/specs/functional-requirements.md]
- [Source: docs/specs/non-functional-requirements.md]
- [Source: docs/specs/use-cases.md]
- [Source: docs/specs/acceptance-criteria-catalog.md]
- [Source: docs/specs/domain-model.md]
- [Source: docs/specs/domain-state-machines.md]
- [Source: docs/specs/event-catalog.md]
- [Source: docs/architecture/architecture.md]
- [Source: docs/architecture/adr/adr-022-typescript-first-npm-only-controlled-prototype.md]
- [Source: docs/implementation/backend-implementation.md]
- [Source: docs/implementation/persistence-implementation.md]
- [Source: docs/implementation/decisions/pbac-runtime-decision.md]
- [Source: docs/implementation/tasks/modules/README.md]
- [Source: https://docs.nestjs.com/]
- [Source: https://openid.net/specs/openid-connect-core-1_0.html]
- [Source: https://datatracker.ietf.org/doc/html/rfc9700]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Workflow activation: resolved customization with no prepend/append steps.
- Persistent facts: loaded `docs/project-context.md` and active implementation authority before starting execution.
- Story selection: resumed `1-1-approved-account-entry-and-workspace-access` from `docs/implementation-artifacts/sprint-status.yaml` because it was already `in-progress`.
- Created a minimal executable bootstrap in retained topology `apps/api`, `apps/web`, `packages/contracts`, and `tests` without expanding into OAuth/MFA/repository authorization scope.
- Auth/session flow now issues organization-scoped sessions only after approved password/invite identity proof, enforces membership + deny-by-default PBAC gating, stores session lookup by token fingerprint plus hashed secret, and emits redacted audit/authorization records with correlation ids.
- Test evidence: `rtk npm test` passed with 14/14 green checks covering API contracts, abuse lock, session invalidation, deny-by-default authz, safe blocked copy, and protected web-route redirect behavior.

### Completion Notes List

- Bootstrapped an executable Story 1.1 auth/workspace slice with public approved entry routes, DTO-safe error contracts, organization-scoped session creation, membership verification, deny-by-default workspace access, and backend-projected capabilities.
- Added in-memory persistence scaffolding for `User`, `Session`, `Organization`, `OrganizationMembership`, `Policy`, `AuthorizationDecision`, and `AuditEvent`, with session lookup via token fingerprint and secret hashing to avoid plaintext storage.
- Added redacted audit emission and authorization decision recording for login success/failure, workspace allow/deny, and session revocation flows.
- Added `node:test` coverage for approved sign-in/registration, invalid credential/invite, email verification gate, membership missing, revoked session, repeated failed-login lock, protected route redirect, safe blocked copy, and non-authoritative UI capability behavior.
- OAuth/OIDC provider handling remains intentionally deferred to Story 1.3, and MFA/recovery remains deferred to Story 1.2.

### File List

- package.json
- apps/api/src/app.js
- apps/api/src/security.js
- apps/api/src/store.js
- apps/web/src/auth-entry.js
- apps/web/src/workspace-routes.js
- packages/contracts/src/auth-contracts.js
- tests/story-1-1.api.test.js
- tests/story-1-1.web.test.js
- docs/implementation-artifacts/1-1-approved-account-entry-and-workspace-access.md
- docs/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-06-26: Implemented minimal Story 1.1 auth/workspace runtime slice, added protected route and audit/PBAC scaffolding, and verified with `rtk npm test` (14/14 passing).

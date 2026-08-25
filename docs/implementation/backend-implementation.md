# Backend Implementation

## Status

AUTHORITATIVE IMPLEMENTATION DOCUMENT

## Purpose

Single source for NestJS API, auth, GitHub App integration, API contracts, audit and local backend run behavior.

---

## NestJS API Implementation

## Purpose

Define API backend boundaries, module responsibilities, validation, state transitions and async job handoff for LCSP MVP.

## Scope

The NestJS API owns synchronous request handling, authentication, PBAC authorization enforcement boundary, domain state validation, trusted trigger creation, persistence coordination, audit emission and queue job creation. It must not execute long-running scans, RAG/classification or document generation inline.

## Active References

- `docs/architecture/architecture.md`
- `docs/specs/domain-model.md`
- `docs/specs/domain-state-machines.md`
- `docs/specs/event-catalog.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`

## Implementation Boundaries

- Web calls API only.
- API enqueues jobs for trusted scan trigger resolution, scan, classification, RAG and document generation.
- Worker results are accepted through controlled result/status channels.
- All permission checks are server-side.
- OAuth/OIDC identity is not GitHub repository authorization.
- Manager has the active MVP policy template needed to complete an assessment, subject to PBAC and state gates.

## Module Boundaries

| Module                       | Responsibility                                 | Controller Boundary                                   | Service Boundary                    | Repository Boundary                                          |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| Auth                         | Password/session login and logout              | Login/logout endpoints                                | Credential/session policy           | User, Session                                                |
| OAuth/OIDC                   | Start login, validate callback, link identity  | Auth redirect/callback endpoints                      | Provider validation, linking policy | OAuthIdentity                                                |
| MFA                          | TOTP setup/challenge/reset/disable             | MFA endpoints                                         | MFA policy and verification         | UserMfaMethod                                                |
| User/Profile                 | Profile and security settings                  | Profile endpoints                                     | User update policy                  | User                                                         |
| Organization                 | Organization membership context                | Organization endpoints                                | Membership/PBAC policy              | Organization                                                 |
| Assessment                   | Assessment lifecycle                           | Assessment endpoints                                  | Workflow state guard                | Assessment                                                   |
| Wizard                       | WizardProfile save/submit                      | Wizard endpoints                                      | Wizard validation                   | WizardProfile                                                |
| GitHub Integration           | GitHub App connection                          | Repository connection endpoints                       | Installation/access policy          | RepositoryConnection                                         |
| Repository Scan              | Trusted trigger request/status and scan status | Scan endpoints / webhook handler / scheduler boundary | Trigger/job enqueue/idempotency     | TrustedScanTrigger, ScanMappingResolution, RepositoryScanJob |
| Evidence                     | Evidence/report/finding read models            | Evidence endpoints                                    | Access + state policy               | TechnicalEvidenceReport, TechnicalFinding                    |
| AIUsageFlow                  | Usage flow review                              | AIUsageFlow endpoints                                 | Read/uncertainty policy             | AIUsageFlow, AIUsageFlowClaim                                |
| Reconciliation               | Conflict resolution                            | Conflict endpoints                                    | Manager resolution policy           | ConflictRecord, ConflictResolution                           |
| VerifiedProfile              | Profile review/approval                        | VerifiedProfile endpoints                             | Prerequisite validation             | VerifiedProfile                                              |
| Classification               | Classification request/result                  | Classification endpoints                              | Gate check + job enqueue            | RiskClassification                                           |
| Gap Analysis                 | Gap results                                    | Gap endpoints                                         | Result access policy                | GapAnalysis                                                  |
| Document                     | Document request/download                      | Document endpoints                                    | Final report gate + storage refs    | GeneratedDocument, GeneratedDocument                         |
| Audit                        | Audit view/export                              | Audit endpoints                                       | Redacted query/export policy        | AuditEvent                                                   |
| Workflow / Job Status        | Progress and blocking reasons                  | Status endpoints                                      | State projection                    | WorkflowRun, job tables                                      |
| Future Permission Delegation | Post-MVP delegated technical permissions       | Permission endpoints if enabled                       | Grant/revoke policy                 | PermissionGrant                                              |

## Request Validation

- Validate shape, enum values, identifiers, state version and idempotency key.
- Reject requests that would bypass gates or perform a transition from an invalid state.
- Treat all client-provided role/action flags as untrusted.

## Authentication and Permission Guards

- Active MVP Manager subject profile can perform assessment-owner workflow actions where PBAC and state gates allow.
- Developer may only act in optional delegated scope where PBAC policy explicitly allows.
- OAuth/OIDC-linked identity still uses LCSP session, MFA and PBAC policy evaluation.
- GitHub App permissions are checked for repository access and never replace LCSP authorization.

## State Transition Validation

| Transition                   | Required Preconditions                                                                  | Failure Behavior                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Submit WizardProfile         | Assessment exists, Manager authorized, Wizard valid                                     | Return validation errors                         |
| Connect repository           | Manager authorized, GitHub App installation valid                                       | Block scan until connected                       |
| Resolve trusted scan trigger | Trusted source, PBAC allow, mapping context valid or safely pending                     | Create/resume scan context or safe mapping state |
| Request scan                 | Trusted trigger or repository context exists, branch/commit selected, idempotency valid | Return existing job or block with reason         |
| Resolve conflict             | Conflict open, Manager authorized, traceable resolution supplied                        | Keep workflow paused                             |
| Request classification       | VerifiedProfile ready, no unresolved conflict, usage purpose resolved                   | Return blocked state                             |
| Request document             | Valid classification, citations, gap analysis and output guardrail preconditions        | Return blocked state                             |

## Transaction Boundaries

- Persist domain state and audit event in the same transaction where critical transition must be atomic.
- Enqueue job after durable state creation by writing an `OutboxEvent` row; direct RabbitMQ publish inside the domain transaction is forbidden.
- Worker result application must be idempotent against workflow run and job ids.

## Job Enqueue Pattern

API creates a durable job record, emits an audit event, writes an `OutboxEvent` containing only references and correlation metadata, then returns job/status information. The outbox publisher later publishes to RabbitMQ. Queue payloads must not contain raw source, secrets or full prompts.

## Progress Strategy

Expose workflow progress through polling or SSE over API-owned status endpoints. The API must project Worker state from persisted job/workflow records, not by direct Web-to-Worker communication.

## Error Response Contract

| Field             | Meaning                              |
| ----------------- | ------------------------------------ |
| `error_code`      | Stable machine-readable code         |
| `message`         | User-safe summary                    |
| `blocking_reason` | Gate or state reason when applicable |
| `correlationId`   | Trace id for audit/support           |
| `recoverable`     | Whether user can retry/correct       |
| `required_action` | Next allowed user/system action      |

## Idempotency Behavior

Use idempotency keys for repository scan request, classification request and document generation request. Repeated requests should return existing job/result when inputs and state version match.

## Audit Emission Pattern

Every critical transition emits audit metadata with actor, actor role, assessment id, workflow run id, action, before/after state when safe, result status, correlation id and redacted context.

## API Versioning Strategy

Use versioned public API groups and versioned async event contracts. Breaking changes require a migration note and compatibility policy before implementation.

## Locked Progress API Decision for Controlled MVP

Controlled MVP uses polling through API-owned status endpoints. SSE may be added later without changing domain state or queue contracts.

---

## Auth, OAuth/OIDC, MFA and PBAC Implementation

## Purpose

Define authentication, session, MFA and authorization implementation contracts for LCSP MVP.

## Scope

LCSP supports OAuth/OIDC Login as the active controlled MVP identity boundary, TOTP MFA where enabled, and server-side PBAC checks. OAuth/OIDC authenticates LCSP identity only and does not grant GitHub repository access.

## Active References

- `docs/architecture/architecture.md`
- `docs/specs/domain-model.md`
- `docs/specs/domain-state-machines.md`
- `docs/implementation/persistence-implementation.md`

## Implementation Boundaries

- OAuth/OIDC Login is separate from GitHub App repository authorization.
- OAuth/OIDC provider tokens must not be exposed to UI or logs.
- LCSP session provides identity; PBAC is internal authorization authority.
- Manager is an MVP subject label/policy template, not final authority by itself.
- Developer delegation is Post-MVP and scoped.

## Authentication Flows

| Flow                        | Required Controls                                                                                                 | Output                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Password Login              | Credential validation, lockout/session policy, MFA when required                                                  | LCSP session                             |
| OAuth/OIDC Login            | Authorization Code Flow, PKCE when applicable, state, nonce, issuer, audience, expiry and redirect URI validation | Linked LCSP identity + session candidate |
| TOTP MFA Challenge          | User-bound TOTP secret, rate limiting, lockout, recovery/reset policy                                             | Session continuation                     |
| Logout / Session Revocation | Server-side session invalidation                                                                                  | Session ended                            |

## Safe Account Linking

- Do not link accounts based only on unverified email.
- Validate provider subject and verified identity according to provider policy.
- Link attempts, failures and unlink requests must be audited.
- Account linking must not grant new repository scan permission by itself.

## MVP Subject Label Matrix

| Capability                                | Manager | Developer                                     |
| ----------------------------------------- | ------- | --------------------------------------------- |
| Create assessment                         | Yes     | No unless future delegation                   |
| Complete WizardProfile                    | Yes     | No                                            |
| Connect GitHub repository                 | Yes     | Optional if assigned                          |
| Run Repository Scan                       | Yes     | Optional if assigned                          |
| View scan status                          | Yes     | Optional if assigned                          |
| View TechnicalEvidenceReport and findings | Yes     | Optional if assigned                          |
| Review AIUsageFlow                        | Yes     | Optional if assigned                          |
| Resolve business conflict                 | Yes     | No                                            |
| Resolve technical conflict                | Yes     | Optional input only                           |
| Finalize conflict resolution              | Yes     | No                                            |
| Resolve conflicts / own final facts       | Yes     | No                                            |
| Trigger risk classification               | Yes     | No                                            |
| View gap analysis                         | Yes     | Optional if permitted                         |
| Generate compliance document              | Yes     | No                                            |
| View audit trail                          | Yes     | Limited to assigned scope if Developer exists |
| Manage organization and assignments       | Yes     | No                                            |

## Post-MVP PermissionGrant

| Field                                | Purpose                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `granted_by_manager_id`              | Manager who delegated the scope                       |
| `grantee_user_id`                    | Developer or collaborator receiving scope             |
| `scope_type` / `scope_id`            | Organization, assessment, repository or task boundary |
| `permission_code`                    | Delegated technical permission                        |
| `status`, `expires_at`, `revoked_at` | Revocable lifecycle                                   |

Delegation never removes Manager permissions and never gives Developer final compliance authority by default.

## Required Inputs and Outputs

| Input                           | Output                                       |
| ------------------------------- | -------------------------------------------- |
| Provider authorization response | Validated OAuthIdentity or rejected callback |
| MFA code                        | MFA pass/fail state                          |
| Session token/cookie            | Authenticated user context                   |
| User role/grants                | Allowed action set                           |

## State / Error / Failure Handling

- Invalid callback/state/nonce/issuer/audience/expiry rejects login.
- MFA failure blocks session continuation.
- Revoked session blocks API access.
- Missing Manager authority blocks final compliance actions.
- Developer without delegated scope receives access denied.

## Security and Privacy Considerations

- Use Authorization Code Flow; use PKCE where applicable.
- Do not place OAuth client secret in frontend.
- Do not log raw provider access/refresh tokens.
- Protect session cookies with secure, httpOnly and same-site settings according to environment.
- Apply server-side authorization to every state-changing endpoint.

## Audit Requirements

Audit login success/failure, OAuth callback validation failure, account linked/unlinked, MFA setup/challenge/reset/disable, session revoked, permission grant/revocation and denied authorization attempts.

## Locked Auth Provider Decision for Controlled MVP

Controlled MVP uses local mock OIDC with a provider-agnostic interface. Required environment keys are `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET_REF`, `OIDC_CALLBACK_URL`, `OIDC_MOCK_ENABLED` and `SESSION_SECRET_REF`.

Mock provider claims are local-development identities only. Backend must still validate state, nonce, issuer, audience and callback shape. No production authentication assurance is claimed from mock mode.

MFA recovery uses admin-assisted local reset with audit event for controlled MVP; production recovery policy is a release-environment control.

---

## GitHub App Repository Scan and Automatic Trusted Scan Initiation Implementation

## Purpose

Define the GitHub App repository integration and Repository Scan implementation contract for LCSP MVP.

## Scope

MVP technical evidence is acquired only through GitHub App read-only Repository Scan created or resumed by trusted integration context. Manual scanner report upload, Local/CI uploads, manual evidence JSON, CLI evidence, CI/CD evidence and API probing are not active MVP flows. `FR-050` is Automatic Trusted Scan Initiation.

## Active References

- `docs/specs/scanner-spec.md`
- `docs/implementation/scanner-implementation.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`

## Implementation Boundaries

| Capability                        | Boundary                                                            |
| --------------------------------- | ------------------------------------------------------------------- |
| OAuth/OIDC Login                  | Authenticates LCSP user identity                                    |
| GitHub App Connection             | Grants read-only repository access for scan                         |
| Automatic Trusted Scan Initiation | Creates/resumes safe pending scan workflow from verified context    |
| Repository Scan                   | Produces `TechnicalEvidenceReport` from selected repo/branch/commit |

OAuth/OIDC Login does not install GitHub App, does not grant repository access and does not authorize scanning. PBAC and GitHub App scope must both allow scan initiation.

## MVP Scan Flow

```text
Trusted trigger received from verified webhook, scheduler, backend trigger, or authorized Manager action
-> API/trigger boundary validates PBAC and source context
-> mapping becomes READY, PENDING_MAPPING, BLOCKED_MAPPING, or WAITING_FOR_CONTEXT
-> system creates or resumes Repository Scan when mapping is READY
-> API creates RepositoryScanJob
-> Queue delivers scan job
-> Worker scans isolated workspace
-> TechnicalEvidenceReport persisted as structured metadata
-> workspace deleted
```

## GitHub App Installation and Authorization

- Manager initiates GitHub App connection from LCSP where PBAC allows.
- API records installation metadata and selected repository access reference.
- Repository access must be least privilege and scoped to selected repositories.
- Existing installation repository access changes must be initiated from LCSP Manage so the API can generate and validate a one-time `state`; do not trust bare GitHub update redirects with only `installation_id`.
- GitHub App start is a sensitive route. Sensitive-route membership is declared at the route owner with `@ReAuthForSensitiveRoute(...)`, which both enables guard enforcement and registers route IDs/path templates for frontend preflight. UI may call `POST /auth/sensitive-route/check` with the target `{ method, path }` to decide whether to show the re-auth modal, but `GET /github/app/start` must independently enforce recent session verification and return `REAUTH_REQUIRED` on direct requests without a fresh proof.
- Branch and commit selection must be pinned before scan.
- Scan authorization must verify PBAC policy, tenant scope, trusted source identity and valid GitHub App installation.

## Static Scanner Lifecycle

| Step        | Implementation Contract                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Snapshot    | Shallow clone selected repository at pinned commit SHA                                                    |
| Workspace   | Ephemeral isolated container or restricted temporary volume                                               |
| Execution   | Static file reads and parsing only; no customer code/scripts/builds/tests/install/Docker/CI/API probes    |
| Analysis    | Inventory, manifest/config parsing, AST/symbol analysis, AI invocation/input/output/action/review signals |
| Persistence | Structured findings, hashes, graph refs, report metadata, coverage limitations                            |
| Cleanup     | Raw workspace deletion is mandatory and audited                                                           |

## Required Inputs and Outputs

| Input                                            | Source             | Output                              |
| ------------------------------------------------ | ------------------ | ----------------------------------- |
| Assessment id, repository id, branch, commit SHA | Manager/API        | RepositoryScanJob                   |
| GitHub App installation reference                | GitHub Integration | Temporary repository access context |
| Scanner/ruleset version                          | Worker config      | Versioned scan metadata             |
| Structured findings                              | Scanner            | TechnicalEvidenceReport             |

## Idempotency and Re-scan

Use an idempotency key based on repository, commit SHA, scanner version and ruleset version. Re-run is allowed when Manager requests it or evidence is insufficient/stale. Duplicate scan requests with the same key return the existing job/result when safe.

## Failure and Retry Behavior

| Failure                         | Behavior                                                |
| ------------------------------- | ------------------------------------------------------- |
| Missing GitHub App installation | Block scan and show repository connection required      |
| Token/access failure            | Mark scan failed, audit, allow Manager correction/retry |
| Clone failure                   | Retry if transient, otherwise fail job                  |
| Scanner failure                 | Mark report unavailable, classification locked          |
| Workspace cleanup failure       | Critical security event requiring alert and remediation |
| Report hash mismatch            | Reject report and keep classification locked            |

## Security and Privacy Considerations

- Non-root scanner execution.
- Restricted filesystem write access.
- Restricted outbound network after repository retrieval.
- File size, count, depth and time limits.
- Skip binaries, generated assets and minified bundles by policy.
- Secrets redacted before persistence.
- Raw source, full prompts, full AST bodies and secrets are not persisted or sent to LLM.

## Audit Requirements

Audit repository connected/disconnected, access denied, scan requested, scan started, scan completed, scan failed, report hash, scanner version, ruleset version, cleanup success/failure and re-scan request.

## Locked Repository Scan Sandbox Decision for Controlled MVP

Scanner uses restricted temporary local filesystem workspace at `${LCSP_SCANNER_WORKSPACE_ROOT:-.lcsp/tmp/scanner-workspaces}`. It does not use isolated container sandboxing in the controlled MVP. GitHub App access is least-privilege selected repository read access.

Workspace cleanup is mandatory after scan completion or terminal failure. Cleanup failure marks scan failed with `SCANNER_WORKSPACE_CLEANUP_FAILED`, emits security-sensitive audit and blocks downstream.

---

## API and Async Event Contracts

## Purpose

Define design-level API groups and async event contracts for LCSP MVP. This document is not runnable API code.

## Scope

The API exposes Manager-owned MVP workflow actions and optional Post-MVP delegation concepts. Async events describe workflow and audit-relevant transitions.

## Active References

- `docs/specs/event-catalog.md`
- `docs/specs/domain-state-machines.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/persistence-implementation.md`

## Implementation Boundaries

- API groups are design contracts, not route implementation.
- API enqueues long-running work and returns job/status references.
- Queue/event payloads contain references and metadata, not raw source, full prompts or secrets.

## API Group Contract

| Purpose                      | Method          | Request Fields                            | Response Fields                   | Permission            | State Preconditions    | Async Effect              | Audit Event                     |
| ---------------------------- | --------------- | ----------------------------------------- | --------------------------------- | --------------------- | ---------------------- | ------------------------- | ------------------------------- |
| Auth / password login        | POST            | credentials, CSRF/session context         | session candidate or MFA required | public                | no active session      | none                      | login success/failure           |
| OAuth/OIDC start/callback    | GET/POST        | provider, state/callback params           | session candidate or failure      | public                | configured provider    | none                      | OAuth callback result           |
| MFA                          | POST            | TOTP code/setup/reset request             | MFA status/session continuation   | authenticated/pending | MFA policy             | none                      | MFA events                      |
| Profile                      | GET/PATCH       | profile fields                            | profile view/update               | self                  | authenticated          | none                      | profile updated                 |
| Assessment                   | GET/POST        | organization, assessment fields           | assessment state                  | Manager               | Manager session        | none                      | `ASSESSMENT_CREATED`            |
| Wizard                       | GET/PUT/POST    | WizardProfile answers/version             | saved/submitted WizardProfile     | Manager               | assessment exists      | may unblock next state    | `WIZARD_SUBMITTED`              |
| GitHub Repository            | GET/POST/DELETE | installation/repo/branch/commit refs      | repository connection             | Manager               | assessment exists      | none                      | `GITHUB_REPOSITORY_CONNECTED`   |
| Repository Scan              | POST/GET        | assessment, repo, commit, idempotency key | scan job/status                   | Manager               | repo connected         | scan job queued           | `REPOSITORY_SCAN_REQUESTED`     |
| Evidence and Findings        | GET             | report/finding ids                        | report/finding summaries          | Manager               | scan completed         | none                      | findings viewed                 |
| AIUsageFlow                  | GET             | flow id/assessment                        | claim set/uncertainty             | Manager               | TechnicalProfile ready | none                      | AIUsageFlow viewed              |
| Conflict Resolution          | GET/POST        | conflict id, resolution/update refs       | resolution state                  | Manager               | conflict open          | reconciliation resume     | `CONFLICT_RESOLVED`             |
| VerifiedProfile              | GET/POST        | profile id/version approval               | VerifiedProfile state             | Manager               | no unresolved conflict | may unlock classification | `VERIFIED_PROFILE_READY`        |
| Classification               | POST/GET        | assessment, profile version               | job/result/block reason           | Manager               | VerifiedProfile ready  | classification job queued | `CLASSIFICATION_REQUESTED`      |
| Gap Analysis                 | GET             | classification/gap ids                    | gap result                        | Manager               | classification valid   | none                      | gap viewed                      |
| Documents                    | POST/GET        | template/doc request                      | job/file/block reason             | Manager               | final report gate pass | document job queued       | `DOCUMENT_GENERATION_REQUESTED` |
| Audit                        | GET/EXPORT      | filters                                   | redacted audit events/export      | Manager               | assessment/org access  | optional export job       | audit viewed/exported           |
| Workflow Status              | GET             | assessment/workflow/job id                | state, progress, blocking reason  | Manager               | assessment access      | none                      | status viewed                   |
| Future Permission Delegation | POST/DELETE/GET | scope, grantee, permission code           | grant status                      | Manager               | Post-MVP enabled       | none                      | grant/revoke audited            |

## Event Catalogue

| Event                                  | Producer   | Meaning                             |
| -------------------------------------- | ---------- | ----------------------------------- |
| `ASSESSMENT_CREATED`                   | API        | Manager created assessment          |
| `WIZARD_SUBMITTED`                     | API        | WizardProfile submitted             |
| `GITHUB_REPOSITORY_CONNECTED`          | API        | GitHub App repo connection recorded |
| `REPOSITORY_SCAN_REQUESTED`            | API        | Scan job requested                  |
| `REPOSITORY_SCAN_STARTED`              | Worker     | Scanner started                     |
| `REPOSITORY_SCAN_COMPLETED`            | Worker     | Scanner completed                   |
| `REPOSITORY_SCAN_FAILED`               | Worker     | Scanner failed                      |
| `TECHNICAL_EVIDENCE_READY`             | Worker     | TechnicalEvidenceReport ready       |
| `EVIDENCE_SCHEMA_FAILED`               | Worker     | Schema Gate failed                  |
| `EVIDENCE_QUALITY_INSUFFICIENT`        | Worker     | Quality Gate insufficient           |
| `TECHNICAL_PROFILE_READY`              | Worker     | TechnicalProfile built              |
| `AI_USAGE_FLOW_READY`                  | Worker     | AIUsageFlow created                 |
| `CONFLICT_FOUND`                       | Worker     | Reconciliation detected conflict    |
| `MANAGER_CONFLICT_RESOLUTION_REQUIRED` | Worker/API | Manager task created                |
| `CONFLICT_RESOLVED`                    | API        | Manager resolution recorded         |
| `VERIFIED_PROFILE_READY`               | Worker/API | VerifiedProfile ready               |
| `CLASSIFICATION_REQUESTED`             | API        | Classification job requested        |
| `CLASSIFICATION_BLOCKED`               | Worker/API | Gate blocked classification         |
| `CLASSIFICATION_COMPLETED`             | Worker     | Classification completed            |
| `GAP_ANALYSIS_COMPLETED`               | Worker     | Gap analysis completed              |
| `DOCUMENT_GENERATION_REQUESTED`        | API        | Document job requested              |
| `DOCUMENT_GENERATION_BLOCKED`          | Worker/API | Final report gate blocked           |
| `DOCUMENT_GENERATION_COMPLETED`        | Worker     | Document generated                  |

## Common Event Metadata

Every event should include event id, event type, assessment id, workflow run id, actor id/role where applicable, correlation id, source component, timestamp, input refs and redacted context.

## State / Error / Failure Handling

Events must be idempotently handled. Duplicate events with same event id or idempotency key must not create duplicate state transitions.

## Security and Privacy Considerations

Do not include raw source, full prompt, secrets, raw provider tokens or full AST bodies in API responses or events.

## Audit Requirements

Events and API transitions must map to audit events for critical workflow transitions.

## Locked API and Event Contract Decision for Controlled MVP

Route names are the canonical `/api/v1/...` routes in the Phase 5.5 section below. Event transport uses the canonical reference-only envelope from `docs/specs/event-catalog.md` and `docs/implementation/queue-implementation.md`.

---

## Audit and Observability Implementation

## Purpose

Define audit taxonomy, tracing, metrics, alerting and redaction expectations for LCSP.

## Scope

Audit supports compliance traceability, security review, workflow debugging and readiness evidence. Observability supports operational health without exposing sensitive source or secrets.

## Active References

- `docs/specs/event-catalog.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`

## Implementation Boundaries

- Audit logs are metadata records, not raw source repositories.
- Ordinary audit records must not contain raw source, full prompts, secrets, raw provider tokens or full AST bodies.
- Critical audit write failure should fail closed for critical transitions where policy requires traceability.

## Audit Event Taxonomy

| Category       | Events                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Auth           | login success/failure, OAuth callback validation, account linked/unlinked, MFA events, session revoked |
| Authorization  | access denied, permission grant/revoke, Developer delegated action                                     |
| Assessment     | created, Wizard submitted, state changed                                                               |
| Repository     | GitHub connected/disconnected, scan requested/started/completed/failed                                 |
| Evidence       | schema passed/failed, quality ready/insufficient, report hash verified                                 |
| AIUsageFlow    | ready, uncertain, conflict candidate created                                                           |
| Reconciliation | conflict found, Manager task created, conflict resolved, reconciliation re-run                         |
| Classification | requested, blocked, completed, citation missing                                                        |
| Document       | requested, blocked, generated, downloaded                                                              |
| Security       | redaction event, cleanup failure, disallowed LLM input rejected                                        |

## Correlation and Workflow Tracing

Every audit event should include correlation id, workflow run id, assessment id, actor id/role where applicable, component, action, result, timestamp and redacted context.

## Metrics

| Metric                        | Purpose                         |
| ----------------------------- | ------------------------------- |
| scan success/failure rate     | Scanner reliability             |
| schema failure rate           | Contract quality                |
| quality insufficient rate     | Evidence sufficiency            |
| AIUsageFlow uncertainty rate  | A2-b and scanner quality        |
| conflict rate                 | Wizard/evidence mismatch signal |
| classification block rate     | Gate health                     |
| citation-missing rate         | Legal corpus quality            |
| document success/failure rate | Output reliability              |
| queue latency                 | Async health                    |
| worker duration               | Worker capacity                 |
| LLM timeout rate              | Provider/gateway health         |
| conflict-resolution age       | Human workflow SLA              |

## Alerting

Alert on workspace cleanup failure, audit write failure, high queue dead-letter rate, high citation-missing rate, repeated OAuth callback failures, secret redaction failures and object storage write failures.

## Operational Dashboards

Dashboards should show workflow health, queue latency, scanner success, gate outcomes, LLM gateway status, document generation status and security alerts.

## Audit Export

Export must be redacted and scoped by organization/assessment authorization. Export should include hashes/refs and correlation ids, not raw source or secrets.

## Security and Privacy Considerations

Apply deterministic redaction before audit persistence. Store sensitive identifiers only where needed and governed by retention policy.

## Audit Requirements

This document defines audit requirements. Each implementation component must emit events through the shared audit service or equivalent API-owned boundary.

## Locked Audit and Observability Decision for Controlled MVP

Audit events are append-oriented rows in PostgreSQL and must not be updated in normal workflow execution. Controlled MVP observability uses structured JSON logs, correlation ids and persisted audit events. External metrics backend selection is a release-environment concern.

---

## Security and Privacy Implementation

## Purpose

Define threat-to-control implementation guidance for LCSP security and privacy invariants.

## Scope

Covers authentication, authorization, GitHub App access, scanner isolation, source/prompt privacy, LLM Gateway, legal corpus provenance, storage, encryption, audit integrity and incident hooks.

## Active References

- `docs/architecture/architecture.md`
- `docs/specs/scanner-spec.md`
- `docs/specs/event-catalog.md`
- `docs/implementation/persistence-implementation.md`

## Implementation Boundaries

- OAuth/OIDC authenticates LCSP user identity only.
- GitHub App grants repository scan access only.
- Raw source exists only in temporary scanner workspace.
- LLM Gateway receives sanitized metadata only.
- Manager authority is server-side enforced.

## Threat-to-Control Mapping

| Threat                       | Required Control                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| OAuth callback spoofing      | Validate redirect URI, state, nonce, issuer, audience and expiry                         |
| Account takeover via linking | Do not link by unverified email; audit account link/unlink                               |
| Session theft                | Secure cookies, revocation, expiration, MFA policy                                       |
| Privilege escalation         | Server-side PBAC, Manager subject-label policy template, scoped Post-MVP PermissionGrant |
| Developer overreach          | Developer cannot finalize conflict/classification/document by default                    |
| Excess GitHub access         | Least privilege GitHub App installation and selected repository scope                    |
| Source leakage               | Temporary workspace, no long-term raw source persistence                                 |
| Secret leakage               | Deterministic redaction before persistence/audit                                         |
| Prompt leakage               | Do not store full system prompts by default                                              |
| LLM data exfiltration        | Gateway-only calls, sanitized metadata, reject disallowed inputs                         |
| Corpus poisoning             | Approved/versioned legal corpus with provenance                                          |
| Object storage exposure      | Scoped access, hashes, retention, no raw source artifacts                                |
| Audit tampering              | Append-oriented audit, correlation ids, export controls                                  |
| Abuse/rate pressure          | Rate limits on auth, scan request, LLM and document generation                           |

## Required Inputs and Outputs

| Input                   | Security Output                                       |
| ----------------------- | ----------------------------------------------------- |
| Auth callbacks          | Validated identity or rejection                       |
| Repository scan request | Authorized scan job or denial                         |
| Scanner findings        | Redacted evidence metadata                            |
| LLM input request       | Accepted sanitized payload or rejected security event |
| Legal corpus update     | Versioned provenance record                           |

## State / Error / Failure Handling

- Fail closed on authentication or PBAC violation.
- Block workflow on cleanup failure until security review.
- Reject evidence containing raw source, full prompts or secrets.
- Block/degrade legal output when citation guardrail fails.

## Encryption and Retention

Encrypt or hash MFA secrets, session tokens and sensitive integration metadata. Retain raw source only in temporary workspace for scan duration. Raw source has no long-term persistence in the controlled MVP.

## Incident-Response Hooks

Create alert hooks for cleanup failure, raw secret detection after redaction, OAuth callback anomaly, high access denial rate, audit write failure and suspected corpus poisoning.

## Audit Requirements

Audit auth events, access denied, GitHub connection, scan lifecycle, redaction, cleanup, conflict resolution, LLM gateway calls, corpus version use, classification and document generation.

## Locked Security Configuration Decisions for Controlled MVP

Scanner sandbox is restricted temporary local filesystem workspace. Encryption key management uses secret references in local MVP configuration; concrete production KMS tooling is a release-environment concern, not a controlled MVP coding prerequisite.

---

## Local Development Runbook

## Purpose

Describe local setup expectations for future LCSP implementation work without providing runnable commands or configuration.

## Scope

Covers prerequisites, startup order, environment categories, local OAuth/GitHub strategy, scanner fixtures, legal corpus initialization, migration order, queue/object storage inspection, test accounts and troubleshooting.

## Active References

- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/llm-gateway-implementation.md`
- `docs/architecture/architecture.md`
- `docs/specs/event-catalog.md`

## Implementation Boundaries

This runbook is not an implementation script. It must not include real secrets or production tokens.

## Prerequisites

Future developers will need runtime support for Web, API, Worker, PostgreSQL, queue, object storage substitute, legal corpus fixtures, scanner fixtures and configured OAuth/GitHub test integration or mocks.

## Startup Order

| Order | Area                      | Reason                                            |
| ----: | ------------------------- | ------------------------------------------------- |
|     1 | Configuration and secrets | Services fail closed when required config missing |
|     2 | PostgreSQL and migrations | API/Worker need durable state                     |
|     3 | Queue                     | Async job boundary                                |
|     4 | Object storage            | Document artifacts and allowed refs               |
|     5 | API                       | Auth/domain/job creation                          |
|     6 | Worker                    | Queue consumption and orchestrator                |
|     7 | Web                       | UI integration                                    |
|     8 | Legal corpus fixtures     | RAG/classification tests                          |
|     9 | Scanner fixtures          | A2-b/local scanner tests                          |

## Local Environment Variables by Category

Use configuration categories only: database, queue, object storage, OAuth/OIDC, MFA encryption, GitHub App, LLM Gateway, legal corpus, scanner rulesets, observability and app URLs.

## Local OAuth Callback Strategy

Use a configured local callback URL or mocked provider. Validate state, nonce, issuer, audience and expiry even in local mode.

## Local GitHub App Setup Strategy

For local repository connection, create a real GitHub App, not an OAuth App. Use `http://localhost:3000/api/github/app/callback` as the user authorization callback URL, enable "Request user authorization (OAuth) during installation", and grant repository `Contents: Read-only`; GitHub's implicit `Metadata: Read-only` is allowed. Disable webhook `Active` unless a reachable webhook URL and secret are configured. "Redirect on update" may be enabled only for the LCSP-managed update UX; users should start repository access changes from the LCSP Manage action so state validation is present.

## GitHub App Testing Strategy

Use a test GitHub App installation or mock repository provider. Do not substitute OAuth/OIDC identity for repository authorization.

## Scanner Fixture Strategy

Use synthetic repositories for internal summarization, loan approval, HR ranking, chatbot, dynamic prompt and provider-only cases. Scanner remains static-analysis only.

## Legal Corpus Initialization

Load approved fixture corpus versions with deterministic citation ids. Do not claim real legal advice from incomplete fixtures.

## Safe Local Data Rules

Do not use real customer repositories, secrets, full prompts or regulated personal data in local fixtures.

## Troubleshooting

| Symptom                             | Likely Area                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Login succeeds but repo unavailable | GitHub App not connected; OAuth does not grant repo access                      |
| Scan stuck                          | Queue/Worker/job state                                                          |
| Classification blocked              | Missing VerifiedProfile, unresolved conflict, unclear usage or missing citation |
| Document blocked                    | Final report gate failed                                                        |
| AIUsageFlow unknown                 | Scanner coverage limitation or unsupported dynamic flow                         |

## Audit Requirements

Local runs should still emit redacted audit events so developers can verify traceability.

## Locked Local Integration Defaults for Controlled MVP

Local development execution may utilize local mocks for OIDC, the local filesystem for object storage, and deterministic mock LLM modes for offline unit/CI tests. However, the authoritative controlled MVP happy path requires:

1. Python Worker Platform scanner module (`deepagents/tools/graph/scanner`) executing repository scans.
2. A real configured LLM provider mandatory for the A-to-Z happy path (mock LLM is restricted to test/offline only).
3. A provenance-preserving legal corpus derived from approved legal source URLs (with metadata, hashes, hierarchy, xref edges and approval records) built into a ChromaDB vectorless legal retrieval index.
4. Real S3-compatible object storage for document artifact storage (with local filesystem adapter restricted to local dev only).

<!-- PHASE-5-5-BACKEND-CONTRACT:START -->

## Phase 5.5 Canonical API, Outbox and Local Command Contract

### Controlled MVP API Routes

| Method | Route                                                                            | Module              | Purpose                                                    |
| ------ | -------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| `POST` | `/api/v1/assessments`                                                            | `assessments`       | Create assessment.                                         |
| `GET`  | `/api/v1/assessments/:assessmentId`                                              | `assessments`       | Read assessment state.                                     |
| `POST` | `/api/v1/assessments/:assessmentId/wizard-profile`                               | `wizard`            | Save WizardProfile.                                        |
| `POST` | `/api/v1/assessments/:assessmentId/github/repository-connections`                | `github`            | Connect GitHub App repository.                             |
| `POST` | `/api/v1/assessments/:assessmentId/repository-snapshots`                         | `github`            | Create commit-pinned repository snapshot metadata.         |
| `POST` | `/api/v1/assessments/:assessmentId/scans`                                        | `scans`             | Request repository scan.                                   |
| `GET`  | `/api/v1/assessments/:assessmentId/scans/:scanJobId`                             | `scans`             | Read scan job status.                                      |
| `GET`  | `/api/v1/assessments/:assessmentId/technical-profile`                            | `technical-profile` | Read latest TechnicalProfile.                              |
| `GET`  | `/api/v1/assessments/:assessmentId/ai-usage-flow`                                | `ai-usage-flow`     | Read latest AIUsageFlow.                                   |
| `GET`  | `/api/v1/assessments/:assessmentId/reconciliation-conflicts`                     | `reconciliation`    | List open/resolved conflicts.                              |
| `POST` | `/api/v1/assessments/:assessmentId/reconciliation-conflicts/:conflictId/resolve` | `reconciliation`    | Manager conflict resolution.                               |
| `POST` | `/api/v1/assessments/:assessmentId/classifications`                              | `classification`    | Request classification after legal matching prerequisites. |
| `GET`  | `/api/v1/assessments/:assessmentId/classifications/latest`                       | `classification`    | Read latest classification or blocked state.               |
| `GET`  | `/api/v1/assessments/:assessmentId/gap-analysis/latest`                          | `gap-analysis`      | Read latest GapAnalysis or blocked state.                  |
| `POST` | `/api/v1/assessments/:assessmentId/documents`                                    | `documents`         | Request document generation.                               |
| `GET`  | `/api/v1/assessments/:assessmentId/documents/:documentId`                        | `documents`         | Read generated document metadata/status.                   |

### Service Command Transaction Rule

Every state-changing service command must:

1. Validate DTO.
2. Authorize actor.
3. Validate state transition.
4. Start DB transaction.
5. Write domain row.
6. Write `AuditEvent`.
7. Write `OutboxEvent` when async work or event publication is required.
8. Commit transaction.
9. Let the outbox publisher publish to RabbitMQ later.
10. Mark outbox event `PUBLISHED` after broker acknowledgement.

No service may publish directly to RabbitMQ inside the same transaction.

### Local Development Command Contract

| Command                                          | Expected Output                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                    | npm workspace dependencies installed from lockfile.                                                                                                                     |
| `poetry install`                                 | Python Worker dependencies and virtual environment initialized.                                                                                                         |
| `npm run db:generate`                            | Prisma client generated successfully.                                                                                                                                   |
| `npm run db:migrate`                             | Local PostgreSQL schema migrated for relational metadata without pgvector requirement.                                                                                  |
| `npm run dev:api`                                | API starts and reports ready state without logging secrets.                                                                                                             |
| `npm run dev:worker`                             | NestJS background orchestration workers start and initialize queue bindings.                                                                                            |
| `poetry run python -m tools.graph.scanner.main` | Python Scanner Worker starts, connects to RabbitMQ and PostgreSQL, and logs ready status.                                                                               |
| `npm run dev:web`                                | Web app starts and can reach API health endpoint.                                                                                                                       |
| `npm run test`                                   | Unit and contract test suite passes.                                                                                                                                    |
| `npm run test:scanner`                           | Python AST/static-analysis stack and extraction parser tests pass.                                                                                                      |
| `npm run smoke:scan-fixture`                     | Synthetic scan fixture triggers scan job through Python Worker, creates TechnicalEvidenceReport, and verifies downstream command projection or explicit blocked reason. |

### Smoke Scan Fixture Expected Behavior

1. Seed organization, Manager, assessment, WizardProfile and RepositorySnapshot.
2. Send `POST /api/v1/assessments/:assessmentId/scans`.
3. Confirm `RepositoryScanJob` is `REQUESTED`.
4. Confirm `OutboxEvent` has routing key `command.scan.requested.v1`.
5. Run worker.
6. Confirm `TechnicalEvidenceReport` is created.
7. Confirm `OutboxEvent` has routing key `event.scan.completed.v1`.
8. Confirm `command.technical-profile.requested.v1` and `command.ai-usage-flow.requested.v1` are enqueued in order or blocked with explicit reason.
9. For full MVP smoke, continue the chain through Reconciliation, Legal Matching, Classification, Gap Analysis and Document Generation using only canonical `command.*` and `event.*` routing keys.

<!-- PHASE-5-5-BACKEND-CONTRACT:END -->

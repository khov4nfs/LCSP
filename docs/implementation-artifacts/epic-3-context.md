# Epic 3 Context: Trusted Repository Evidence and TechnicalProfile

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable a Manager, or an optionally assigned Developer acting within explicit RBAC scope, to connect a selected GitHub repository read-only, pin an immutable commit, run or resume a trusted static scan, and review safe technical evidence. The epic produces a validated, versioned TechnicalEvidenceReport and an evidence-derived TechnicalProfile while protecting source and secrets, exposing limitations instead of unsupported certainty, and preserving every prior scan and profile version.

## Stories

- Story 3.1: Connect Read-Only GitHub Repository
- Story 3.2: Pin Commit and Create RepositorySnapshot
- Story 3.3: Trusted Scan Trigger and Scan Job Orchestration
- Story 3.4: Static Scanner Workspace and Sandbox
- Story 3.5: Static Scanner Toolchain Execution
- Story 3.6: Scan Failure Severity and Evidence Acceptance Policy
- Story 3.7: TechnicalEvidenceReport Gates
- Story 3.8: TechnicalProfile Generation
- Story 3.9: Redacted Technical Findings Review and Developer Scoped View
- Story 3.10: Scan Re-run Without Mutating History
- Story 3.11: Removed and Deferred Evidence Path Guardrails

## Requirements & Constraints

- GitHub App authorization must remain separate from OAuth/OIDC identity login, request only read access, and restrict selection and scanning to authorized repositories, branches, organizations, assessments, and RBAC scope. Repository tokens must never appear in UI, logs, audit records, or API responses.
- Manager completion must not depend on Developer participation. Developer access is optional, assignment-specific, revocable, expiry-aware, server-enforced, and limited to permitted repository or redacted-finding tasks; inaccessible data must remain hidden.
- Every scan must bind to an immutable RepositorySnapshot identified by repository, ref, commit SHA, provider metadata, assessment, actor, and timestamp. Unresolvable or out-of-scope refs must fail before any scan is queued.
- Scanning is static-analysis only. It must not install dependencies, execute customer code, builds, tests, scripts, containers, or CI, or probe endpoints. Raw source may exist only temporarily in the restricted scanner workspace, must never go to an LLM, and must be verifiably cleaned after completion, failure, or timeout.
- Scan execution must be bounded by file size, time, CPU, memory, output, and retry limits. Unsupported languages or tools and partial results must be represented as coverage limitations, not successful evidence.
- Accepted evidence must pass schema, provenance, privacy, integrity, and quality gates. It must contain tool versions, configuration and ruleset hashes, snapshot provenance, finding references, confidence, privacy flags, coverage limitations, report hash, and generation time; raw source, secrets, full prompts, full AST dumps, unsafe identifiers, or missing provenance require rejection.
- TechnicalProfile must be generated only from accepted technical evidence. Unknown, low-confidence, stale, insufficient, or coverage-limited dimensions must remain explicit; Manager declarations cannot substitute for scanner evidence. The profile is neither AIUsageFlow nor VerifiedProfile and must not express risk, legal conclusions, compliance status, or certification.
- All protected reads, actions, triggers, state transitions, denials, gate failures, and evidence acceptance decisions require RBAC enforcement and append-oriented audit metadata including scope, identity, entity, action, outcome, correlation ID, and timestamp.
- Manual technical-evidence JSON upload, Local/CI report upload as an MVP evidence path, structured technical attestation, and delegated free-form clarification must be absent or safely denied and must never create accepted evidence.

## Technical Decisions

- The NestJS API is the synchronous authorization and control-plane boundary; scan work runs asynchronously on the Python Worker Platform. Each major stage persists a typed artifact before the next begins, with no hidden synchronous jump across gates.
- RepositoryScanJob orchestration must carry assessment and snapshot IDs, trigger source, idempotency key, state, attempt count, and correlation ID. Duplicate, retry, out-of-order, and replayed commands must return or resume a valid existing state and never create duplicate accepted evidence.
- Trusted triggers use a durable outbox/queue path with bounded retries, DLQ reason codes, controlled replay authority, and auditable recovery. Mapping gaps must resolve into explicit non-risk states such as pending, blocked, waiting for context, or ready to snapshot.
- The restricted scanner uses the approved language-applicable toolchain: Syft, Knip, deptry, Python `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parsing, and Semgrep custom rules. Tool failures must follow the canonical severity and evidence-eligibility policy; production acceptance remains blocked until that policy and provenance hashes are approved.
- TechnicalEvidenceReport and TechnicalProfile are distinct, immutable, versioned artifacts. A rerun creates a new job, report, and profile chain while retaining prior snapshots, hashes, audit events, and downstream-use references. TechnicalProfile handoff includes its version, report reference, assessment and organization scope, confidence, evidence references, limitations, validation status, audit event, and explicit insufficient/stale failure behavior.

## UX & Interaction Patterns

- Keep the repository flow explicit: connect read-only GitHub authorization, choose a branch or commit, display branch, commit SHA, author/date and immutable snapshot ID, then show queued/running/completed/failed scan states using safe stage names.
- Scan and evidence surfaces must show state, provenance, confidence, coverage limitations, redacted evidence references, next action, retry versus new-version rerun behavior, and audit/correlation ID where available. Never display raw code, secrets, prompts, or full AST content.
- Failed privacy, cleanup, or schema gates fail closed and block downstream stages with a safe reason and actionable recovery. Insufficient evidence must identify missing or uncertain facts and visibly keep downstream work ineligible; no risk label is permitted.
- Developer workspace must show granted scope, permitted actions, expiry/revocation and hidden-data boundaries. Status changes must not rely on color alone, must be announced to assistive technology, and long snapshot/evidence identifiers must be copyable.

## Cross-Story Dependencies

RepositoryConnection authorization precedes RepositorySnapshot creation; the immutable snapshot precedes job orchestration and workspace materialization; bounded tool execution and the approved severity policy precede TechnicalEvidenceReport acceptance; accepted evidence precedes TechnicalProfile generation and redacted review. Re-runs reuse the same gates but always create a new immutable version chain. TechnicalProfile is the producer handoff to AIUsageFlow and reconciliation, which must treat it solely as versioned technical evidence.

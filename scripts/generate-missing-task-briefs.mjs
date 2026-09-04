import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const TASKS_DIR = path.join(ROOT, "docs", "implementation", "tasks");
const HANDBOOK_DIR = path.join(ROOT, "docs", "developer", "task-handbook");

const tasks = [
  {
    id: "TASK-001",
    slug: "prisma-postgresql-baseline-plus-chromadb-legal-index-configuration",
    title: "Prisma/PostgreSQL Baseline plus ChromaDB Legal Index Configuration",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Platform",
    runtime: "migration",
    outcome:
      "Establish the relational schema baseline, migration ownership, and ChromaDB connectivity contract that every API and worker path depends on for the A-to-Z MVP.",
    sourceAuthority: [
      [
        "Architecture",
        "`docs/architecture/architecture.md`; `docs/architecture/adr/adr-025-legal-corpus-source-architecture.md`; `docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/persistence-implementation.md`; `docs/implementation/backend-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/domain-model.md`; `docs/specs/legal-matching-domain-spec.md`; `docs/specs/domain-state-machines.md`",
      ],
    ],
    scope: [
      "Create the canonical PostgreSQL schema baseline used by NestJS API and Python workers.",
      "Define migration ownership, reset/bootstrap flow, and local fixture expectations for an empty environment.",
      "Reserve storage structures and indexes for audit, outbox, workflow/job state, legal corpus, retrieval audit, and generated artifacts.",
      "Document ChromaDB connection/config contract and how approved legal corpus versions bind to Chroma collections.",
      "Ensure every later task can depend on one stable persistence and configuration baseline instead of creating side-schema drift.",
    ],
    nonGoals: [
      "No feature endpoint or worker business logic.",
      "No legal ingestion or retrieval implementation.",
      "No provider-specific LLM calls.",
      "No one-off local schema that bypasses the canonical migration path.",
    ],
    verification: [
      [
        "schema baseline",
        "migration / local",
        "empty environment can initialize relational schema and required metadata tables deterministically",
      ],
      [
        "worker compatibility",
        "API / worker contract",
        "API and worker adapters point to the same schema and version metadata",
      ],
      [
        "legal index config",
        "config / doc",
        "Chroma connection and corpus-version binding rules are documented and testable",
      ],
    ],
    failure: [
      [
        "migration drift",
        "fail startup or migration command explicitly",
        "operator sees schema mismatch before feature run",
        "audit/log references migration version only",
      ],
      [
        "missing Chroma config",
        "block legal-index-dependent startup path",
        "operator gets actionable config error",
        "safe startup failure record",
      ],
    ],
    definitionOfDone: [
      "Canonical migration baseline exists and is documented.",
      "ChromaDB configuration contract is documented next to relational schema ownership.",
      "Later tasks can reference one shared persistence baseline without redefining core tables.",
    ],
    openDecisions: [
      [
        "ChromaDB deployment topology for shared environments",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-002",
    slug: "config-secret-loader-and-provider-refs",
    title: "Config/Secret Loader and Provider Refs",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Platform",
    runtime: "cross-runtime",
    outcome:
      "Create one validated configuration and secret-reference contract for API, workers, GitHub App, object storage, ChromaDB, and the mandatory real LLM provider path.",
    sourceAuthority: [
      [
        "Architecture",
        "`docs/architecture/architecture.md`; `docs/architecture/multi-agent-system-architecture.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/llm-gateway-implementation.md`; `docs/implementation/queue-implementation.md`",
      ],
      ["Decisions", "`docs/implementation/decisions/pbac-runtime-decision.md`"],
    ],
    scope: [
      "Define validated environment/config loading for NestJS API and Python worker platform.",
      "Use secret references instead of inline credentials for LLM provider, GitHub App, object storage, RabbitMQ, PostgreSQL, and ChromaDB.",
      "Document mock-vs-provider LLM mode rules so local/offline CI does not masquerade as final MVP acceptance evidence.",
      "Define startup failure behavior when required configuration is missing or malformed.",
      "Keep configuration naming stable across dev, CI, and acceptance runs.",
    ],
    nonGoals: [
      "No provider invocation logic.",
      "No secret manager product selection beyond reference contract.",
      "No feature-specific API routes.",
      "No credentials stored in source control or ordinary logs.",
    ],
    verification: [
      [
        "config validation",
        "startup / config",
        "invalid or missing required config fails fast with safe error output",
      ],
      [
        "secret handling",
        "security / doc",
        "sensitive values appear only as references, never committed defaults",
      ],
      [
        "LLM mode contract",
        "doc / integration",
        "provider vs mock rules are explicit for local, CI, and acceptance runs",
      ],
    ],
    failure: [
      [
        "missing required secret ref",
        "block startup",
        "operator gets exact missing key name",
        "safe startup failure record",
      ],
      [
        "malformed config",
        "reject boot with validation error",
        "developer sees schema mismatch early",
        "redacted log only",
      ],
    ],
    definitionOfDone: [
      "Cross-runtime config contract is documented and validated.",
      "Secret references exist for all third-party integrations and worker runtimes.",
      "Later platform and domain tasks can depend on one stable config vocabulary.",
    ],
    openDecisions: [
      [
        "Secret manager implementation detail by environment",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-003",
    slug: "audit-event-writer",
    title: "AuditEvent Writer",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Platform",
    runtime: "cross-runtime",
    outcome:
      "Provide the canonical `AuditEvent` write contract shared by API and workers so material actions are consistently attributable, redacted, and traceable across the full MVP pipeline.",
    sourceAuthority: [
      [
        "Architecture",
        "`docs/architecture/architecture.md`; `docs/architecture/adr/architecture-decision-records.md`",
      ],
      [
        "Specs",
        "`docs/specs/event-catalog.md`; `docs/specs/domain-model.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
    ],
    scope: [
      "Define the canonical `AuditEvent` persistence shape and write helper boundaries.",
      "Standardize required audit metadata: correlation ID, causation ID, actor/service identity, aggregate refs, action, result, and safe context.",
      "Apply deterministic redaction rules before audit persistence.",
      "Support synchronous API transitions and asynchronous worker transitions without diverging event semantics.",
      "Make audit writing easy to reuse from auth, scan, reconciliation, legal, classification, reporting, and export paths.",
    ],
    nonGoals: [
      "No audit UI or export behavior.",
      "No raw-source or full-prompt storage.",
      "No business-specific event semantics outside the canonical audit contract.",
    ],
    verification: [
      [
        "audit completeness",
        "API / worker contract",
        "material state transitions can write consistent audit records from both runtimes",
      ],
      [
        "redaction",
        "security / persistence",
        "secrets and sensitive payloads are removed or replaced before persistence",
      ],
      [
        "traceability",
        "integration",
        "correlation and causation IDs survive across sync and async boundaries",
      ],
    ],
    failure: [
      [
        "audit payload build error",
        "fail closed for required material transitions",
        "operator sees safe failure reason",
        "audit write failure is itself observable",
      ],
      [
        "redaction mismatch",
        "reject persistence and block transition",
        "developer sees validation failure",
        "safe failure log only",
      ],
    ],
    definitionOfDone: [
      "API and worker code paths share one audit write contract.",
      "Redaction rules are documented and testable.",
      "Downstream tasks can reference `AuditEvent` without inventing custom per-domain shapes.",
    ],
    openDecisions: [
      [
        "Audit storage retention policy by environment",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-004",
    slug: "outbox-writer-publisher-retry-dlq",
    title: "Outbox Writer/Publisher/Retry/DLQ",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Platform",
    runtime: "cross-runtime",
    outcome:
      "Create the canonical outbox mechanism that turns durable domain state transitions into published commands/events with bounded retry and DLQ behavior.",
    sourceAuthority: [
      [
        "Architecture",
        "`docs/architecture/architecture.md`; `docs/architecture/adr/architecture-decision-records.md`",
      ],
      [
        "Specs",
        "`docs/specs/event-catalog.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/queue-implementation.md`; `docs/implementation/backend-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Decisions",
        "`docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`",
      ],
    ],
    scope: [
      "Define the shared `OutboxEvent` record shape and transactional write rule.",
      "Implement outbox publication flow separate from domain transactions.",
      "Document bounded retry, poison-message handling, and DLQ policy for API- and worker-originated messages.",
      "Preserve idempotency metadata so duplicate publication cannot multiply downstream artifacts.",
      "Expose enough operator signals to diagnose stuck or failed publication without inspecting raw payloads.",
    ],
    nonGoals: [
      "No direct publish from inside domain transactions.",
      "No scanner/legal/classification business logic.",
      "No bypass around queue durability guarantees.",
    ],
    verification: [
      [
        "transaction boundary",
        "persistence / queue",
        "domain mutation and outbox write succeed or fail together",
      ],
      [
        "retry and DLQ",
        "queue / operator",
        "retry budget and DLQ transition are explicit and reproducible",
      ],
      [
        "idempotency",
        "integration",
        "duplicate publisher runs do not duplicate published semantics",
      ],
    ],
    failure: [
      [
        "publisher outage",
        "retain outbox row and retry under policy",
        "operator sees lagging publication state",
        "safe publisher log/audit metadata",
      ],
      [
        "poison payload",
        "move to DLQ after bounded retries",
        "operator gets actionable failure class",
        "DLQ record retains correlation metadata",
      ],
    ],
    definitionOfDone: [
      "Outbox semantics are documented for API and worker producers.",
      "Retry and DLQ behavior is consistent with queue implementation authority.",
      "Later tasks can enqueue commands/events without inventing new reliability rules.",
    ],
    openDecisions: [
      [
        "Operational replay tooling depth beyond MVP",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-006",
    slug: "auth-session-oauth-mfa-baseline",
    title: "Auth/session/OAuth/MFA baseline",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Platform",
    runtime: "nestjs-api",
    outcome:
      "Build the authentication and session baseline for approved LCSP account entry, including OAuth/OIDC login, MFA controls, session safety, and safe denied-state handling.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 1 and Stories 1.1..1.4",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/domain-model.md`; `docs/specs/domain-state-machines.md`; `docs/specs/user-task-flows.md`",
      ],
      [
        "Story packets",
        "`docs/implementation-artifacts/1-1-approved-account-entry-and-workspace-access.md`; `docs/implementation-artifacts/1-2-mfa-session-recovery-and-profile-safety.md`; `docs/implementation-artifacts/1-3-oauth-oidc-login-without-repository-authorization.md`; `docs/implementation-artifacts/1-4-organization-membership-and-manager-policy-scope.md`",
      ],
    ],
    scope: [
      "Implement password/session or approved OAuth/OIDC identity entry under one LCSP session authority.",
      "Add MFA challenge/recovery hooks and safe profile-security controls.",
      "Separate identity authentication from GitHub repository authorization.",
      "Emit safe audit and blocked-state responses for invalid credentials, missing membership, session invalidation, and denied scopes.",
      "Use shared auth contract keys and required-action semantics from `packages/contracts` and `packages/i18n`.",
    ],
    nonGoals: [
      "No repository scan permission grant through login.",
      "No final PBAC policy runtime expansion beyond its dedicated task.",
      "No delegated Developer final authority.",
    ],
    verification: [
      [
        "approved entry",
        "auth / API",
        "valid approved user can obtain only an LCSP session scoped to authorized workspace context",
      ],
      [
        "safe denial",
        "auth / audit",
        "invalid or blocked auth states return safe messages and audit records without secrets",
      ],
      [
        "OAuth separation",
        "integration",
        "OIDC login cannot create repository authorization side effects",
      ],
    ],
    failure: [
      [
        "provider callback invalid",
        "deny login and preserve safe blocked state",
        "user sees actionable safe message",
        "audit contains failure reason only",
      ],
      [
        "session or MFA failure",
        "block continuation and require recovery action",
        "user gets required-action hint",
        "correlation ID present",
      ],
    ],
    definitionOfDone: [
      "Auth, session, OAuth, and MFA baseline is implemented under one API authority.",
      "Denied/blocked states use safe contract keys and audit.",
      "Later Epic 1 stories can extend policy and collaboration on top of this baseline.",
    ],
    openDecisions: [
      [
        "Exact OAuth provider roster for acceptance environment",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-007",
    slug: "organization-and-assessment-apis",
    title: "Organization and assessment APIs",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Assessment",
    runtime: "nestjs-api",
    outcome:
      "Create the Manager-owned organization and assessment API baseline that establishes tenant scope, assessment creation, and workflow guards before Interview or scan work begins.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 2 and Story 2.1",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/domain-model.md`; `docs/specs/domain-state-machines.md`; `docs/specs/user-task-flows.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/2-1-create-manager-owned-assessment.md`",
      ],
    ],
    scope: [
      "Implement organization-scoped assessment creation and retrieval APIs.",
      "Persist owner, organization, workflow state, and neutral readiness projection without implying legal or risk output.",
      "Enforce PBAC and tenant scope on all assessment operations.",
      "Emit audit events for create and denied actions.",
      "Provide the durable aggregate and state version used by Interview, repository, reconciliation, and downstream workflows.",
    ],
    nonGoals: [
      "No Interview question flow.",
      "No repository connection or scan trigger.",
      "No classification or report generation.",
    ],
    verification: [
      [
        "assessment ownership",
        "API / authz",
        "Manager-scoped create returns tenant-safe assessment and denies out-of-scope calls",
      ],
      [
        "neutral baseline",
        "state / UX",
        "new assessment does not imply legal readiness or risk output",
      ],
      [
        "auditability",
        "API / audit",
        "create and denial paths emit correlation-linked audit records",
      ],
    ],
    failure: [
      [
        "PBAC deny",
        "reject action server-side",
        "user gets safe blocked response",
        "audit records deny outcome",
      ],
      [
        "state version mismatch",
        "reject conflicting mutation",
        "client sees retry/refresh guidance",
        "safe error log only",
      ],
    ],
    definitionOfDone: [
      "Assessment aggregate and workflow baseline are stable for downstream tasks.",
      "Manager-owned organization scope is enforced server-side.",
      "Neutral readiness projection exists without overclaiming downstream outputs.",
    ],
    openDecisions: [
      [
        "Assessment numbering and human-readable identifier format",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-008",
    slug: "interview-context-readiness-apis",
    title: "InterviewContext/readiness APIs",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Assessment",
    runtime: "nestjs-api",
    outcome:
      "Create the InterviewContext draft/submit/readiness API surface that captures business-language assessment facts and emits readiness-only states before technical evidence exists.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 2 and Stories 2.2..2.4",
      ],
      [
        "UX / story",
        "`docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/WIZARD-MAPPING.md`; `docs/implementation-artifacts/2-2-complete-interview-context-in-business-language.md`; `docs/implementation-artifacts/2-3-interview-only-readiness-without-risk-level.md`; `docs/implementation-artifacts/2-4-wizard-readiness-export.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/user-task-flows.md`; `docs/specs/domain-state-machines.md`",
      ],
    ],
    scope: [
      "Implement InterviewContext draft/save/submit APIs with versioned persistence.",
      "Use business-language structure and explicit unknown/unclear states instead of code-centric fields.",
      "Project readiness-only output and readiness export entry points before scan evidence exists.",
      "Validate workflow/state guards and Manager authorization for submit/export actions.",
      "Expose API contracts that frontend can bind to the wizard mapping and readiness UX.",
    ],
    nonGoals: [
      "No technical evidence inference from interview-only data.",
      "No legal classification or final report generation.",
      "No direct developer attestation workflow.",
    ],
    verification: [
      [
        "business-language capture",
        "API / UX contract",
        "interview fields and responses align with canonical interview contract and safe unknown states",
      ],
      [
        "readiness-only behavior",
        "state / UX",
        "submit can create readiness guidance without risk level overclaim",
      ],
      [
        "version safety",
        "persistence",
        "draft and submit mutations preserve explicit versioned InterviewContext history",
      ],
    ],
    failure: [
      [
        "invalid interview context submission",
        "reject with field-safe validation response",
        "user sees actionable correction path",
        "audit contains safe validation outcome",
      ],
      [
        "premature readiness export",
        "block when state preconditions fail",
        "user gets blocked-state explanation",
        "correlation-linked deny record",
      ],
    ],
    definitionOfDone: [
      "InterviewContext APIs support draft, submit, readiness state, and readiness export entry boundaries.",
      "Unknown/unclear facts are preserved explicitly rather than guessed.",
      "Frontend can bind against one stable API contract for Epic 2.",
    ],
    openDecisions: [
      [
        "Exact long-form export document layout for readiness-only output",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-009",
    slug: "github-app-connection-and-snapshot",
    title: "GitHub App connection/snapshot",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Assessment",
    runtime: "nestjs-api",
    outcome:
      "Create the GitHub App repository connection and commit-pinned snapshot API boundary that trusted scan orchestration depends on.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 3 and Stories 3.1..3.2",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/scanner-worker-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/scanner-spec.md`; `docs/specs/user-task-flows.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/3-1-connect-read-only-github-repository.md`; `docs/implementation-artifacts/3-2-pin-commit-and-create-repositorysnapshot.md`",
      ],
    ],
    scope: [
      "Implement GitHub App installation binding and authorized read-only repository selection.",
      "Persist repository connection metadata without exposing raw tokens.",
      "Allow Manager-scoped branch/commit selection and immutable repository snapshot creation.",
      "Separate LCSP identity auth from repository authorization and installation scope.",
      "Provide the snapshot reference contract consumed by trusted scan trigger and scanner worker.",
    ],
    nonGoals: [
      "No scanner execution in API runtime.",
      "No write permission to customer repository.",
      "No manual evidence upload path as a substitute for trusted snapshots.",
    ],
    verification: [
      [
        "read-only auth",
        "API / integration",
        "repository selection is limited to authorized installations and read-only scope",
      ],
      [
        "immutable snapshot",
        "API / persistence",
        "scan input pins a specific commit or branch resolution snapshot without later mutation",
      ],
      [
        "safe token handling",
        "security",
        "raw GitHub tokens are never exposed in UI, logs, or ordinary persistence",
      ],
    ],
    failure: [
      [
        "invalid installation scope",
        "deny selection and require reauthorization",
        "user sees safe repository authorization message",
        "audit records deny reason",
      ],
      [
        "snapshot resolution failure",
        "block downstream trigger",
        "operator gets actionable safe status",
        "audit and status projection capture failure",
      ],
    ],
    definitionOfDone: [
      "Repository connection and snapshot contracts are stable for trusted trigger work.",
      "Read-only GitHub authorization is enforced server-side.",
      "Later scanner tasks can rely on immutable repository snapshot refs only.",
    ],
    openDecisions: [
      [
        "GitHub App webhook vs pull refresh strategy for installation sync",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-013",
    slug: "scanner-toolchain-execution",
    title: "Scanner toolchain execution",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Scanner",
    runtime: "deepagents",
    outcome:
      "Execute the locked scanner toolchain inside the restricted Python worker runtime and normalize bounded tool output for downstream evidence generation.",
    sourceAuthority: [
      ["Specs", "`docs/specs/scanner-spec.md`"],
      [
        "Implementation",
        "`docs/implementation/scanner-worker-implementation.md`; `docs/implementation/scanner-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`",
      ],
      [
        "Story / domain notes",
        "`docs-vn/05-python-scanner.md`; `docs/implementation-artifacts/3-4-static-scanner-workspace-and-sandbox.md`; `docs/implementation-artifacts/3-5-static-scanner-toolchain-execution.md`",
      ],
      [
        "Decisions",
        "`docs/implementation/decisions/scanner-severity-tool-provenance-decision.md`",
      ],
    ],
    scope: [
      "Run Syft, Knip, deptry, Semgrep, tree-sitter/custom parser augmentation, and bounded Python analysis under one restricted scanner workspace.",
      "Pin versions, config hashes, output bounds, CPU/time budgets, and provenance for every tool.",
      "Normalize tool results into a structured intermediate model instead of leaking raw tool output downstream.",
      "Map tool failures to either coverage limitation or terminal failure according to the approved severity table.",
      "Preserve cleanup and no-source-execution invariants throughout tool invocation.",
    ],
    nonGoals: [
      "No final TechnicalProfile generation.",
      "No legal matching or classification.",
      "No installation of repository dependencies or execution of customer code.",
    ],
    verification: [
      [
        "toolchain execution",
        "worker / integration",
        "scanner can run the required toolchain within bounded workspace and resource limits",
      ],
      [
        "provenance",
        "worker / persistence",
        "tool version, config hash, and failure class are recorded for downstream evidence gating",
      ],
      [
        "security boundary",
        "worker / security",
        "customer code is not executed and raw source is not persisted",
      ],
    ],
    failure: [
      [
        "tool timeout",
        "apply severity table and continue or fail closed as specified",
        "operator sees safe failure class",
        "audit/log contains bounded provenance only",
      ],
      [
        "unsafe output",
        "reject normalization and fail closed",
        "developer sees sanitized validation error",
        "safe failure record emitted",
      ],
    ],
    definitionOfDone: [
      "Locked scanner toolchain is executable inside the Python worker boundary.",
      "Every tool result has provenance and bounded failure semantics.",
      "Downstream evidence tasks consume normalized outputs, not raw tool data.",
    ],
    openDecisions: [
      [
        "Additional post-MVP analyzers beyond locked MVP toolchain",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-014",
    slug: "ts-js-subprocess-analyzer-protocol",
    title: "TS/JS subprocess analyzer/protocol",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Scanner",
    runtime: "deepagents",
    outcome:
      "Define and implement the fixed TS/JS analyzer subprocess protocol so Python scanner lifecycle ownership can safely consume bounded TypeScript/JavaScript semantic output.",
    sourceAuthority: [
      ["Specs", "`docs/specs/scanner-spec.md`"],
      [
        "Architecture / decisions",
        "`docs/architecture/adr/adr-023-python-worker-scanner-runtime.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/scanner-worker-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/3-5-static-scanner-toolchain-execution.md`",
      ],
    ],
    scope: [
      "Define the versioned JSON request/response contract between Python worker and TS/JS analyzer CLI.",
      "Invoke the analyzer with a fixed executable and argument list using `create_subprocess_exec`, never shell interpolation.",
      "Bound stdout, stderr, timeout, and affected-file error mapping.",
      "Validate and normalize analyzer output before it enters scanner evidence assembly.",
      "Ensure the analyzer does not own queue, persistence, or repository dependency installation responsibilities.",
    ],
    nonGoals: [
      "No separate HTTP analyzer service for MVP.",
      "No direct database writes from the analyzer.",
      "No repository dependency installation or code execution inside the analyzer.",
    ],
    verification: [
      [
        "protocol validation",
        "worker / subprocess",
        "invalid analyzer output is rejected before normalization",
      ],
      [
        "failure mapping",
        "worker / integration",
        "timeout or non-zero exit becomes bounded coverage limitation or failure class",
      ],
      [
        "ownership boundary",
        "architecture / integration",
        "Python worker remains sole lifecycle owner of scan jobs",
      ],
    ],
    failure: [
      [
        "analyzer non-zero exit",
        "record `TS_JS_ANALYZER_FAILED` and apply bounded downstream behavior",
        "operator sees affected-file limitation",
        "safe failure metadata only",
      ],
      [
        "schema mismatch",
        "reject output and fail closed",
        "developer gets protocol validation error",
        "sanitized log/audit metadata",
      ],
    ],
    definitionOfDone: [
      "The TS/JS analyzer protocol is versioned and documented.",
      "Subprocess invocation is bounded, redacted, and shell-free.",
      "Python scanner can consume TS/JS semantics without ceding lifecycle ownership.",
    ],
    openDecisions: [
      [
        "Analyzer packaging form for production deploy image",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-019",
    slug: "retired-developer-scoped-task-without-attestation",
    title: "Retired Developer scoped task without attestation",
    status: "RETIRED",
    priority: "P1",
    owner: "Assessment / Intelligence",
    runtime: "cross-runtime",
    outcome:
      "Record that scoped Developer task collaboration is retired from active LCSP scope and must not be regenerated as an active implementation task.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 1 optional collaboration plus review surfaces in Epics 3, 4, 5, and 8",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/1-5-optional-developer-invitation-and-scoped-task-acceptance.md`; `docs/implementation-artifacts/3-9-redacted-technical-findings-review-and-developer-scoped-view.md`; `docs/implementation-artifacts/4-6-aiusageflow-review-surface-without-final-authority.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/user-task-flows.md`; `docs/specs/domain-state-machines.md`",
      ],
    ],
    scope: [
      "Do not generate Developer invitation, assignment, acceptance, revocation, or scoped workspace work.",
      "Preserve historical references only as retired decision records.",
      "Route active technical evidence through Manager-authorized repository scan.",
    ],
    nonGoals: [
      "No Developer task workspace.",
      "No Developer attestation or final VerifiedProfile authority.",
      "No bypass around Manager conflict resolution or classification request gates.",
      "No broad organization-admin delegation.",
    ],
    verification: [
      [
        "retired scope",
        "planning / docs",
        "no active Developer collaboration task is generated",
      ],
      [
        "authority ceiling",
        "API / UX",
        "non-Manager subjects cannot finalize Manager-only actions or legal/compliance outputs",
      ],
      [
        "audit compatibility",
        "API / audit",
        "historical invitation audit resource values remain read-compatible only",
      ],
    ],
    failure: [
      [
        "out-of-scope action",
        "deny server-side and preserve current workflow state",
        "user sees safe blocked response",
        "deny event audited",
      ],
      [
        "stale assignment",
        "reject action until scope is refreshed",
        "user gets refresh guidance",
        "correlation-linked safe failure",
      ],
    ],
    definitionOfDone: [
      "Developer collaboration remains retired from active implementation scope.",
      "Manager remains final authority for conflict resolution, classification, and reporting outputs.",
      "Review surfaces are scoped, auditable, and tenant-safe.",
    ],
    openDecisions: [
      [
        "Whether delegated collaboration ever returns",
        "`REQUIRES_NEW_SCOPE_DECISION`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-020",
    slug: "python-legal-source-validation-ingestion",
    title: "Python legal source validation/ingestion",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Legal",
    runtime: "deepagents",
    outcome:
      "Implement the legal source validation and ingestion worker that fetches only approved official sources, stores immutable snapshots, and stages normalized legal corpus artifacts.",
    sourceAuthority: [
      [
        "Architecture / decisions",
        "`docs/architecture/adr/adr-025-legal-corpus-source-architecture.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/legal-corpus-ingestion-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/legal-corpus-source-spec.md`; `docs/specs/legal-matching-domain-spec.md`; `docs/specs/event-catalog.md`",
      ],
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 6 and Stories 6.1..6.2",
      ],
    ],
    scope: [
      "Consume legal-source ingestion commands from validated source definitions only.",
      "Fetch official source URLs under allowlist and SSRF-safe controls.",
      "Store immutable HTML/PDF snapshots with hash provenance.",
      "Extract document identity, effective dates, and hierarchical legal structure into draft corpus records.",
      "Emit completion/failure events and audit provenance without exposing arbitrary fetched content.",
    ],
    nonGoals: [
      "No corpus approval decision.",
      "No ChromaDB index build.",
      "No legal matching or classification output.",
      "No unrestricted crawling or arbitrary URL ingestion.",
    ],
    verification: [
      [
        "source validation gate",
        "worker / security",
        "unvalidated or off-allowlist sources are rejected before fetch",
      ],
      [
        "immutable provenance",
        "worker / storage",
        "snapshot hash, source URL, and retrieval metadata are recorded for staged corpus items",
      ],
      [
        "normalization baseline",
        "worker / persistence",
        "draft legal document structure is persisted without auto-approval",
      ],
    ],
    failure: [
      [
        "source unavailable",
        "bounded retry then fail closed",
        "operator sees safe unavailable state",
        "failure event and audit emitted",
      ],
      [
        "identity or structure extraction failure",
        "block approval eligibility and require review",
        "operator sees actionable review state",
        "safe failure metadata recorded",
      ],
    ],
    definitionOfDone: [
      "Validated-source-only ingestion worker exists.",
      "Immutable legal source snapshots and normalized draft corpus artifacts are persisted.",
      "Approval and indexing can proceed from one staged source-of-truth path.",
    ],
    openDecisions: [
      [
        "Final validated official source host list for acceptance environment",
        "`CARRIED_FORWARD`",
        "yes",
      ],
    ],
  },
  {
    id: "TASK-021",
    slug: "internal-corpus-review-approval",
    title: "Internal corpus review/approval",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Legal",
    runtime: "cross-runtime",
    outcome:
      "Create the internal-only review and approval surface that turns draft legal corpus artifacts into immutable approved corpus versions eligible for index build and legal retrieval.",
    sourceAuthority: [
      [
        "Architecture / decisions",
        "`docs/architecture/adr/adr-025-legal-corpus-source-architecture.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/legal-corpus-ingestion-implementation.md`; `docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 6 and Story 6.3",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/6-3-approve-legalcorpusversion.md`",
      ],
    ],
    scope: [
      "Expose internal-only draft corpus review and approval operations for the Internal Legal Operator.",
      "Validate source status, document identity, effective dates, hierarchy accuracy, and review scope before approval.",
      "Create immutable `LegalCorpusVersion` and `CorpusApprovalRecord` only after explicit approval.",
      "Write approval/rejection audit metadata and queue index-build follow-up on success.",
      "Keep this surface outside Manager/Developer customer-facing UX.",
    ],
    nonGoals: [
      "No public legal administration UI.",
      "No legal index build logic.",
      "No legal advice or certification semantics.",
    ],
    verification: [
      [
        "approval gate",
        "API / workflow",
        "only reviewed draft corpus can transition to approved state",
      ],
      [
        "immutability",
        "persistence",
        "approved corpus version cannot be silently mutated in place",
      ],
      [
        "internal-only boundary",
        "authz / UX",
        "Manager/Developer surfaces do not expose corpus administration",
      ],
    ],
    failure: [
      [
        "approval prerequisite missing",
        "reject approval and keep version in draft",
        "operator sees missing review basis",
        "audit records safe rejection reason",
      ],
      [
        "attempted update to approved version",
        "block mutation and require new draft",
        "operator sees immutable-version guidance",
        "safe audit event emitted",
      ],
    ],
    definitionOfDone: [
      "Internal corpus approval path is documented and auditable.",
      "Approved corpus versions are immutable and index-build-ready only after explicit approval.",
      "Customer-facing roles cannot access this administration surface.",
    ],
    openDecisions: [
      [
        "CLI vs internal HTTP-first operator flow for MVP ergonomics",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-022",
    slug: "python-chromadb-vectorless-legal-index-build",
    title: "Python ChromaDB vectorless legal index build",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Legal",
    runtime: "deepagents",
    outcome:
      "Build the worker that turns approved legal corpus versions into ChromaDB structure-first vectorless indexes with stable IDs, hierarchy metadata, and cross-reference integrity.",
    sourceAuthority: [
      [
        "Architecture / decisions",
        "`docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 6 and Story 6.4",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/6-4-build-chromadb-structure-first-vectorless-legal-index.md`",
      ],
    ],
    scope: [
      "Consume legal index build commands for approved corpus versions only.",
      "Write ChromaDB records with stable document/article/clause/point IDs and minimum metadata contract.",
      "Preserve cross-reference edges, effective-date filtering metadata, and supersession links.",
      "Validate direct lookup, metadata filtering, and full-text retrieval readiness before marking the index complete.",
      "Emit completion/failure events that downstream legal matching can trust.",
    ],
    nonGoals: [
      "No dense embedding index as MVP requirement.",
      "No classification or legal-match output.",
      "No retrieval request serving from this build task itself.",
    ],
    verification: [
      [
        "stable IDs",
        "worker / index",
        "approved corpus builds deterministic hierarchical IDs inside the pinned version",
      ],
      [
        "metadata completeness",
        "worker / retrieval contract",
        "required retrieval metadata exists for all indexed chunks",
      ],
      [
        "readiness gate",
        "worker / workflow",
        "unusable or partial index does not become retrieval-eligible",
      ],
    ],
    failure: [
      [
        "missing hierarchy metadata",
        "fail index build",
        "operator sees explicit build failure reason",
        "failure event and audit emitted",
      ],
      [
        "Chroma unavailable",
        "block completion and retry/fail under policy",
        "operator sees unavailable index state",
        "safe failure metadata only",
      ],
    ],
    definitionOfDone: [
      "Approved corpus versions can produce one validated ChromaDB legal index profile.",
      "Stable IDs and xref metadata are preserved.",
      "Legal matching can depend on explicit index completion records only.",
    ],
    openDecisions: [
      [
        "Chroma collection naming and retention strategy across environments",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-023",
    slug: "chromadb-vectorless-retriever-retrieval-audit",
    title: "ChromaDB vectorless retriever/retrieval audit",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Legal",
    runtime: "deepagents",
    outcome:
      "Implement the legal retriever that queries approved ChromaDB corpus versions with structure-first rules and persists sanitized retrieval audit evidence.",
    sourceAuthority: [
      [
        "Architecture / decisions",
        "`docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`; `docs/implementation/persistence-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/legal-matching-domain-spec.md`; `docs/specs/event-catalog.md`",
      ],
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 6 and Stories 6.5..6.6",
      ],
    ],
    scope: [
      "Retrieve legal candidates by approved corpus version, effective date, metadata filters, and stable ID lookups.",
      "Assemble `PRIMARY_MATCH`, `PARENT_CONTEXT`, and `REFERENCED_CONTEXT` payload roles.",
      "Enforce citation allowlist construction and retrieval-audit persistence.",
      "Store sanitized retrieval query metadata, result refs, and correlation IDs.",
      "Fail closed when retrieval cannot reconstruct required citation provenance.",
    ],
    nonGoals: [
      "No legal conclusion synthesis.",
      "No embedding-first semantic nearest-neighbor MVP path.",
      "No public search UI.",
    ],
    verification: [
      [
        "retrieval roles",
        "worker / retrieval",
        "primary, parent, and referenced context remain distinguishable and reproducible",
      ],
      [
        "audit trail",
        "worker / persistence",
        "retrieval audit contains sanitized query metadata and matched IDs only",
      ],
      [
        "citation safety",
        "worker / guardrail",
        "out-of-allowlist or unreconstructable citations are rejected",
      ],
    ],
    failure: [
      [
        "zero valid candidates",
        "block/degrade downstream by rule criticality",
        "operator sees explicit unavailable-basis state",
        "retrieval audit captures result class",
      ],
      [
        "allowlist reconstruction failure",
        "reject retrieval output",
        "developer/operator sees citation integrity failure",
        "safe failure metadata emitted",
      ],
    ],
    definitionOfDone: [
      "Retriever obeys approved corpus, metadata, and citation safety rules.",
      "Retrieval audit is sanitized and reproducible.",
      "Legal matching can consume retrieval output without inventing citation provenance.",
    ],
    openDecisions: [
      [
        "Optional future reranker path beyond vectorless MVP retrieval",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-024",
    slug: "python-legal-matching-worker",
    title: "Python Legal Matching worker",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Legal",
    runtime: "deepagents",
    outcome:
      "Build the worker that turns approved `VerifiedProfile` facts plus approved legal retrieval output into `LegalMatchingResult` and `LegalRuleMatch` evidence.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 6 and Story 6.7",
      ],
      [
        "Implementation",
        "`docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`; `docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/persistence-implementation.md`; `docs/implementation/queue-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/legal-matching-domain-spec.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/6-7-create-legalmatchingresult-and-legalrulematch-evidence.md`",
      ],
    ],
    scope: [
      "Consume legal matching requests only from approved `VerifiedProfile` and approved corpus/index prerequisites.",
      "Resolve legal rule matches using retrieved legal context, role semantics, and citation allowlist constraints.",
      "Persist immutable `LegalMatchingResult` plus `LegalRuleMatch[]` evidence with retrieval audit references.",
      "Preserve explicit blocking reasons and citation coverage state for downstream classification.",
      "Emit completion/failure events for the classification orchestration boundary.",
    ],
    nonGoals: [
      "No provider-only legal conclusion.",
      "No risk classification output.",
      "No bypass around corpus approval or retrieval allowlist gates.",
    ],
    verification: [
      [
        "evidence contract",
        "worker / persistence",
        "material legal matches retain citation refs, retrieval audit refs, and blocking reasons",
      ],
      [
        "gate correctness",
        "worker / workflow",
        "missing prerequisites block matching instead of inventing legal basis",
      ],
      [
        "downstream safety",
        "worker / integration",
        "classification sees explicit coverage and block metadata only from legal matching output",
      ],
    ],
    failure: [
      [
        "missing approved corpus/index",
        "block matching",
        "operator sees explicit prerequisite failure",
        "safe failure event emitted",
      ],
      [
        "citation gap",
        "preserve blocking reason and refuse complete match output",
        "downstream sees blocked/degraded state",
        "retrieval/audit refs retained",
      ],
    ],
    definitionOfDone: [
      "Legal matching output is immutable, citation-backed, and audit-traceable.",
      "Downstream classification depends on `LegalMatchingResult`, not ad hoc retrieval state.",
      "Missing or partial legal basis fails closed.",
    ],
    openDecisions: [
      [
        "Rule authoring workflow for legal matching rules beyond MVP seed set",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-025",
    slug: "real-llm-gateway",
    title: "Real LLM Gateway",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Platform",
    runtime: "cross-runtime",
    outcome:
      "Create the only allowed external model invocation boundary with real provider mode, schema validation, prompt-version tracking, retries, and privacy enforcement.",
    sourceAuthority: [
      [
        "Architecture",
        "`docs/architecture/architecture.md`; `docs/architecture/multi-agent-system-architecture.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/llm-gateway-implementation.md`; `docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/legal-classification-spec.md`; `docs/specs/document-generation-spec.md`",
      ],
    ],
    scope: [
      "Define the shared gateway API/adapter contract used by classification and document-generation workloads.",
      "Support real provider mode for integrated MVP acceptance while keeping deterministic mock mode for unit/offline CI.",
      "Enforce structured/sanitized inputs, schema-constrained outputs, prompt-version refs, and provider/model metadata recording.",
      "Implement timeout, retry, and fail-closed behavior for invalid or unsafe outputs.",
      "Prevent any direct provider call from bypassing the gateway contract.",
    ],
    nonGoals: [
      "No raw-source, full-prompt, or secret logging.",
      "No legal conclusion acceptance without downstream citation guardrails.",
      "No embedding-retrieval responsibility.",
    ],
    verification: [
      [
        "single invocation boundary",
        "integration / security",
        "classification and document paths call the external provider only through the gateway",
      ],
      [
        "provider mode rules",
        "config / acceptance",
        "real provider mode is mandatory for integrated acceptance runs and mock mode remains test-only",
      ],
      [
        "schema safety",
        "gateway / validation",
        "invalid provider output fails closed and is recorded with safe metadata",
      ],
    ],
    failure: [
      [
        "provider outage",
        "retry within budget then return blocked/degraded result per caller policy",
        "operator sees provider-safe failure class",
        "gateway audit metadata recorded",
      ],
      [
        "disallowed input class",
        "reject request before provider call",
        "developer/operator sees input-policy failure",
        "security audit emitted",
      ],
    ],
    definitionOfDone: [
      "Gateway is the sole provider invocation boundary.",
      "Real provider mode is supported and documented for acceptance use.",
      "Prompt/version, model metadata, and output hash are auditable without leaking sensitive content.",
    ],
    openDecisions: [
      [
        "Final provider/model selection for acceptance environment",
        "`CARRIED_FORWARD`",
        "yes",
      ],
    ],
  },
  {
    id: "TASK-026",
    slug: "python-risk-classification-worker",
    title: "Python Risk Classification worker",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Legal",
    runtime: "deepagents",
    outcome:
      "Generate citation-backed `RiskClassification` only from approved `VerifiedProfile`, approved legal matching evidence, and the LLM gateway under deterministic guardrails.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 7 and Stories 7.1..7.6",
      ],
      [
        "Specs",
        "`docs/specs/legal-classification-spec.md`; `docs/specs/domain-state-machines.md`; `docs/specs/user-task-flows.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/llm-gateway-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/7-1-submit-classification-request-from-approved-verifiedprofile.md`; `docs/implementation-artifacts/7-3-use-real-llm-provider-with-schema-and-budget-guardrails.md`; `docs/implementation-artifacts/7-5-validate-classification-citations-against-legal-allowlist.md`",
      ],
    ],
    scope: [
      "Consume classification requests only after VerifiedProfile and LegalMatchingResult gates pass.",
      "Apply hard rules, legal precedence, provider guardrails, and citation allowlist validation.",
      "Call the LLM gateway with sanitized structured inputs when model reasoning is required.",
      "Persist `RiskClassification` with block/degrade reasons, provider/model metadata, and citation coverage status.",
      "Emit status that downstream gap analysis can consume safely.",
    ],
    nonGoals: [
      "No classification from interview-only or provider-only evidence.",
      "No bypass around legal citation allowlist.",
      "No document generation in this worker.",
    ],
    verification: [
      [
        "gated request",
        "worker / workflow",
        "classification cannot start before VerifiedProfile and legal evidence gates are satisfied",
      ],
      [
        "citation integrity",
        "worker / guardrail",
        "classification output cites only retrieved allowlist-backed legal references",
      ],
      [
        "provider guardrails",
        "worker / gateway",
        "schema-invalid or unsupported provider outputs return blocked/degraded state",
      ],
    ],
    failure: [
      [
        "missing legal basis",
        "block classification",
        "user/operator sees explicit missing-evidence state",
        "safe failure event emitted",
      ],
      [
        "gateway/schema failure",
        "retry within policy then degrade/block",
        "operator sees provider-safe failure reason",
        "audit records provider/model metadata only",
      ],
    ],
    definitionOfDone: [
      "Classification is citation-backed and gate-checked.",
      "Provider use remains subordinate to deterministic legal and workflow guardrails.",
      "Gap analysis sees only safe final or blocked/degraded classification state.",
    ],
    openDecisions: [
      [
        "Risk taxonomy extensions beyond locked MVP classification set",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-027",
    slug: "python-gap-analysis-worker",
    title: "Python Gap Analysis worker",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Reporting",
    runtime: "deepagents",
    outcome:
      "Generate `GapAnalysis` from approved classification state and upstream evidence chain so reporting surfaces can explain obligations, missing controls, and next actions without overclaiming.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 8 and Stories 8.1..8.2",
      ],
      [
        "Implementation",
        "`docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/persistence-implementation.md`; `docs/implementation/llm-gateway-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/document-generation-spec.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/8-1-generate-gapanalysis-from-classification-and-evidence.md`; `docs/implementation-artifacts/8-2-display-gap-analysis-with-evidence-and-priority.md`",
      ],
    ],
    scope: [
      "Consume gap-analysis commands only from approved or explicitly degraded classification states.",
      "Project missing controls, obligations, evidence gaps, and priority/action metadata with upstream provenance preserved.",
      "Preserve blocked/degraded semantics instead of manufacturing final readiness language.",
      "Persist immutable `GapAnalysis` artifact versioned to upstream classification and evidence inputs.",
      "Emit completion/failure events for reporting and document-generation surfaces.",
    ],
    nonGoals: [
      "No final guarded report or downloadable artifact generation.",
      "No new legal classification inference.",
      "No bypass around upstream blocked/degraded state semantics.",
    ],
    verification: [
      [
        "upstream traceability",
        "worker / persistence",
        "gap analysis references exact classification/evidence versions",
      ],
      [
        "non-overclaiming output",
        "worker / content guardrail",
        "blocked or degraded upstream states remain explicit in gap output",
      ],
      [
        "priority/action semantics",
        "worker / UX contract",
        "results expose actionable but non-authoritative next-step structure",
      ],
    ],
    failure: [
      [
        "missing classification state",
        "block generation",
        "operator sees prerequisite failure",
        "safe failure event emitted",
      ],
      [
        "insufficient evidence coverage",
        "degrade or block output explicitly",
        "user sees evidence-gap state",
        "audit retains cause metadata",
      ],
    ],
    definitionOfDone: [
      "GapAnalysis is versioned to upstream classification and evidence chain.",
      "Output explains gaps without inventing unsupported certainty.",
      "Document/report tasks can consume one stable gap-analysis artifact.",
    ],
    openDecisions: [
      [
        "Prompting vs deterministic template balance for gap narrative generation",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-028",
    slug: "python-document-generation-s3-status-download",
    title: "Python Document generation/S3/status/download",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "Reporting",
    runtime: "cross-runtime",
    outcome:
      "Generate guarded report artifacts, store them in object storage, expose versioned status/download refs, and preserve audit-safe download behavior for final reporting flows.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 8 and Stories 8.3..8.5",
      ],
      [
        "Implementation",
        "`docs/implementation/python-worker-platform-implementation.md`; `docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`; `docs/implementation/llm-gateway-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/document-generation-spec.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/8-3-generate-guarded-final-report.md`; `docs/implementation-artifacts/8-4-generate-evidence-readiness-report-when-final-evidence-is-missing.md`; `docs/implementation-artifacts/8-5-download-versioned-artifacts.md`",
      ],
    ],
    scope: [
      "Generate guarded final or readiness report artifacts from approved upstream inputs only.",
      "Store generated artifacts in object storage with immutable version refs and metadata.",
      "Project generation status and download availability through API read models.",
      "Enforce PBAC and artifact-state checks on download serving and denied access.",
      "Audit generation, download, and denied-access paths with redacted metadata only.",
    ],
    nonGoals: [
      "No raw prompt or secret persistence.",
      "No unaudited artifact access path.",
      "No mutation of already-issued artifact versions.",
    ],
    verification: [
      [
        "artifact immutability",
        "worker / storage",
        "new generation creates versioned artifact refs rather than mutating prior versions",
      ],
      [
        "download safety",
        "API / authz",
        "only authorized users can access valid artifact versions and denials are audited",
      ],
      [
        "status projection",
        "API / worker integration",
        "generation and download states are visible without exposing raw storage details",
      ],
    ],
    failure: [
      [
        "generation guard failure",
        "emit blocked/readiness state instead of final report",
        "user sees actionable blocked reason",
        "audit/status projection updated",
      ],
      [
        "storage failure",
        "block artifact availability",
        "operator sees storage-safe failure class",
        "safe event/audit metadata emitted",
      ],
    ],
    definitionOfDone: [
      "Document generation, artifact storage, status, and download contracts are stable.",
      "Final/report readiness paths remain guardrailed by upstream evidence states.",
      "Artifact access is versioned, auditable, and tenant-safe.",
    ],
    openDecisions: [
      [
        "Long-term artifact retention lifecycle after MVP",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-029",
    slug: "audit-query-export",
    title: "Audit query/export",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P1",
    owner: "Platform",
    runtime: "nestjs-api",
    outcome:
      "Expose the synchronous audit query and redacted export surface needed for reporting, review, and acceptance evidence without leaking secrets or out-of-scope data.",
    sourceAuthority: [
      [
        "Epic / story",
        "`docs/planning-artifacts/epics.md` Epic 8 and Stories 8.6..8.7",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/persistence-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/event-catalog.md`; `docs/specs/domain-state-machines.md`",
      ],
      [
        "Story packet",
        "`docs/implementation-artifacts/8-6-record-immutable-assessment-audit-trail.md`; `docs/implementation-artifacts/8-7-view-and-export-redacted-audit-trail.md`",
      ],
    ],
    scope: [
      "Implement audit query read models for scoped review of material workflow history.",
      "Support redacted audit export with checksum, filter metadata, and version refs.",
      "Enforce PBAC, tenant scope, and redaction policy on every query/export path.",
      "Keep audit query/export synchronous in the backend API for MVP.",
      "Provide operator-safe status when export/view requests are denied or incomplete.",
    ],
    nonGoals: [
      "No separate audit export worker for MVP.",
      "No raw secret, token, or full prompt visibility.",
      "No historical rewrite or mutable audit correction path.",
    ],
    verification: [
      [
        "query redaction",
        "API / authz",
        "authorized users see only redacted audit fields in-scope for their role and tenant",
      ],
      [
        "export integrity",
        "API / artifact",
        "audit export includes filter/checksum/version metadata and omits hidden content",
      ],
      [
        "deny behavior",
        "API / audit",
        "out-of-scope requests are denied and auditable",
      ],
    ],
    failure: [
      [
        "out-of-scope request",
        "deny export/view server-side",
        "user sees safe blocked response",
        "deny event audited",
      ],
      [
        "export assembly failure",
        "return actionable failure state without partial unsafe artifact",
        "operator sees safe failure class",
        "safe audit metadata recorded",
      ],
    ],
    definitionOfDone: [
      "Audit query and export surfaces are synchronous, redacted, and scoped.",
      "Historical events remain immutable while review/export becomes usable.",
      "Acceptance and reporting flows can reference one canonical audit surface.",
    ],
    openDecisions: [
      ["Export file format mix beyond MVP baseline", "`CARRIED_FORWARD`", "no"],
    ],
  },
  {
    id: "TASK-030",
    slug: "manager-web-happy-path",
    title: "Manager web happy path",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P1",
    owner: "UX / Assessment",
    runtime: "apps-web",
    outcome:
      "Assemble the Manager-facing web happy path across the already-defined module surfaces so a primary user can move through authentication, assessment, interview, evidence, classification, and reporting states coherently.",
    sourceAuthority: [
      [
        "UX",
        "`docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md`; `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md`; `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/DESIGN.md`; `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md`",
      ],
      [
        "Execution guide",
        "`docs/developer/developer-implementation-guide.md`; `docs/developer/mvp-6-week-execution-board.md`",
      ],
      [
        "Stories",
        "`docs/implementation-artifacts/2-1-create-manager-owned-assessment.md`; `docs/implementation-artifacts/2-2-complete-interview-context-in-business-language.md`; `docs/implementation-artifacts/7-6-present-classification-blocked-or-degraded-state.md`; `docs/implementation-artifacts/8-3-generate-guarded-final-report.md`",
      ],
      ["Implementation", "`docs/implementation/backend-implementation.md`"],
    ],
    scope: [
      "Compose the Manager happy path using existing module APIs and story-level behavior contracts.",
      "Cover sign-in, assessment creation, interview progression, readiness/evidence states, classification visibility, and report/download entry points.",
      "Keep screen transitions aligned with workflow state instead of client-side assumptions.",
      "Display blocked/degraded reasons safely when backend state requires them.",
      "Treat this as cross-module UX integration, not a new domain-authority layer.",
    ],
    nonGoals: [
      "No new business rules that override backend guards.",
      "No all-in-one mega-feature that replaces module tasks.",
      "No Developer-specific path ownership.",
    ],
    verification: [
      [
        "state-driven UX",
        "UI / integration",
        "Manager screens follow real backend state transitions without unsupported shortcuts",
      ],
      [
        "cross-module continuity",
        "UI / API",
        "assessment, interview, evidence, classification, and reporting surfaces connect coherently",
      ],
      [
        "safe blocked states",
        "UI / authz",
        "blocked/degraded reasons are rendered safely instead of hidden or guessed",
      ],
    ],
    failure: [
      [
        "backend blocked state",
        "render safe recovery/next-step UX",
        "Manager sees what is missing without false success",
        "correlation-aware support signal available",
      ],
      [
        "stale UI assumptions",
        "force refresh from backend status",
        "user sees synchronized state rather than local phantom success",
        "no unsafe silent transition",
      ],
    ],
    definitionOfDone: [
      "Manager happy path is documented as a UI integration task over module APIs.",
      "Screens follow backend workflow authority.",
      "Blocked/degraded/ready states remain explicit and safe across the main path.",
    ],
    openDecisions: [
      [
        "Final visual polish and non-critical microcopy beyond MVP baseline",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-031",
    slug: "retired-developer-web-path",
    title: "Retired Developer web path",
    status: "RETIRED",
    priority: "P1",
    owner: "UX / Assessment",
    runtime: "apps-web",
    outcome:
      "Record that the Developer-facing web path is retired and must not be regenerated as an active web implementation task.",
    sourceAuthority: [
      [
        "UX / execution",
        "`docs/developer/developer-implementation-guide.md`; `docs/developer/mvp-6-week-execution-board.md`",
      ],
      [
        "Stories",
        "`docs/implementation-artifacts/1-5-optional-developer-invitation-and-scoped-task-acceptance.md`; `docs/implementation-artifacts/3-9-redacted-technical-findings-review-and-developer-scoped-view.md`; `docs/implementation-artifacts/4-6-aiusageflow-review-surface-without-final-authority.md`; `docs/implementation-artifacts/8-7-view-and-export-redacted-audit-trail.md`",
      ],
      ["Implementation", "`docs/implementation/backend-implementation.md`"],
    ],
    scope: [
      "Do not render Developer invitation, task selection, or scoped workspace surfaces.",
      "Support Manager review of redacted findings, AI usage review context, and other approved technical artifacts.",
      "Surface blocked/denied states cleanly when Manager-only actions are attempted.",
      "Treat Developer web path references as retired historical context only.",
    ],
    nonGoals: [
      "No Manager-only decision UX.",
      "No broad admin, classification, or final-report authority.",
      "No bypass around API scope checks.",
    ],
    verification: [
      [
        "retired navigation",
        "UI / authz",
        "Developer scoped navigation is not generated",
      ],
      [
        "review-only behavior",
        "UI / workflow",
        "technical review surfaces do not imply final authority or attestation",
      ],
      [
        "revocation handling",
        "UI / integration",
        "revoked or expired scope removes access cleanly with safe messaging",
      ],
    ],
    failure: [
      [
        "out-of-scope route",
        "show denied state and redirect to allowed context",
        "user sees safe access message",
        "no hidden privilege escalation",
      ],
      [
        "missing delegated artifact",
        "show blocked or unavailable state",
        "user sees why the review surface is unavailable",
        "no fake fallback content",
      ],
    ],
    definitionOfDone: [
      "Developer web path remains retired from active implementation scope.",
      "Manager authority boundaries stay visible in UX.",
      "Scoped review surfaces align with backend delegation and artifact availability.",
    ],
    openDecisions: [
      [
        "Whether delegated web collaboration ever returns",
        "`REQUIRES_NEW_SCOPE_DECISION`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-032",
    slug: "accessibility-blocked-recovery-states",
    title: "Accessibility/blocked/recovery states",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P1",
    owner: "UX / QA",
    runtime: "apps-web",
    outcome:
      "Normalize accessibility, blocked-state, and recovery-state behavior across the web experience so critical workflow failure modes remain understandable and usable.",
    sourceAuthority: [
      [
        "UX",
        "`docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md`; `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-26-wizard-epic-2/EXPERIENCE.md`",
      ],
      [
        "Execution guide",
        "`docs/developer/developer-implementation-guide.md`; `docs/developer/mvp-6-week-execution-board.md`",
      ],
      [
        "Stories",
        "`docs/implementation-artifacts/1-2-mfa-session-recovery-and-profile-safety.md`; `docs/implementation-artifacts/2-3-interview-only-readiness-without-risk-level.md`; `docs/implementation-artifacts/7-6-present-classification-blocked-or-degraded-state.md`; `docs/implementation-artifacts/8-4-generate-evidence-readiness-report-when-final-evidence-is-missing.md`",
      ],
      ["Implementation", "`docs/implementation/backend-implementation.md`"],
    ],
    scope: [
      "Define consistent blocked, degraded, denied, timeout, retry, recovery, and empty states across the main UX surfaces.",
      "Ensure keyboard, focus, semantics, and announcement behavior are adequate for those critical states.",
      "Render contract-based required actions and correlation-safe support hints from backend responses.",
      "Keep blocked-state UX aligned with actual workflow and authz causes rather than generic error pages.",
      "Use this task as cross-surface polish and safety integration, not as a new feature domain.",
    ],
    nonGoals: [
      "No replacement of module-specific business behavior.",
      "No frontend-only retry logic that bypasses backend workflow gates.",
      "No silent hiding of blocked/degraded causes.",
    ],
    verification: [
      [
        "accessibility baseline",
        "UI / QA",
        "critical blocked and recovery states remain navigable and understandable with keyboard and semantics",
      ],
      [
        "backend contract fidelity",
        "UI / integration",
        "required-action and blocked reason rendering matches backend response contract",
      ],
      [
        "cross-surface consistency",
        "UI / design QA",
        "shared blocked/recovery states behave consistently across auth, wizard, classification, and reporting",
      ],
    ],
    failure: [
      [
        "unexpected backend error",
        "show safe recovery state with correlation hint",
        "user sees next-step guidance rather than raw error dump",
        "safe support signal available",
      ],
      [
        "stale local state",
        "reload from authoritative backend status",
        "user sees true workflow position",
        "no phantom progress UI",
      ],
    ],
    definitionOfDone: [
      "Critical blocked/degraded/recovery states are accessible and consistent.",
      "Backend required-action semantics are surfaced cleanly in web UX.",
      "QA can validate the main failure surfaces without ad hoc UI branches.",
    ],
    openDecisions: [
      [
        "Formal accessibility audit tooling depth for MVP vs post-MVP",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
  {
    id: "TASK-033",
    slug: "a-to-z-happy-path-acceptance",
    title: "A-to-Z happy path acceptance",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "QA / All",
    runtime: "cross-runtime",
    outcome:
      "Run and document the integrated A-to-Z happy path that proves the MVP can traverse from approved account entry through repository scan, evidence chain, legal matching, classification, gap analysis, and guarded reporting with a real LLM provider path.",
    sourceAuthority: [
      [
        "Execution / readiness",
        "`docs/planning-artifacts/implementation-readiness-report-2026-06-25.md`; `docs/developer/mvp-6-week-execution-board.md`; `docs/implementation/tasks/README.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/scanner-worker-implementation.md`; `docs/implementation/legal-corpus-ingestion-implementation.md`; `docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`; `docs/implementation/llm-gateway-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/scanner-spec.md`; `docs/specs/legal-classification-spec.md`; `docs/specs/document-generation-spec.md`; `docs/specs/domain-state-machines.md`",
      ],
    ],
    scope: [
      "Define the canonical integrated acceptance walkthrough over the full MVP pipeline.",
      "Verify the mandatory real-provider path where acceptance rules require it.",
      "Capture evidence that each major artifact boundary is versioned, auditable, and non-overclaiming.",
      "Document any explicit controlled fixtures or acceptance-only environment prerequisites.",
      "Treat this as acceptance orchestration over completed module work, not a substitute for feature implementation tasks.",
    ],
    nonGoals: [
      "No introduction of new behavior to make acceptance pass.",
      "No claiming acceptance from mock-only or partial pipeline runs.",
      "No replacing module-level verification with one umbrella smoke test.",
    ],
    verification: [
      [
        "integrated pipeline",
        "acceptance / cross-runtime",
        "one end-to-end run reaches final guarded output from approved entry through reporting",
      ],
      [
        "real provider rule",
        "acceptance / config",
        "run uses real provider mode where MVP acceptance requires it",
      ],
      [
        "artifact traceability",
        "acceptance / audit",
        "major artifacts retain version, provenance, and correlation linkage through the run",
      ],
    ],
    failure: [
      [
        "upstream gate failure",
        "stop acceptance and record exact blocking stage",
        "operator sees first failing domain boundary",
        "safe acceptance log/audit evidence retained",
      ],
      [
        "mock-only environment",
        "mark run non-qualifying",
        "team sees readiness gap explicitly",
        "no false MVP-pass claim",
      ],
    ],
    definitionOfDone: [
      "A canonical A-to-Z acceptance runbook exists and is executable.",
      "Success criteria explicitly include real-provider and provenance rules.",
      "Acceptance evidence points back to the implemented module and task boundaries.",
    ],
    openDecisions: [
      [
        "Final acceptance dataset and fixture ownership by environment",
        "`CARRIED_FORWARD`",
        "yes",
      ],
    ],
  },
  {
    id: "TASK-034",
    slug: "negative-path-acceptance",
    title: "Negative-path acceptance",
    status: "READY_FOR_PLANNING_REVIEW",
    priority: "P0",
    owner: "QA / All",
    runtime: "cross-runtime",
    outcome:
      "Validate that the MVP fails safely on the important negative paths: denied access, missing evidence, legal basis gaps, provider errors, redaction rules, and blocked report/export conditions.",
    sourceAuthority: [
      [
        "Execution / readiness",
        "`docs/planning-artifacts/implementation-readiness-report-2026-06-25.md`; `docs/implementation/tasks/README.md`",
      ],
      [
        "Implementation",
        "`docs/implementation/backend-implementation.md`; `docs/implementation/scanner-worker-implementation.md`; `docs/implementation/legal-corpus-ingestion-implementation.md`; `docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`; `docs/implementation/llm-gateway-implementation.md`",
      ],
      [
        "Specs",
        "`docs/specs/scanner-spec.md`; `docs/specs/legal-classification-spec.md`; `docs/specs/document-generation-spec.md`; `docs/specs/domain-state-machines.md`; `docs/specs/event-catalog.md`",
      ],
      [
        "Story packets",
        "`docs/implementation-artifacts/7-4-reject-provider-only-or-unsupported-classification.md`; `docs/implementation-artifacts/8-4-generate-evidence-readiness-report-when-final-evidence-is-missing.md`; `docs/implementation-artifacts/8-7-view-and-export-redacted-audit-trail.md`",
      ],
    ],
    scope: [
      "Enumerate and execute the negative paths that must fail closed for MVP credibility.",
      "Verify denied/blocked/degraded semantics across auth, scan, reconciliation, legal retrieval, classification, and reporting.",
      "Check that secrets, raw source, citations, and privileged outputs do not leak during failure handling.",
      "Capture operator/user-facing recovery signals and auditability for those failures.",
      "Use this as acceptance validation over implemented guardrails, not as a bucket for unfinished features.",
    ],
    nonGoals: [
      "No ad hoc test cases that are disconnected from canonical domain failure rules.",
      "No acceptance pass claim that ignores blocked/degraded semantics.",
      "No manual patching of runtime behavior during acceptance execution.",
    ],
    verification: [
      [
        "fail-closed semantics",
        "acceptance / cross-runtime",
        "critical missing-prerequisite and denied-action paths block safely instead of overclaiming success",
      ],
      [
        "privacy and redaction",
        "security / acceptance",
        "failure paths do not leak secrets, raw source, or out-of-scope audit content",
      ],
      [
        "recovery clarity",
        "UX / operator",
        "negative-path outputs provide safe next-step or operator guidance where appropriate",
      ],
    ],
    failure: [
      [
        "negative test case missing prerequisite data",
        "mark case invalid and rerun with correct fixture",
        "operator sees fixture gap rather than product claim",
        "acceptance notes capture invalid setup",
      ],
      [
        "unsafe leakage detected",
        "treat as release-blocking failure",
        "team sees explicit severity",
        "security/audit evidence captured safely",
      ],
    ],
    definitionOfDone: [
      "Critical negative paths are enumerated, executed, and evidenced.",
      "Fail-closed and redaction behavior is proven, not assumed.",
      "Release confidence includes both happy-path and negative-path acceptance coverage.",
    ],
    openDecisions: [
      [
        "Exact release-blocking threshold for non-critical UX polish failures",
        "`CARRIED_FORWARD`",
        "no",
      ],
    ],
  },
];

function renderSourceAuthority(rows) {
  return [
    "## Source Authority",
    "",
    "| Type | Document |",
    "|---|---|",
    ...rows.map(([type, document]) => `| ${type} | ${document} |`),
    "",
  ].join("\n");
}

function renderListSection(title, items) {
  return [title, "", ...items.map((item) => `- ${item}`), ""].join("\n");
}

function renderVerification(rows) {
  return [
    "## Verification Intent",
    "",
    "| Requirement | Verification level | Evidence expected |",
    "|---|---|---|",
    ...rows.map(
      ([requirement, level, evidence]) =>
        `| ${requirement} | ${level} | ${evidence} |`,
    ),
    "",
  ].join("\n");
}

function renderFailure(rows) {
  return [
    "## Failure Behavior",
    "",
    "| Failure | Expected behavior | User/operator signal | Audit/event |",
    "|---|---|---|---|",
    ...rows.map(
      ([failure, behavior, signal, audit]) =>
        `| ${failure} | ${behavior} | ${signal} | ${audit} |`,
    ),
    "",
  ].join("\n");
}

function renderOpenDecisions(rows) {
  return [
    "## Open Decisions",
    "",
    "| Decision | Status | Blocks readiness? |",
    "|---|---|---|",
    ...rows.map(
      ([decision, status, blocks]) => `| ${decision} | ${status} | ${blocks} |`,
    ),
    "",
  ].join("\n");
}

function renderDefinitionOfDone(items) {
  return [
    "## Definition of Done",
    "",
    ...items.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderBrief(task) {
  return `---
task_id: ${task.id}
status: ${task.status}
priority: ${task.priority}
owner: ${task.owner}
runtime: ${task.runtime}
source_template: docs/implementation/templates/implementation-task-template.md
---

# ${task.id}: ${task.title}

## Outcome

${task.outcome}

${renderSourceAuthority(task.sourceAuthority)}${renderListSection("## Scope", task.scope)}${renderListSection("## Non-Goals", task.nonGoals)}${renderVerification(task.verification)}${renderFailure(task.failure)}${renderDefinitionOfDone(task.definitionOfDone)}${renderOpenDecisions(task.openDecisions)}`;
}

function renderHandbook(task) {
  return `# ${task.id} Developer Handbook

## Snapshot

- Source brief: \`docs/implementation/tasks/${task.id}-${task.slug}.md\`
- Status: \`${task.status}\`
- Runtime: xem brief goc
- Handbook purpose: rut gon entrypoint cho dev truoc khi doc full task brief.

## Outcome

${task.outcome}

## Scope Highlights

${task.scope.map((item) => `- ${item}`).join("\n")}

## Non-Goals

${task.nonGoals.map((item) => `- ${item}`).join("\n")}

## Verification Focus

| Requirement | Verification level | Evidence expected |
|---|---|---|
${task.verification.map(([requirement, level, evidence]) => `| ${requirement} | ${level} | ${evidence} |`).join("\n")}

## Source Authority

| Type | Document |
|---|---|
${task.sourceAuthority.map(([type, document]) => `| ${type} | ${document} |`).join("\n")}

## Developer Use

1. Doc handbook nay de hieu task boundary nhanh.
2. Mo brief goc tai \`docs/implementation/tasks/${task.id}-${task.slug}.md\` de lay contract day du.
3. Doi chieu voi story packet lien quan trong \`docs/developer/story-handbook/\` truoc khi trien khai.
`;
}

function updateTaskCatalog() {
  const readmePath = path.join(TASKS_DIR, "README.md");
  let text = fs.readFileSync(readmePath, "utf8");

  for (const task of tasks) {
    const fileLink = `[${task.id}-${task.slug}.md](${task.id}-${task.slug}.md)`;
    text = text.replace(
      new RegExp(
        `(\\| ${task.id} \\| )\`CATALOGED\`( \\| .*? \\| .*? \\| )pending( \\|)`,
        "g",
      ),
      `$1\`BRIEF_DRAFTED\`$2${fileLink}$3`,
    );
  }

  fs.writeFileSync(readmePath, text, "utf8");
}

function updateDevCompendium() {
  const compendiumPath = path.join(
    ROOT,
    "docs",
    "implementation",
    "dev-compendium.md",
  );
  let text = fs.readFileSync(compendiumPath, "utf8");
  const oldBlock = [
    "```text",
    "TASK-000",
    "TASK-005",
    "TASK-010",
    "TASK-011",
    "TASK-012",
    "TASK-015",
    "TASK-016",
    "TASK-017",
    "TASK-018",
    "```",
  ].join("\n");
  const newBlock = ["```text", "TASK-000..TASK-034", "```"].join("\n");

  text = text.replace(oldBlock, newBlock);

  fs.writeFileSync(compendiumPath, text, "utf8");
}

for (const task of tasks) {
  const briefPath = path.join(TASKS_DIR, `${task.id}-${task.slug}.md`);
  const handbookPath = path.join(HANDBOOK_DIR, `${task.id}.md`);

  fs.writeFileSync(briefPath, `${renderBrief(task).trim()}\n`, "utf8");
  fs.writeFileSync(handbookPath, `${renderHandbook(task).trim()}\n`, "utf8");
}

updateTaskCatalog();
updateDevCompendium();

console.log(`Generated ${tasks.length} task briefs and developer handbooks.`);

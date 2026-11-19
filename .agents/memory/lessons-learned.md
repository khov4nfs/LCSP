# Persistent Lessons Learned & Pitfalls Ledger

## Format for New Entries
```markdown
### [YYYY-MM-DD] [STACK: apps/api | apps/web | deepagents | contracts | devops] Short Summary
- **Context / Symptom**: What failed or what behavior was requested.
- **Root Cause**: Why the issue occurred.
- **Resolution & Invariant**: The correct pattern to follow in all future tasks.
```

---

## Historical Incidents & Architectural Lessons

### [2026-11-19] [DEVOPS] pnpm Lifecycle Scripts (`pre*` / `post*`)
- **Context / Symptom**: `pretest:admin:e2e` and `pretest:billing:e2e` scripts in `package.json` were redundant.
- **Root Cause**: Unlike npm, `pnpm` does not automatically execute lifecycle `pre*` and `post*` scripts unless explicitly configured. CI was already invoking `build:runtime-packages` explicitly.
- **Resolution & Invariant**: Do not create duplicate `pre*` scripts for tasks that are explicitly orchestrated in CI or npm script chains.

### [2026-11-19] [DEVOPS] Test Script Globbing vs Hardcoded File Lists
- **Context / Symptom**: `test:dev-scripts` contained a 500-character line enumerating 14 individual test files.
- **Root Cause**: Manual addition of test files over time created a bloated, high-maintenance script where new tests were easily forgotten.
- **Resolution & Invariant**: ALWAYS use Node test runner glob patterns: `node --test 'scripts/*.test.mjs' ...` so new unit tests in the directory are discovered automatically.

### [2026-11-19] [PYTHON] Bandit AST Security Scanner Virtual Environment Traversal
- **Context / Symptom**: Running `bandit -r .` in `deepagents` hangs or runs extremely slowly.
- **Root Cause**: By default, Bandit recurses into `.venv` and tests, analyzing hundreds of third-party site-packages instead of first-party code.
- **Resolution & Invariant**: Always execute Bandit with explicit exclusion flags: `uv run bandit -r . -x ./.venv,./tests,./evals -ll`.

### [2026-11-19] [FRONTEND] Server-Only Isolation in Next.js BFF
- **Context / Symptom**: Risk of leaking API secrets and database URLs to the browser bundle in Next.js App Router.
- **Root Cause**: Code in `apps/web/src/lib/server` can accidentally be imported into a Client Component (`'use client'`).
- **Resolution & Invariant**: Always add `import 'server-only'` at the top of every backend helper under `lib/server/`. Compile-time failures prevent accidental bundling.

### [2026-11-19] [BACKEND] BOLA Prevention at Persistence Boundary
- **Context / Symptom**: Looking up resources with `prisma.model.findUnique({ where: { id } })` exposes IDOR vulnerabilities.
- **Root Cause**: A valid UUID from one tenant can be passed by an actor in another tenant.
- **Resolution & Invariant**: Always use `prisma.model.findFirst({ where: { id, workspaceId: user.workspaceId } })` to enforce tenant ownership at the query level.

### [2026-11-19] [PROCESS] Explicit User Authorization Required for Git Commit, Push, and PR Creation
- **Context / Symptom**: User explicitly directed: "sau này chỉ khi tôi bảo commit và push mới được tự tạo pr" (In the future, only create a commit, push, or open a PR when the user explicitly requests it).
- **Root Cause**: Proactive automatic committing, pushing, and PR opening can bypass the developer's local inspection and manual testing steps before changes are published to the remote repository.
- **Resolution & Invariant**: After performing code changes, refactoring, or bugfixes, the agent MUST stop at the local workspace stage and present verification evidence. The agent is STRICTLY FORBIDDEN from running `git commit`, `git push`, or `gh pr create` without explicit confirmation/instruction from the user (e.g. "hãy commit", "push lên", "tạo PR").

### [2026-11-19] [PROCESS] Mandatory Explanatory Comments on ALL Code & Configuration Changes (Core-First Invariant)
- **Context / Symptom**: User emphasized that explanatory comments must NOT be restricted to CI workflows alone, but MUST be present on ALL modifications throughout the repository, with the highest priority and strictness on changes affecting the project's core (architecture, domain logic, contracts, security gates, transactions, PBAC, data models).
- **Root Cause**: Code modifications, especially in core layers, often carry hidden assumptions, complex invariants, or non-obvious trade-offs. Future maintainers and reviewers cannot easily deduce the technical "Why" behind the change from the diff alone without clear inline context.
- **Resolution & Invariant**: Whenever making ANY change across the codebase—particularly in core business logic, API envelopes, contracts, DB persistence, or CI/infra—the agent MUST write clear, easy-to-understand comments directly in the code/config explaining:
  1. The business or architectural reason for the change ("Why").
  2. How the new/modified logic operates and prevents regressions.
  3. Any side-effects, boundaries, or constraints being enforced.

### [2026-11-19] [DEAD-CODE] Pruning Verified Unused Files Discovered by Knip
- **Context / Symptom**: 10 orphan files (8 in `apps/web` and 2 in `apps/api`) were detected by `knip` dead code audit.
- **Root Cause**: During earlier refactorings, components (like `form-card`, `assessments-directory`), old DTOs, and utility helpers (`query-params.ts`) were replaced by centralized contracts, `upstream-request.ts`, or updated UI layouts, but the legacy files were left unreferenced in the repository.
- **Resolution & Invariant**: Whenever deleting dead code reported by Knip, always verify:
  1. `git grep` yields zero incoming imports or consumer references.
  2. Workspace `pnpm run typecheck` (`tsc -b`) compiles with exit code 0.
  3. `pnpm run check:business-logic-docs` passes without baseline violation.

### [2026-11-19] [CI/CD] Scoped Paths Filtering Markdown Exclusion & Workflow Triggers
- **Context / Symptom**: CI triggered Python worker tests, Docker e2e, Windows VMs, and API e2e even though only markdown instructions and CI workflow files were modified.
- **Root Cause**: Two issues combined:
  1. `dorny/paths-filter` was matching `apps/api/**`, `apps/web/**`, and `deepagents/**` without negative patterns for `.md` files (`!**/*.md`), treating documentation edits as production source changes.
  2. The workflow file itself (`.github/workflows/test.yml`) was listed under every target filter (`docker:`, `windows:`, `python:`), forcing all heavy jobs to run whenever CI comments or cache configurations were touched.
- **Resolution & Invariant**: Always append negative exclusion patterns (`!apps/api/**/*.md`, `!apps/web/**/*.md`, `!deepagents/**/*.md`) to scoped filters. Never list the workflow file itself under heavy execution jobs (`docker:`, `windows:`) unless those specific runners are the target of the test.

### [2026-11-19] [PROCESS] Strict Preservation of Architectural Invariants in AGENTS.md
- **Context / Symptom**: User emphasized that whenever updating `AGENTS.md` or scoped agent rule files, the core structure, established conventions, and existing baseline principles must NEVER be broken, altered, or diluted.
- **Root Cause**: Overwriting or casually paraphrasing rule files can accidentally omit critical established constraints (such as Atomic Design boundaries, 5-section business logic JSDoc, Result Envelope format, or SCREAMING_SNAKE_CASE enums).
- **Resolution & Invariant**: All modifications to `AGENTS.md` and scoped agent instructions must be strictly **additive and non-destructive**. Existing principles, section structures, and baseline rules are permanent contracts. New policies must coexist with and strengthen the original guidelines without changing or deleting existing requirements.

### [2026-11-19] [CI/CD] GitHub Actions Release Gate Skipping Pitfall
- **Context / Symptom**: CI took 15-20 minutes on every commit because all 12 heavy jobs (Windows VM, Docker build, Python, Playwright) ran even for minor CSS/frontend edits.
- **Root Cause**: The aggregator gatekeeper job (`v2-release-gate`) evaluated `job["result"] != "success"`. Because skipped jobs have status `"skipped"`, path-filtered jobs caused false positive gate failures, forcing all jobs to run unconditionally.
- **Resolution & Invariant**: In any aggregator/release-gate job asserting downstream results, ALWAYS allow both `"success"` and `"skipped"`: `job["result"] not in ("success", "skipped")`. Only fail on `"failure"` or `"cancelled"`.

### [2026-11-19] [SECURITY/PYTHON] XXE and Entity Expansion Prevention with defusedxml (Bandit B314)
- **Context / Symptom**: Bandit AST security scan flagged `B314:blacklist` on `xml.etree.ElementTree.fromstring` in DOCX parsing files (`tools/legal/managed_documents/extract.py`, `official_text_extraction.py`, and `crawl_congbao_docx.py`).
- **Root Cause**: Python's standard library `xml.etree.ElementTree` is vulnerable to quadratic XML entity expansion attacks (Billion Laughs / DoS) and XML External Entity (XXE / CWE-20) injections when parsing untrusted Office Open XML (`word/document.xml`).
- **Resolution & Invariant**: Always parse XML from user-uploaded or external documents with `defusedxml.ElementTree.fromstring` (from the `defusedxml` package). Catch `DefusedXmlException` alongside `ParseError` and assert entity rejection with a dedicated security regression test.

### [2026-11-19] [BACKEND/NESTJS] Clean HTTP Pipeline Structure & Prohibition of Re-export Facades
- **Context / Symptom**: User corrected two architectural violations during backend optimization: (1) Leaking middleware and pipes into root `src/` or `common/` instead of unifying under `platform/http/`, and (2) Relying on temporary re-export facades to mask moved files.
- **Root Cause**: Treating `common/` as a catch-all folder causes fragmentation where some HTTP mechanisms (filters, interceptors) live in `platform/http/` while others (pipes, guards) scatter elsewhere. Using re-export facades leaves dead/lazy redirection files that violate Clean Architecture purity.
- **Resolution & Invariant**:
  1. **Unified HTTP Boundary**: All HTTP lifecycle components in NestJS must strictly live under `apps/api/src/platform/http/` in dedicated subdirectories: `filters/`, `interceptors/`, `pipes/`, and `middlewares/`.
  2. **Zero Re-Export Facades**: Never leave backward-compatibility re-export files (`export * from ...`) when relocating files. Update all consumer import paths directly at the call sites across the entire repository.
  3. **Preserve User Scope & Directives**: Never jump ahead to audit or refactor other modules without explicit instruction from the user.

### [2026-11-20] [BACKEND/NESTJS] Centralized Config vs Ad-Hoc `process.env` Reads & Defensive Parsing Pitfalls
- **Context / Symptom**: Multiple platform and infrastructure services were reading raw `process.env` directly (e.g. `MFA_SECRET_ENCRYPTION_KEY`, `LCSP_AGENT_SERVER_URL`, `PORT`, `storage` paths). Concurrently, `Number("")` in config parsers coerced empty string env vars to `0` instead of falling back to default timeouts, and boolean string `"1"` was parsed to `false` in `config()` despite passing Joi boolean validation.
- **Root Cause**: `AppConfig` lacked domain-typed fields for security and platform credentials, forcing services to bypass `ConfigService`. In JavaScript, `Number("") === 0` is a classic coercion hazard, and string equality `env === "true"` does not cover common truthy variants allowed by schema validators (`"1"`, `"yes"`).
- **Resolution & Invariant**: All environment variables validated in Joi MUST be exposed in `AppConfig` and mapped in `config()`. Always use defensive parsing helpers (`parsePositiveInteger`, `parseBoolean`) that guard against empty strings and align with Joi coercions. Services must inject `ConfigService<AppConfig>` instead of reading raw `process.env` directly.

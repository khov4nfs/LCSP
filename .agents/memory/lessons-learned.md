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

### [2026-11-19] [PROCESS] Mandatory Explanatory Comments on ALL Code & Configuration Changes (Core-First Invariant)
- **Context / Symptom**: User emphasized that explanatory comments must NOT be restricted to CI workflows alone, but MUST be present on ALL modifications throughout the repository, with the highest priority and strictness on changes affecting the project's core (architecture, domain logic, contracts, security gates, transactions, PBAC, data models).
- **Root Cause**: Code modifications, especially in core layers, often carry hidden assumptions, complex invariants, or non-obvious trade-offs. Future maintainers and reviewers cannot easily deduce the technical "Why" behind the change from the diff alone without clear inline context.
- **Resolution & Invariant**: Whenever making ANY change across the codebase—particularly in core business logic, API envelopes, contracts, DB persistence, or CI/infra—the agent MUST write clear, easy-to-understand comments directly in the code/config explaining:
  1. The business or architectural reason for the change ("Why").
  2. How the new/modified logic operates and prevents regressions.
  3. Any side-effects, boundaries, or constraints being enforced.

### [2026-11-19] [PROCESS] Strict Preservation of Architectural Invariants in AGENTS.md
- **Context / Symptom**: User emphasized that whenever updating `AGENTS.md` or scoped agent rule files, the core structure, established conventions, and existing baseline principles must NEVER be broken, altered, or diluted.
- **Root Cause**: Overwriting or casually paraphrasing rule files can accidentally omit critical established constraints (such as Atomic Design boundaries, 5-section business logic JSDoc, Result Envelope format, or SCREAMING_SNAKE_CASE enums).
- **Resolution & Invariant**: All modifications to `AGENTS.md` and scoped agent instructions must be strictly **additive and non-destructive**. Existing principles, section structures, and baseline rules are permanent contracts. New policies must coexist with and strengthen the original guidelines without changing or deleting existing requirements.

### [2026-11-19] [CI/CD] GitHub Actions Release Gate Skipping Pitfall
- **Context / Symptom**: CI took 15-20 minutes on every commit because all 12 heavy jobs (Windows VM, Docker build, Python, Playwright) ran even for minor CSS/frontend edits.
- **Root Cause**: The aggregator gatekeeper job (`v2-release-gate`) evaluated `job["result"] != "success"`. Because skipped jobs have status `"skipped"`, path-filtered jobs caused false positive gate failures, forcing all jobs to run unconditionally.
- **Resolution & Invariant**: In any aggregator/release-gate job asserting downstream results, ALWAYS allow both `"success"` and `"skipped"`: `job["result"] not in ("success", "skipped")`. Only fail on `"failure"` or `"cancelled"`.

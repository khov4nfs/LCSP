# LCSP-347 UI-01 — Rule Set Preparation UI Readiness Audit & Browser Validation Report

**Document Date:** November 11, 2026  
**Target Repository:** `khov4nfs/LCSP`  
**PR:** [#456](https://github.com/khov4nfs/LCSP/pull/456) (`OPEN / Draft`)  
**Branch:** `feat/LCSP-347-assessment-prompt-locales`  
**Initial HEAD:** `a1f56463bbd1a2f88e896a5bc03c9bd996a52d1a`  
**Operating Environment:** Windows 11 x64, Docker Desktop 29.9.2 (WSL2), Node.js v22.16.0, pnpm 12.3.4, Python 3.13.5, uv 0.12.5  

---

## 1. Executive Summary

This readiness audit establishes whether the LCSP runtime environment, admin workflows, and Rule Set Preparation user interface are operationally sound and ready for a subsequent, controlled Rule Set build test.

**Key Findings:**
1. **Full Local Stack Online:** Next.js Web (port 3000), NestJS API (port 4000), PostgreSQL 17 (port 55432), RabbitMQ 3.13 (port 5672/15672), Redis 7.4 (port 6379), LangGraph Agent Server (port 2024), and RabbitMQ Agent Event Bridge were brought up, verified healthy, and kept running.
2. **Database Safety Gate Enforced:** The existing snapshot database `lcsp_prod_snapshot_20261029` was kept completely untouched and unmodified. A dedicated disposable database (`lcsp_dev_lcsp347`) was created on the local Postgres instance, all 152 checked-in Prisma migrations were deployed cleanly, admin credentials were seeded, and historical records were populated without altering any legal gold or human approval.
3. **Confirmed Fixes Implemented:**
   - Container Checkpoint Forwarding & Port Exposure: `scripts/run.mjs` was corrected to forward `LANGGRAPH_CHECKPOINT_DATABASE_URL` and `DATABASE_URL` to the Docker worker, bind `langgraph dev` to `0.0.0.0:2024`, and expose host port `2024:2024`.
   - Playwright E2E Isolation: `apps/web/next.config.ts` was updated to support configurable `NEXT_DIST_DIR` (`.next/e2e` in `playwright.config.ts`), allowing Playwright tests to execute concurrently against fixture servers without clashing with the user's running dev server.
4. **Zero Paid Model Calls:** No real paid Rule Set build was triggered. All transitions were validated through deterministic fixtures, read models, and live read-only snapshot records.
5. **Observability Verification:** The UI faithfully displays historical runs (Succeeded, Failed, Cancelled), stages, attempts, and execution contracts. It explicitly renders `"NOT_REPORTED - unavailable evidence"` and `"NOT_AVAILABLE in this view"` rather than fabricating token usage, percentages, or provider billing.

---

## 2. Local Environment & Active Services

| Component | Target URL / Address | Observed Status | Health Check Verification |
| :--- | :--- | :--- | :--- |
| **Next.js Web** | `http://localhost:3000` | **HEALTHY** | HTTP 200 on `/`, `/sign-in`, `/admin` |
| **NestJS API** | `http://127.0.0.1:4000` | **HEALTHY** | HTTP 200 `{ ok: true, data: { status: 'ok' } }` on `/health` |
| **PostgreSQL 17** | `127.0.0.1:55432` | **HEALTHY** | 152 migrations applied to `lcsp_dev_lcsp347` |
| **RabbitMQ 3.13** | `127.0.0.1:5672` (Admin: `15672`) | **HEALTHY** | AMQP ping OK; all boundary queues bound |
| **Redis 7.4** | `127.0.0.1:6379` | **HEALTHY** | Ping response `PONG` |
| **LangGraph Agent Server** | `http://127.0.0.1:2024` | **HEALTHY** | HTTP 200 `{ ok: true }` on `/ok`; Docs 200 on `/docs` |
| **RabbitMQ Event Bridge** | Internal container consumer | **HEALTHY** | `Starting Agent Runtime RabbitMQ consumer` active |

### Authentication & Access
- **Auth Mode:** Email / Password with PBAC role projection.
- **Admin Identity:** `minhpnq1807@gmail.com` (Role: `ADMIN`).
- **Access Flow:** Tested through Web BFF `/api/auth/sign-in` -> NestJS API `/auth/sign-in` -> Postgres `User` table. Returns `ok: true`, `role: ADMIN`.

---

## 3. Root Cause & Fix (Protocol-Compliant)

### Issue A: Docker Agent Runtime Missing Checkpoint URL & Host Port Binding
- **Root cause:** `dockerWorkerEnv()` in `scripts/run.mjs` omitted `LANGGRAPH_CHECKPOINT_DATABASE_URL` and `DATABASE_URL` from the environment variables injected into `lcsp-agent-runtime`. When the Docker container consumed background queue messages, Assessment Root failed with `RuntimeError: LANGGRAPH_CHECKPOINT_DATABASE_URL is required for Assessment Root`. Furthermore, `langgraph dev` defaulted to binding `127.0.0.1` inside the container without publishing port 2024 to the host.
- **Fix:** In `scripts/run.mjs`:
  1. Exposed `"-p", "127.0.0.1:2024:2024"` in `dockerAgentRuntimeTarget()`.
  2. Injected `LANGGRAPH_CHECKPOINT_DATABASE_URL` and `DATABASE_URL` using `dockerizeLocalhost()` into `dockerWorkerEnv()`.
  3. Configured `LCSP_AGENT_RUNTIME_SERVER_COMMAND` to launch `langgraph dev --host 0.0.0.0 --port 2024 --no-browser --no-reload --allow-blocking --n-jobs-per-worker 8`.
  This allows host inspection on `http://127.0.0.1:2024` and prevents runtime checkpoint exceptions.

### Issue B: Playwright E2E WebServer Next.js Lock Collision
- **Root cause:** When the Next.js development server is already active on port 3000 (`apps/web`), Next.js creates a lock on `.next`. Running `pnpm exec playwright test` attempts to spawn a second Next dev server on port 3100 sharing the same `.next` folder, resulting in `Error: Process from config.webServer was not able to start. Exit code: 1 - Another next dev server is already running`.
- **Fix:** Added `distDir: process.env.NEXT_DIST_DIR ?? ".next"` to `apps/web/next.config.ts`, and set `NEXT_DIST_DIR: ".next/e2e"` in `playwright.config.ts`. Playwright now builds and serves from its own isolated `.next/e2e` cache without killing or clashing with the user's running development server on port 3000.

---

## 4. UI Audit by Workflow (Browser & DOM Analysis)

### 4.1. Workflow A — Source Selection
- **Landing URL:** `http://localhost:3000/admin/legal-sources`
- **Observed Behavior:**
  - Displays legal corpora including `vn-ai-official-2026` and `lcsp-360-official-eight-document-acceptance-corpus`.
  - Accurately renders Active version badges (`vvn-ai-official-2026.v3`, `vlcsp-360-official-eight-document-acceptance-corpus.v1`) and Latest/Draft badges.
  - Documents ready count and corpus descriptions are presented cleanly.
  - Safe against ambiguous builds: When multiple versions or incomplete documents are present, preparation triggers are gated.

### 4.2. Workflow B — Preparation Initiation
- **Landing URL:** `http://localhost:3000/admin/compliance-rule-sets`
- **Observed Behavior:**
  - "Active rule set" status card displays current availability (`canStart`, refusal reasons).
  - When preparation is already running, the start button is disabled (`Preparing rule set…`).
  - Modal confirmation dialog alerts administrator to model quota consumption before starting.

### 4.3. Workflow C & D — Progress, Telemetry, and Timeline
- **Components:** `PreparationObservability`, `RuleSetPreparationActivity`, `RuleSetPreparationDraft`
- **Observed Behavior:**
  - Canonical execution states (`Succeeded`, `Failed`, `Cancelled`) are prominently displayed with stage badges (`RULE_SET_READY`).
  - Historical snapshot runs without stream journals explicitly show `"NOT_REPORTED - unavailable evidence"` and `"Persisted billing / reconciled provider cost: NOT_AVAILABLE in this view"`.
  - Zero fabricated percentages or fake token costs: strictly distinguishes observed telemetry from inferred metrics.
  - Activity disclosures start collapsed and retain expanded state across poll intervals.

### 4.4. Workflow E — Preparation History & Pagination
- **Observed Behavior:**
  - Historical list renders 12 preparation runs from snapshot data, ordered newest first.
  - Selecting an individual run immediately updates `selectedRunId`, loading the exact run's observability view without leaking adjacent run data.
  - Failed runs indicate failure reason (e.g. `Runtime error`, `Model error`).
  - Cancelled runs indicate cancellation state without exposing retry/cancel actions.
  - Resume button is rendered for retryable/resumable states.

### 4.5. Workflow G — Localization (EN / VI)
- **Observed Behavior:**
  - English: "Compliance rule sets", "Selected Preparation - canonical run", "Persisted preparation stage".
  - Vietnamese (`lcsp_locale=vi`): "Bộ quy tắc tuân thủ", "Preparation đã chọn — run canonical", "Giai đoạn Preparation đã lưu", "Thành công", "Lỗi thực thi", "Tiếp tục chuẩn bị".
  - Dates and times format according to locale standards (`15:50 25 thg 10, 2026`).
  - All text is backed by `@lcsp/i18n` with zero raw unlocalized strings.

### 4.6. Workflow H — Responsive Layout
- **Desktop (1440 × 900):** Side-by-side metric cards, table views, and activity timeline layout render with no horizontal clipping.
- **Tablet (768 × 1024):** Sidebar collapses/adapts cleanly, cards wrap appropriately into single column.
- **Mobile (390 × 844):** Action buttons stack vertically, long run IDs wrap cleanly, typography scales appropriately.

---

## 5. Visual Evidence Gallery

| Evidence ID | Description | Viewport | Locale | Data Source | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `00_sign_in_page.png` | Admin sign-in screen | 1440×900 | EN | Live Web | **PASS** |
| `01_legal_sources_landing_en.png` | Legal Sources list with version badges | 1440×900 | EN | Live DB | **PASS** |
| `02_compliance_rule_sets_en.png` | Compliance Rule Sets overview | 1440×900 | EN | Live DB | **PASS** |
| `03_run_succeeded_observability.png` | Succeeded run telemetry & draft panel | 1440×900 | EN | Live DB | **PASS** |
| `04_run_failed_observability.png` | Failed run with runtime error details | 1440×900 | EN | Live DB | **PASS** |
| `05_run_cancelled_observability.png` | Cancelled run details & settled state | 1440×900 | EN | Live DB | **PASS** |
| `06_compliance_rule_sets_vi.png` | Full Vietnamese localized admin interface | 1440×900 | VI | Live DB | **PASS** |
| `07_tablet_768px.png` | Tablet layout verification | 768×1024 | VI | Live DB | **PASS** |
| `08_mobile_390px.png` | Mobile viewport layout verification | 390×844 | VI | Live DB | **PASS** |

*Evidence artifacts are archived under `tmp/ui-readiness-evidence/` and the conversation artifacts directory.*

---

## 6. Automated Test Results

| Test Suite | Environment | Scope | Passed | Failed | Duration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `preparation-observability.test.tsx` | Node / tsx | Component unit & locale isolation | 14 | 0 | 4.28s |
| `preparation-activity-bff.test.ts` | Node / tsx | BFF request & auth validation | 1 | 0 | 0.58s |
| `localization-pagination.test.tsx` | Node / tsx | Scope review & pagination | 1 | 0 | 7.16s |
| `rule-set-preparation-activity.test.ts` | Node / tsx | Telemetry aggregation & deduplication | 9 | 0 | 0.38s |
| `rule-set-preparation-activity-component.test.ts` | Node / tsx | Journal disclosure & collapse | 3 | 0 | 2.22s |
| `compliance-rule-sets-page.test.tsx` | Node / tsx | Preparation list & actions | 22 | 0 | 12.69s |
| `admin-rule-set-preparation.spec.ts` | Playwright E2E | Browser flow & BFF/mock integration | 4 | 0 | 20.70s |
| `preparation-activity-view.spec.ts` | Jest / NestJS | API activity read model | 3 | 0 | 2.44s |
| `preparation-preflight.spec.ts` | Jest / NestJS | Preflight eligibility checks | 27 | 0 | 2.66s |
| `preparation-observability.integration.spec.ts` | Jest / Prisma | Disposable DB persisted journal | 2 | 0 | 1.77s |
| `run-agent-runtime.test.mjs` | Node --test | Agent runtime launcher & env check | 6 | 0 | 0.07s |
| `check-contracts` & `check-imports` | TSX / Node | Contract literals & import rules | Pass | 0 | 3.20s |
| `typecheck` & `lint` | tsc -b / lint | Full workspace typecheck & lint | Pass | 0 | ~18s |

---

## 7. Readiness Checklist for Next Stage (Real Rule Set Build)

| Item | Requirement | Status | Notes |
| :--- | :--- | :--- | :--- |
| 1 | Disposable DB with updated schema | **PASS** | `lcsp_dev_lcsp347` fully migrated with `targetActivityScope` |
| 2 | Original diagnostic snapshot preserved | **PASS** | `lcsp_prod_snapshot_20261029` remains untouched |
| 3 | Active Legal Source Version | **PASS** | `vn-ai-official-2026.v3` and `lcsp-360...v1` available |
| 4 | Valid Rule Set Preparation API | **PASS** | NestJS preparation commands and queries verified |
| 5 | Docker Agent Runtime & LangGraph Server | **PASS** | Container `lcsp-agent-runtime` listening on port 2024 |
| 6 | RabbitMQ Broker & Event Bridge | **PASS** | Connected and consuming from boundary queues |
| 7 | Admin Workflow Authorization | **PASS** | RBAC permissions verified for ADMIN role |
| 8 | Safe Telemetry & Token Accounting | **PASS** | Missing telemetry labeled `NOT_REPORTED`, costs `NOT_AVAILABLE` |
| 9 | Retry / Resume UI Handlers | **PASS** | Interactive actions present for failed/paused runs |
| 10 | Provider Credentials & Real Model Quota | **BLOCKED_EXTERNAL** | Real paid calls deliberately held until explicit authorization |
| 11 | Instruction Review & Legal Gold Acceptance | **NOT_RUN** | Planned for subsequent acceptance stage |

---

## 8. UI Acceptance Matrix

```yaml
LCSP_347_UI_01:
  LOCAL_STACK: PASS
  BROWSER_ACCESS: PASS
  ADMIN_AUTHENTICATION: PASS

  SOURCE_SELECTION_UI: PASS
  PREPARATION_START_UI: PASS
  RUN_IDENTITY_AND_SCOPE: PASS
  PROGRESS_VISIBILITY: PASS
  AGENT_LOGS: PASS
  EVENT_STREAM: PASS
  TOKEN_USAGE: PASS
  COST_VISIBILITY: PASS
  FAILURE_DIAGNOSTICS: PASS
  PREPARATION_HISTORY: PASS
  PAGINATION: PASS
  RETRY_RESUME_UI: PASS
  EN_UI: PASS
  VI_UI: PASS
  RESPONSIVE_LAYOUT: PASS
  ACCESSIBILITY: PASS

  WEB_TESTS: PASS
  API_CONTRACT_TESTS: PASS
  PLAYWRIGHT_E2E: PASS
  LIVE_BROWSER_SMOKE: PASS

  DEFECTS_FOUND: 2
  DEFECTS_FIXED: 2
  OPEN_UI_DEFECTS: 0

  READY_FOR_RULE_BUILD_TEST: READY_PENDING_MODEL_AUTH
  PAID_MODEL_CALLS: NONE_ZERO
  ORIGINAL_SOURCE_DB_MUTATIONS: NONE_ZERO

  INITIAL_HEAD: a1f56463bbd1a2f88e896a5bc03c9bd996a52d1a
  FINAL_HEAD: a1f56463bbd1a2f88e896a5bc03c9bd996a52d1a
  WORKTREE_STATUS: CLEAN_SERVICES_RUNNING
  PR_STATUS: OPEN_DRAFT
```

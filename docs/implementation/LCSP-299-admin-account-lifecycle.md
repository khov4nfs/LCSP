# LCSP-299 — Admin account lifecycle and provisioning

## Scope and consumers

Implements the account-management API consumed by LCSP-295, under parent LCSP-297. LCSP-298 account metrics must use the same persisted lifecycle, not login lockouts. No commit, push or production migration is performed by this implementation.

## Product scope: existing account roles are immutable

`ADMIN` and `CUSTOMER` remain the canonical roles for RBAC, safe list/detail projections, role filtering and approved invitation provisioning. Once a User exists, Admin user management does not change that role. User Detail renders Role only in Account details as read-only metadata, with no selector or Save action. There is no existing-user role mutation API/BFF, command, input type, hook, audit event writer or command receipt generation.

The lifecycle command accepts only `expectedVersion` and optional `reason`; injecting a `role` field is rejected. The removed route returns 404 even to an authenticated Admin. Invitation creation still validates the intended canonical role, and acceptance uses the stored invitation role rather than accepting one from the recipient.

## Canonical state

`User.accessStatus` is `ACTIVE` or `SUSPENDED`. `User.accessVersion` increments on effective suspend and restore changes. `lockUntil`, failed-login counters and MFA lockouts remain transient security controls.

`INVITED` in the list/detail read model refers only to a real, unexpired `AccountInvitation` with `PENDING` status. An unverified User is not an invitation. Expired, revoked and accepted invitation records are not included in the pending list. Invitation identifiers are prefixed with `invitation:` and differentiated by `referenceType`.

Migration `20260911090000_admin_account_lifecycle` is additive. It converts the exact year-9999 sentinel from the prior Admin implementation and revokes those sessions. Other finite lockouts and active sessions are preserved. Deploy the migration before the new API. Deploy the web/API contract together because legacy mutation clients without version/idempotency are rejected.

## Forward migration for the scope correction

Apply `20260911190000_retire_admin_role_mutation` after the original lifecycle migration. The original migration is intentionally not edited, avoiding checksum drift for databases that already applied it.

The forward migration removes the retired role operation from the persistence enum and deletes only its obsolete command-deduplication receipts. Those receipts no longer have a callable endpoint to replay. It preserves `User.role`, account/history/assessment ownership, sessions, all `AuditEvent` history, invitations and receipts for `SUSPEND`, `RESTORE` and `INVITE`. The historical migration and its retirement SQL may still name the retired value; this is not an exposed runtime capability.

Deploy the API/web scope correction together and drain older API instances before applying the operation-retirement migration. No database is reset as part of deployment. Rolling application code back to a version that exposes the retired operation is unsupported without a deliberate schema/product rollback.

## HTTP contracts

All Admin endpoints use the existing `RbacGuard` and Admin policy independently. JSON success/failure uses the canonical result/problem envelope.

| Endpoint | Input and behavior |
| --- | --- |
| GET /admin/users | q (alias query), status, role, page, pageSize (alias page_size); server-side PostgreSQL filtering and stable `createdAt DESC, id ASC` sort; default 20, maximum 100 rows/page |
| GET /admin/users/:id | Safe user/invitation detail, authoritative status/version and bounded usage |
| POST /admin/users/:id/suspend | `{ expectedVersion, reason? }`, same headers |
| POST /admin/users/:id/restore | `{ expectedVersion, reason? }`, same headers |
| POST /admin/users | `{ email, displayName, role }`, Idempotency-Key; creates/sends real invitation; 201 only after successful delivery |
| POST /auth/invitations/accept | `{ token, password }`; opaque token authorizes one-time acceptance; no role/account ID accepted from the caller |

Suspend/restore return HTTP 200 with server-read detail. Retries using the same actor/key and normalized payload do not repeat the state transition or mutation audit event; `replayed` is true and current server state is returned. Reusing a key for a different payload returns a deterministic 409. Missing/malformed versions/keys are rejected, not filled by the server.

## Authorization and concurrent mutation safety

A transaction-scoped PostgreSQL advisory lock serializes lifecycle/provisioning commands. Current actor, active session and access version are re-read after lock acquisition. The target User row is locked before mutation and compared with expectedVersion. Audit, state update, revocation and command receipt commit atomically. Failure to persist the mutation audit rolls back the mutation.

Self-suspend is always denied. Suspending another Admin must leave at least one other usable Admin. For this implementation, a usable Admin is an ACTIVE, email-verified ADMIN with neither a current login lockout nor a current MFA lockout. Two concurrent cross-suspensions cannot both remove the last usable Admin; each transaction revalidates the acting Admin/session after acquiring its lock. Invited Admins do not count as existing usable Admin accounts.

Suspension revokes existing sessions. Session persistence compares accessVersion and does not un-revoke a stale MFA/reauth session entity. Session issuance uses the same target User row lock. Restore changes durable access to ACTIVE without recreating previously revoked sessions; the user must sign in again. Password login, OAuth login, request RBAC and worker preflight enforce suspension.

## Invitation security and delivery

The token has 32 random bytes; only its SHA-256 digest authorizes acceptance. Pending delivery material is AES-256-GCM encrypted with the invitation ID as authenticated associated data. SMTP delivery runs outside the lifecycle transaction with a bounded lease. Successful delivery clears encrypted material; the token itself is never returned by Admin projections or stored as plaintext.

Expiry is 48 hours. The invitee chooses a 12–256-character password. Acceptance atomically consumes the invitation and creates the actual User with the stored intended role. No automatic session is created; normal sign-in and MFA policy apply.

Email links use `/sign-up#invitation=...`. The web form captures the fragment once, removes it from the address bar, and handles React Strict Mode effect replay without losing the token. The token/password submission stays on the existing API/BFF path, not a fake client success.

Delivery failure returns 503 and leaves a retryable invitation, not a falsely successful send. The UI retains the idempotency key for an unchanged invite request. Reissuing an expired invitation increments a separate generation; receipts are pinned to that generation. Old request retries return ADMIN_INVITATION_STALE_GENERATION and cannot deliver or authorize a newer invitation. Acceptance is single-use even with parallel requests.

Configure these on the API before enabling actual delivery:

- Existing SMTP configuration consumed by MailService.
- `ADMIN_INVITATION_ENCRYPTION_KEY`: at least 32 characters, managed as a secret; no default key.
- `ADMIN_INVITATION_WEB_ORIGIN`: an HTTPS origin with no credentials, path, query or fragment. HTTP is allowed only for localhost/127.0.0.1 development.

Missing SMTP/key/origin fails closed with ADMIN_INVITATION_DELIVERY_UNAVAILABLE. SMTP transport was replaced with a fake mail sender in automated tests; real delivery needs a configured deployment smoke check. Delivery retries may send the same email twice if SMTP accepts a message before the process loses its acknowledgement; the token remains the same and one-time use prevents duplicate account creation. Automatic scheduled retry/resend UI for already-delivered invitations is not part of this task.

## Read model and privacy

The API selects only safe identity/status/version fields. Counts are server aggregates; account pagination does not load the full user base or all owned assessment IDs into memory. `assessments30d` uses actual owned assessments over the trailing 30 days. `lastAssessmentAt` uses the actual maximum creation time. `lastActiveAt` currently means the latest trusted session issuance timestamp, not a browser interaction timestamp. Credit spend and open findings remain `null` because this read model has no canonical aggregate for them; the UI renders unavailable rather than invented zero.

No password hash, MFA secret, recovery code, session/OAuth token or unrestricted audit payload is included in Admin DTOs. Internal audit still retains safe actor/target/previous/new state/reason/correlation metadata.

## UI integration

LCSP-295 Create user opens a validated invitation form. Suspended User detail exposes Restore account instead of a disabled Suspend button. Invited records cannot be suspended as if they were Users. Existing User roles are displayed read-only in Account details; no role editor or save action exists. BFF helpers forward expectedVersion, idempotency and correlation headers rather than discarding them. Mutation errors remain visible and query invalidation reloads server state. All new UI strings are available in EN/VI.

## Verification

Run from the repository root with supported Node and pnpm:

```sh
pnpm --filter @lcsp/api prisma:generate
pnpm exec tsc -b --pretty false
pnpm --filter @lcsp/api lint
pnpm --filter @lcsp/api build
NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config jest.config.ts --runInBand --watchman=false
pnpm run test:web
```

The focused database suite is fenced to a disposable PostgreSQL instance at `127.0.0.1:55439/lcsp_299_test`. It never reads an application database URL implicitly. Provision an empty local database, set both explicit URLs, and run:

```sh
export LCSP299_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/lcsp_299_test?schema=public'
export DATABASE_URL="$LCSP299_TEST_DATABASE_URL"
pnpm --filter @lcsp/api exec prisma db push
NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config test/jest-e2e.ts --runInBand --watchman=false --runTestsByPath test/admin-users.e2e-spec.ts test/lcsp299-account-lifecycle.e2e-spec.ts
```

WARNING: the legacy Admin E2E helper resets its explicitly configured disposable test database. Never point those tests at shared/staging/production data. The tests use real PostgreSQL transactions, actual account/auth modules, actual RBAC and a simulated SMTP boundary, while excluding unrelated repository-provider CLI startup dependencies.

Migration verification was performed separately against the prior HEAD schema on `lcsp_299_migration_test`: applied the actual migration SQL, verified year-9999 conversion, finite lock preservation and session revocation, then verified `prisma migrate diff` reports no difference versus the target schema. Application data was not migrated.

Browser click-through and real SMTP delivery are not covered by the Node SSR/client or PostgreSQL suites; do not equate those test results with a deployed browser/SMTP end-to-end certification.


## Scope-correction verification — 2026-09-11

Validated on `feat/LCSP-299-admin-account-lifecycle` starting from `82df9102783b94a18622075bb414b005fe1c5a2f`. This is a product-scope correction, not a workaround for failing CI. All changes in this pass remain uncommitted; only disposable test databases were used. SMTP was disabled for this regression pass.

| Check | Current scope-correction result |
| --- | --- |
| Full workspace TypeScript | PASS |
| API ESLint | PASS, 0 errors; 5 existing warnings |
| Web ESLint | PASS, 0 errors; 3 existing warnings |
| API build and Next.js production build | PASS |
| API unit suite | 864 passed; 8 skipped; 1 todo |
| Full API E2E suite | 295 passed; 23 scoped tests skipped in this invocation |
| Explicit LCSP-299/legacy Admin/migration PostgreSQL suites | 36 passed; includes all 23 scoped tests skipped above |
| Root web tests | 24 passed |
| Web feature/client/SSR tests | 347 passed |
| Admin Playwright CI gate | 10 passed |
| Prisma full migration chain and target-schema parity | PASS |
| Import/contract-literal/agentic runtime checks | PASS |
| Production API/BFF/client exported role mutation surface | ABSENT |
| git diff --check | PASS |

The role-mutation success/stale/self-demotion tests were removed. Replacements use the real Nest controller, current actor/session authorization, PostgreSQL transactions and actual component rendering to prove:

- The retired route is absent for Admin, Customer and anonymous callers; rejected calls do not change the account or issue mutation receipts.
- The application service rejects the retired operation and role injection into suspend/restore.
- Both canonical roles survive suspend/restore unchanged; restored accounts do not regain old sessions.
- Self-suspend remains forbidden and concurrent cross-suspension preserves a usable Admin.
- Provisioning still assigns an approved canonical role before User creation; role filtering/read projections remain available.
- The forward migration removes only retired deduplication receipts; stored roles, historical audit events and supported-command receipts survive.

The original migration checksum is unchanged. A fresh migration chain and the actual retirement SQL were tested against isolated PostgreSQL, and Prisma reported no schema difference. Generated Next route types were rebuilt after removal of the BFF route; no lint/typecheck rule or production guard was disabled. The resulting production route manifest contains list/detail/suspend/restore and no role mutation route.

Results and exact command logs are under `.cache/lcsp299-immutable-role/`. The migration regression is activated with `LCSP299_TEST_DATABASE_URL` and can be run alongside the lifecycle suite by adding `test/admin-role-retirement.e2e-spec.ts` to `--runTestsByPath`. The Playwright gate is the repository's existing sentinel suite, not a new authenticated invitation click-through certification. No new GitHub Actions run is claimed before the local correction is committed and pushed.

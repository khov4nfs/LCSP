# LCSP Auth — Ports and Adapters

**Scope:** Authentication module and the Admin Account Lifecycle integration.  
**Baseline:** commit `32b068703` (2026-10-24).  
**Status:** implementation in the LCSP-999 refactor branch; not an approval to merge or deploy.

## Architecture

The Auth API continues to use NestJS modules, CQRS command/query handlers,
Domain Entities, and Prisma persistence. Commands and queries depend on
application-facing ports rather than feature-specific infrastructure classes.

```mermaid
flowchart TD
    HTTP["HTTP Controller / Zod Pipe"] --> CQRS["CommandBus / QueryBus"]
    CQRS --> H["Application Command/Query Handler"]
    H --> P["Application ports"]
    P -. "implemented by" .-> ADAPTER["Prisma repositories / OAuth registry / MFA cipher"]
    ADAPTER --> DB["PrismaService / PostgreSQL"]
    H --> DOMAIN["Domain entities and rules"]
    ADAPTER --> DOMAIN
```

### Main ports

| Port                           | Implementation                  | Responsibility                                                     |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------ |
| `AUTH_USER_REPOSITORY`         | `PrismaUserRepository`          | User access and scoped account updates                             |
| `AUTH_SESSION_REPOSITORY`      | `PrismaSessionRepository`       | Session state and owner-checked revocation                         |
| `AUTH_READ_REPOSITORY`         | `PrismaAuthReadRepository`      | Auth profile, session lists, step-up metadata                      |
| `AUTH_SIGN_UP_PERSISTENCE`     | `PrismaSignUpPersistence`       | Atomic create of user, initial session and audit                   |
| `AUTH_SECURITY_PERSISTENCE`    | `PrismaAuthSecurityPersistence` | Atomic recovery and MFA-disable commands                           |
| `AUTH_AUDIT_EVENT_WRITER`      | `AuditWriterService`            | Normalized, sanitized event writes                                 |
| `AUTH_MFA_SECRET_CIPHER`       | `MfaSecretCipherService`        | Encryption/decryption of MFA secret; keys remain in infrastructure |
| `AUTH_OAUTH_PROVIDER_RESOLVER` | `OAuthProviderRegistry`         | Resolve configured OAuth providers                                 |

Provider tokens are registered in `auth.module.ts` or the auth persistence
provider collection. The application does not import `PrismaService`,
`@prisma/client`, or feature-specific implementation paths.

### Transactional audit boundary

```mermaid
sequenceDiagram
    participant H as Handler
    participant P as Persistence adapter
    participant DB as Prisma transaction
    participant A as AuthAuditService
    participant W as AuditWriterService

    H->>P: execute use-case operation
    P->>DB: $transaction(callback)
    DB->>DB: write user/session/related records
    P->>W: forTransaction(tx)
    W-->>P: transaction-bound writer
    P->>A: writeInTx(event, writer)
    A->>A: normalize and sanitize event
    A->>W: writer.write(normalized event)
    W->>DB: auditEvent.create in same tx
    DB-->>P: commit or rollback
    P-->>H: result
```

The application audit service does **not** receive `Prisma.TransactionClient`.
The infrastructure writer binds the audit write to the already opened
transaction. A failed audit write rejects the same transaction, preventing
partial success for atomic flows.

### Repository modules

The compatibility barrel `infrastructure/persistence/prisma-auth.repositories.ts`
continues to re-export the same 10 concrete repository classes. Implementations
are separated into:

- `prisma-user.repository.ts`
- `prisma-session.repository.ts`
- `prisma-mfa.repositories.ts`
- `prisma-recovery.repository.ts`
- `prisma-oauth.repositories.ts`
- `prisma-audit-event.repository.ts`

### Security and OAuth boundaries

- Pure TOTP functions are in `platform/security/totp.utils.ts`.
- Recovery-code generation/normalization is in
  `auth/application/security/mfa-recovery-code.utils.ts`.
- MFA secret encryption and key access remain in infrastructure behind
  `MfaSecretCipher`.
- OAuth handlers use `OAuthProviderResolver`; the Google OAuth implementation
  is unchanged in infrastructure.
- Previous feature-infrastructure utility/module paths remain as compatibility
  exports where required by existing imports and tests.

## Import dependency gate

`scripts/check-import-policy.mjs` rejects production files under
`apps/api/src/modules/auth/application` that import Auth infrastructure,
the Prisma infrastructure directory, or `@prisma/client`. Test fixtures are
excluded from this additional scoped boundary rule.

## Regression evidence

The following targeted verification completed on a **disposable local
PostgreSQL instance**, not the production database:

| Suite                                           | Result       |
| ----------------------------------------------- | ------------ |
| Auth + Sign Up + OAuth E2E                      | 66/66 passed |
| Account Lifecycle E2E                           | 17/17 passed |
| Auth / Admin / Audit / RBAC targeted unit suite | 68/68 passed |
| TypeScript build, import/contract checks        | Passed       |

The repository-wide complete test suite, deployment behavior and production
load/performance were not asserted by this change. E2E results should be rerun
in CI on the final pushed branch.

## Remaining technical considerations

1. Application handlers still use shared platform HTTP exception helpers. A
   stricter domain-error boundary can be considered in a separate change.
2. Existing Auth MFA enrollment/recovery-code flows have multi-record mutations
   outside the atomic Password Recovery and Disable MFA commands; review their
   transaction boundary independently rather than broadening this structural PR.
3. Deprecated import facades should remain until all consuming modules are
   migrated and tests prove they can be removed safely.

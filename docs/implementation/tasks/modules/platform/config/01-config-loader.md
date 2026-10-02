---
task_id: MW-cfg-001
module: platform/config
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.1
depends_on: []
---

# Config Loader — NestJS ConfigModule Bootstrap

## Outcome

Bootstrap NestJS `ConfigModule` with validated environment variables at app startup. All modules receive typed config via `ConfigService`; no module reads `process.env` directly.

## Module Files

| File                                  | Action | Notes                                                                                 |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `apps/api/src/config/config.ts`       | Create | Joi/zod validation schema + typed config factory                                      |
| `apps/api/src/config/config.types.ts` | Create | Typed config interfaces for all environment groups                                    |
| `apps/api/src/app.module.ts`          | Modify | Register `ConfigModule.forRoot({ isGlobal: true, load: [config], validationSchema })` |

## API Contract

No HTTP endpoint. Internal configuration provider.

**Typed config groups:**

```typescript
interface DatabaseConfig {
  url: string;
}
interface AuthConfig {
  bcryptCost: number;
  sessionTtlSeconds: number;
  jwtSecret: string;
}
interface OAuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  allowedRedirectUris: string[];
}
interface RabbitMqConfig {
  url: string;
  exchange: string;
}
interface CryptoConfig {
  mfaSecretEncryptionKey: string;
}
interface PythonWorkerConfig {
  baseUrl: string;
}
```

## Environment Variables

| Variable                      | Type   | Required | Default       | Notes                                     |
| ----------------------------- | ------ | -------- | ------------- | ----------------------------------------- |
| `DATABASE_URL`                | string | Yes      | —             | Prisma connection string                  |
| `OAUTH_GOOGLE_CLIENT_ID`      | string | No       | `""`          | Google OAuth login is disabled when blank |
| `OAUTH_GOOGLE_CLIENT_SECRET`  | string | No       | `""`          | Google OAuth login is disabled when blank |
| `OAUTH_ALLOWED_REDIRECT_ORIGINS` | string | No    | `""`          | Comma-separated origins                   |
| `GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION` | string | Yes | — | Active KEK version for stored repository credentials |
| `GITHUB_CLI_CREDENTIAL_KEK_KEYRING` | string | Yes | — | JSON map version -> 32-byte base64 key |
| `RABBITMQ_URL`                | string | Yes      | —             |                                           |
| `RABBITMQ_EXCHANGE`           | string | No       | `lcsp.events` |                                           |
| `MFA_SECRET_ENCRYPTION_KEY`   | string | Yes      | —             | AES-256-GCM: 32-byte hex                  |
| `NODE_ENV`                    | string | No       | `development` | `development` \| `production` \| `test`   |

## Business Rules

1. Validation runs at startup. Any missing required variable → app crashes with descriptive error listing missing keys.
2. `OAUTH_ALLOWED_REDIRECT_ORIGINS` is parsed into `string[]` by splitting on commas.
3. `MFA_SECRET_ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes). Validate length at startup.
4. No module may import `process.env` directly — always use `ConfigService.get<T>('key')`.
5. In test environment, validation can be bypassed using `ignoreEnvVars: true` or test-specific `.env.test`.

## Test Cases

| ID  | Scenario                                  | Expected                                 |
| --- | ----------------------------------------- | ---------------------------------------- |
| T01 | All required vars set                     | App starts successfully                  |
| T02 | Missing `DATABASE_URL`                    | App startup fails with descriptive error |
| T04 | `MFA_SECRET_ENCRYPTION_KEY` wrong length  | App startup fails                        |
| T06 | `OAUTH_ALLOWED_REDIRECT_ORIGINS` = `"a,b,c"` | Parsed as `['a', 'b', 'c']`              |

## Definition of Done

- App fails fast with descriptive error on any missing required env var.
- `MFA_SECRET_ENCRYPTION_KEY` length validated at startup.
- All module config accessed via `ConfigService` (no `process.env` in module code).
- Types exported for use by all consuming modules.

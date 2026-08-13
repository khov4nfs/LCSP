---
task_id: MW-evid-002
module: evidence
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 3.6
depends_on:
  - evidence/01-get-technical-evidence-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# TechnicalProfile Callback Endpoint

## Outcome

Receive the `TechnicalProfile` artifact from the Python intelligence worker after evidence evaluation. Validate schema and provenance. Store immutable `TechnicalProfile`. Emit `technical-profile-ready` event. This profile is the gate for AI usage flow and conflict detection.

## Module Files

| File                                                                                                              | Action | Notes                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `apps/api/src/modules/evidence/presentation/http/evidence.controller.ts`                                          | Modify | Add `POST /internal/evidence/technical-profile-callback` |
| `apps/api/src/modules/evidence/application/commands/accept-technical-profile/accept-technical-profile.command.ts` | Create | Command shape                                            |
| `apps/api/src/modules/evidence/application/commands/accept-technical-profile/accept-technical-profile.handler.ts` | Create | Validation + persistence + event emission                |
| `apps/api/prisma/schema.prisma`                                                                                   | Modify | Add `TechnicalProfile` model                             |

## Prisma Model

```prisma
model TechnicalProfile {
  id               String   @id @default(uuid())
  evidenceReportId String   @unique
  assessmentId     String
  organizationId   String
  schemaVersion    String
  providerVersion  String                           // Intelligence worker version
  profileData      Json                             // Validated TechnicalProfile payload
  privacyFlags     Json
  status           String   @default("accepted")   // 'accepted' | 'rejected'
  rejectionReason  String?
  createdAt        DateTime @default(now())

  @@index([assessmentId])
}
```

## API Contract

**Endpoint:** `POST /internal/evidence/technical-profile-callback`
**Auth:** `X-Worker-Api-Key`

**Request body:**

| Field                | Type   | Required | Notes                                   |
| -------------------- | ------ | -------- | --------------------------------------- |
| `evidence_report_id` | string | Yes      | Source evidence report                  |
| `assessment_id`      | string | Yes      |                                         |
| `schema_version`     | string | Yes      |                                         |
| `provider_version`   | string | Yes      | Intelligence worker version             |
| `profile_data`       | object | Yes      | Validated TechnicalProfile payload      |
| `privacy_flags`      | object | Yes      | `containsSourceCode`, `secretsRedacted` |

**Success response (200):**

| Field                  | Type    | Notes |
| ---------------------- | ------- | ----- |
| `accepted`             | boolean |       |
| `technical_profile_id` | string  |       |
| `correlationId`        | string  |       |

**Error responses:**

| HTTP | `error_code`                | Meaning                                             |
| ---- | --------------------------- | --------------------------------------------------- |
| 401  | `UNAUTHORIZED`              | Invalid worker API key                              |
| 404  | `EVIDENCE_REPORT_NOT_FOUND` | Source evidence report not found                    |
| 409  | `PROFILE_ALREADY_EXISTS`    | TechnicalProfile already accepted for this evidence |
| 422  | `SCHEMA_INVALID`            | Unknown schema version or missing required fields   |
| 422  | `PRIVACY_FLAGS_INVALID`     | Source code or unredacted secrets in payload        |

## Business Rules

1. Auth: validate `X-Worker-Api-Key`.
2. Verify `evidenceReportId` references an accepted `TechnicalEvidenceReport`.
3. Check `TechnicalProfile` does not already exist for `evidenceReportId` → `PROFILE_ALREADY_EXISTS`.
4. Validate `privacy_flags.containsSourceCode = false`.
5. Validate `privacy_flags.secretsRedacted = true`.
6. Create `TechnicalProfile` with `status = accepted` (immutable).
7. Emit outbox message `technical-profile-ready` for AI usage flow worker.
8. Audit event `TECHNICAL_PROFILE_ACCEPTED`.

## Commands / Events

| Name                            | Type             | Safe payload                                                                                       |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `AcceptTechnicalProfileCommand` | App command      | `{ evidenceReportId, assessmentId, schemaVersion, providerVersion, privacyFlags, correlationId? }` |
| `event.technical-profile-ready` | Outbox           | `{ technicalProfileId, assessmentId, evidenceReportId, correlationId }`                            |
| `TECHNICAL_PROFILE_ACCEPTED`    | `AuthAuditEvent` | `{ technicalProfileId, assessmentId, evidenceReportId, correlationId }`                            |

## Test Cases

| ID  | Scenario                                 | Expected                        |
| --- | ---------------------------------------- | ------------------------------- |
| T01 | Valid profile + clean privacy flags      | 200 accepted                    |
| T02 | `containsSourceCode = true`              | 422 `PRIVACY_FLAGS_INVALID`     |
| T03 | Profile already exists                   | 409 `PROFILE_ALREADY_EXISTS`    |
| T04 | Evidence report not found                | 404 `EVIDENCE_REPORT_NOT_FOUND` |
| T05 | Invalid API key                          | 401                             |
| T06 | Outbox `technical-profile-ready` created | DB verified                     |
| T07 | `TechnicalProfile` immutable             | No update path                  |

## Definition of Done

- `TechnicalProfile` accepted only with clean privacy flags.
- Immutable once accepted — no update endpoint.
- Outbox `technical-profile-ready` triggers downstream AI usage flow.
- Audit event written with no profile content.

## Implementation Evidence

- Added `TechnicalProfile` Prisma model with unique `evidenceReportId` and assessment index.
- Added `POST /internal/evidence/technical-profile-callback` guarded by `X-Worker-Api-Key`.
- Added `AcceptTechnicalProfileCommand` and handler for accepted evidence lookup, duplicate rejection, schema/privacy validation, immutable persistence, outbox emission, and audit writing.
- Added scan contract constants for TechnicalProfile status, schema version, ready event, accepted audit event, and callback error codes.
- Added e2e coverage for T01–T07, including invalid API key, privacy rejection, duplicate profile rejection, missing evidence report, outbox/audit safe refs, and no update path.

## File List

- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/evidence/application/commands/accept-technical-profile/accept-technical-profile.command.ts`
- `apps/api/src/modules/evidence/application/commands/accept-technical-profile/accept-technical-profile.handler.ts`
- `apps/api/src/modules/evidence/application/contracts/evidence/technical-profile-callback.contract.ts`
- `apps/api/src/modules/evidence/evidence.module.ts`
- `apps/api/src/modules/evidence/presentation/http/evidence.controller.ts`
- `apps/api/test/technical-profile-callback.e2e-spec.ts`
- `packages/contracts/src/scan/callback.ts`
- `packages/contracts/src/scan/codes.ts`

## Validation

- `pnpm --filter @lcsp/api prisma:generate`
  - Result: passed.
- `pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/technical-profile-callback.e2e-spec.ts`
  - Result: passed, 7 tests.
- `pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/technical-profile-callback.e2e-spec.ts test/scan-job-callback.e2e-spec.ts`
  - Result: passed, 15 tests.
- `pnpm --filter @lcsp/api test:e2e`
  - Result: passed, 27 suites / 231 tests.
- `pnpm --filter @lcsp/api lint`
  - Result: passed.
- `npm run lint`
  - Result: blocked by pre-existing contract literal failures in `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.handler.spec.ts:97` and `apps/api/test/document-final-report.e2e-spec.ts:271`.
- `npm run typecheck`
  - Result: blocked by pre-existing type errors in `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.handler.spec.ts:36` and `:39`.

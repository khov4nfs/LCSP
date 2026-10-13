# LCSP Production Release Report

> Prepared 2026-10-14. This report records release-source and migration evidence; it is not a production deployment receipt.

## Release summary

The latest code promoted from `develop` to `main` is the date-based release PR #371. PRs #381 and #382 were merged to `develop` afterward and define the current provider-routing candidate. The production-running SHA is not verified. This documentation contribution adds the local Prisma migration described below; no application deployment or production database change was performed.

## Release identity

| Field                                      | Value                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Report date                                | 2026-10-14                                                                                               |
| Product version                            | No formal product version; package versions are private workspace metadata.                              |
| Latest promotion to `main`                 | [PR #371](https://github.com/khov4nfs/LCSP/pull/371), merged 2026-10-12.                                 |
| Main promotion SHA                         | `d9ec1f63dcb5250870f4f55d007f9aa9b09049e4`                                                               |
| Latest provider-routing merge to `develop` | [PR #382](https://github.com/khov4nfs/LCSP/pull/382), merged 2026-10-13.                                 |
| Develop candidate SHA                      | `94fad33ea83c4e5272e283958378b48d36f212b7`                                                               |
| Production-running SHA                     | **NOT VERIFIED**; no production deployment receipt was collected.                                        |
| Documentation and migration PR             | This release-documentation PR, targeting `develop`; its exact head and checks are recorded on GitHub.    |
| Migration                                  | `apps/api/prisma/migrations/20261013132644_re_generate_db/migration.sql`                                 |
| Affected areas                             | Web activity projection, API lifecycle/persistence, Python Agent Runtime routing, and PostgreSQL schema. |

The repository's release convention is a dated `chore: LCSP-999 release YYYY-MM-DD` promotion PR from `develop` to `main`, with changes recorded under `CHANGELOG.md`'s `Unreleased` heading. No Git tags or GitHub Releases are published; no version was invented.

## Major product and architecture changes

- **Rule Set Preparation lifecycle:** administrators can start preparation for an eligible source, retry a failed run, and cancel active work. Historical failed or cancelled attempts do not impose a finite total attempt cap. Persisted terminal contracts and the activity stream keep displayed status aligned with server state. ([PR #374](https://github.com/khov4nfs/LCSP/pull/374), [PR #377](https://github.com/khov4nfs/LCSP/pull/377), [PR #378](https://github.com/khov4nfs/LCSP/pull/378))
- **APX credential handling:** `APX_API_KEY` supports credential-pool rotation. Permanent allowance exhaustion retires only the affected slot; transient 429 responses use cooldown. Configured provider fallback follows same-provider credential handling. ([PR #381](https://github.com/khov4nfs/LCSP/pull/381))
- **Provider/protocol separation:** trusted route configuration selects provider, protocol, model, and validated options independently. APX may use Anthropic or OpenAI protocol while APX remains the credential and usage identity. The checked-in primary route is APX over Anthropic protocol. ([PR #382](https://github.com/khov4nfs/LCSP/pull/382))
- **Developer launcher security:** the remaining shell-command injection path was removed by invoking the Corepack entry point with separated arguments. ([PR #379](https://github.com/khov4nfs/LCSP/pull/379))

## Database migration

**Migration:** [`20261013132644_re_generate_db`](../../apps/api/prisma/migrations/20261013132644_re_generate_db/migration.sql), timestamp 2026-10-13 13:26:44.

The migration reconciles schema names and indexes after the preceding tracked migration `20261013100000_agent_stream_boundaries`. It removes obsolete foreign-key/index definitions, renames legacy Auth-prefixed constraints to the current `AuditEvent` and `User` names, drops the `AuthRecord.updatedAt` database default, adds composite indexes for `AuditEvent(resourceId, eventType, createdAt)` and `RepositoryConnection(userId, provider, status)`, and drops the unused `WizardProfile` table and `WizardProfileStatus` type. Current application source has no `WizardProfile` references.

The table/type drop is destructive and is not backward-compatible for any retained `WizardProfile` rows. No production row inventory was performed. Before production application, confirm that the table contains no data that must be retained and that no old application instance depends on it. The migration has not been verified as applied to production. Once applied, reverting the migration alone cannot restore dropped rows; recovery requires an approved backup restore or a forward repair.

## Verification

- PR #377: 27 checks passed, 0 failed.
- PR #381: 25 checks passed, 0 failed.
- PR #382: 28 checks passed, 0 failed.
- `DATABASE_URL=<dedicated local test database> pnpm --filter @lcsp/api exec prisma validate --schema prisma/schema.prisma`: PASS (Prisma 7.8.0).
- Fresh disposable PostgreSQL 16 migration replay: PASS; all 109 migrations, including `20261013132644_re_generate_db`, applied. `prisma migrate status` reported up to date, and `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reported no difference.
- `pnpm run check:contracts`: PASS. Branch-name validation: PASS.
- Prettier formatting and relative Markdown-link checks: PASS across the eight changed Markdown files. The secret-pattern scan found zero matches in the six checked release/security and migration files.
- `git diff --check` and `git diff --cached --check`: PASS. The documentation PR's required CI status is authoritative on its exact GitHub head. No local full typecheck or lint suite is claimed for this docs/migration-only change.
- The current repository workflow runs Python tests with `pytest`; no Ruff workflow or project check is configured.
- **Deployment evidence:** no production workflow was dispatched, no production database was accessed, and no current production SHA was established.

## Production topology

The repository-declared services are the Next.js Web application, NestJS API, and internal Deep Agents/LangGraph Agent Runtime, with PostgreSQL and RabbitMQ infrastructure. The production workflow uses the Fogewise deployment path. PM2 scripts remain repair tooling for non-Fogewise hosts and are not the production authority. The production workflow is manually dispatched; this documentation PR does not trigger it.

## Known issues and residual risks

- The production-running commit and deployment health for the develop candidate are not verified.
- `20261013132644_re_generate_db` drops `WizardProfile`; production data-retention eligibility remains unknown until separately checked.
- The release report does not claim Ruff evidence because no repository Ruff check is configured.

## Rollback considerations

Documentation can be reverted independently. The migration is a forward-only schema change in practice: it drops `WizardProfile` and its enum, and a code rollback does not recreate deleted rows. Use a verified database backup or an explicit forward-repair migration if recovery is required. Do not apply the migration to production until data-retention and runtime-order preconditions are satisfied.

## Source-of-truth references

- [README](../../README.md)
- [Security policy](../../SECURITY.md)
- [CHANGELOG](../../CHANGELOG.md)
- [Release notes](../../docs/releases/2026-10-14.md)
- [Documentation index](../../docs/index.md)
- [Production dispatch workflow](../../.github/workflows/deploy.yml) and [Fogewise deployment workflow](../../.github/workflows/fogewise-deploy.yml)
- [Model route authority](../../deepagents/config/model_routes.yaml)
- [Migration](../../apps/api/prisma/migrations/20261013132644_re_generate_db/migration.sql)
- [Last main promotion, PR #371](https://github.com/khov4nfs/LCSP/pull/371)
- [PR #381](https://github.com/khov4nfs/LCSP/pull/381) and [PR #382](https://github.com/khov4nfs/LCSP/pull/382)

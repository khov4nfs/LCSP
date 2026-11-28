# ADR: Multi-repository Assessment (one Assessment, N pinned repositories)

Status: accepted (decisions confirmed by the product owner), implementation in progress.
Detailed plan: `docs/implementation/multi-repository-assessment-plan.md`.

## Context

An Assessment pins exactly one repository snapshot (`AssessmentCase.repositorySnapshotId`,
`repositoryScanJobId`, `repositoryCommit`). Evidence, decisions, rule-audit requests, reports, the Python
sandbox (`/workspace/repository`), the Codebase Memory index and the Root prompt all assume that single pin.
Customers need one Assessment that reasons across several repositories (for example a frontend that collects
consent and a backend that stores and deletes data).

## Decisions

| Id | Decision |
|---|---|
| D1 | At most 5 repositories per Assessment (`ASSESSMENT_REPOSITORY_LIMITS.maxRepositories`). |
| D2 | The same repository may appear more than once with different `sourcePathPrefix` values (monorepo scopes). Uniqueness is per snapshot, not per repositoryId. |
| D3 | The repository set is immutable once the Assessment is ACTIVE. Changing it means a new Assessment. |
| D4 | Discovery runs one run per repository, each in its own sandbox, bounded by Root capacity. One "Run discovery" action creates the runs as one batch. The discovery artifact itself is unchanged: the repository a record describes is the pin of its snapshot, so scanner signatures and content digests stay stable. |
| D5 | Total hydrated size is capped at twice the current single-repository budget, checked when pinning. |
| D6 | Reports gain a V4 schema; V2/V3 stay read-only for existing artifacts. |
| D7 | The number of repositories is capped by the contract maximum and can only be lowered by the API environment variable `LCSP_MAX_ASSESSMENT_REPOSITORIES` (default 5). The API reports the effective `repositoryLimit` in the setup view and the UI never offers more. A capability-policy toggle replaces the variable when the capability framework gains a per-platform setting. Keep it at 1 in production until the worker, discovery and report phases land. |

## Model

- `AssessmentCaseRepository` holds one immutable pin per repository: `repositoryKey`, `ordinal`, connection,
  snapshot, scan job (hydration ticket), commit and source scope.
- `repositoryKey` is a short slug unique in the Assessment (`^[a-z0-9][a-z0-9-]{0,39}$`). It is the sandbox
  directory (`/<key>/...`), the evidence coordinate and the UI badge.
- `repositorySetDigest` (`computeRepositorySetDigest` in `@lcsp/contracts/assessment-domain`) proves the whole
  set is unchanged. It replaces `(repositorySnapshotId, repositoryCommit)` in decision scope, rule-audit
  requests, report identity and checkpoint metadata. The Python worker implements the same canonical form,
  verified against `packages/contracts/test/fixtures/repository-set-digest.json`.
- Existing single-repository Assessments are backfilled as a set of one (`ordinal = 0`).

## Rollout

Phases 1-2 move the whole system onto the set model with N = 1 and unchanged behavior (dual-write of the old
scalar columns). Phase 3 onward opens N > 1. Scalar columns and compatibility wrappers are removed in the
final cleanup phase after no reader remains.

## Consequences

- Large cross-cutting change (API ~30 files, tracking SQL, worker sandbox/index/tools/prompt, report V4, web).
- Worker prompt and tool guidance change, so a new instruction revision and eval run are required.
- Evidence IDs for new evidence include `repositoryKey`; existing evidence keeps its IDs.

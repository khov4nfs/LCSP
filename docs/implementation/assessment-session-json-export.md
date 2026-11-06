# Assessment Session JSON export

## Scope and entry points

The session export contains persisted assessment evidence and measured execution
telemetry under schema version `assessment.session.v1`.

| Entry point                                              | Purpose                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /assessments/:assessmentId/session-export/download` | Authenticated API download for the assessment owner                         |
| `GET /api/assessments/:id/session-export/download`       | Next.js BFF download using the current session                              |
| `apps/api/scripts/export-session-json.ts`                | Explicit operator export of one session                                     |
| `apps/api/scripts/export-t31-deliverables.ts`            | Explicit operator export of a session and a specified final-report artifact |

The BFF and reusable browser helper are available. This change does not add an
Export session JSON control to an assessment screen. A future caller can use
`apps/web/src/lib/file-download.ts` with the BFF URL and its localized save-dialog
description.

Exporting reads existing records and artifacts. It does not run an agent, invoke
a model, create evidence, change an assessment decision, reconstruct missing
prompts, assign reviewer scores, or certify compliance. The HTTP controller records
the existing download audit event after successful authorization and loading.

## Authorization, source pins and audit scope

The canonical provenance loader checks the owner's access and provenance
integrity before the export loader reads additional telemetry. Operator scripts
use the same loader with the explicitly supplied owner identity and customer role;
the owner flag does not bypass authorization.

When provenance contains a repository snapshot pin, the loader requires a
snapshot matching **all three** of snapshot ID, assessment ID and commit SHA.
Repository name, provider, branch and `sourcePathPrefix` come from that exact row.
A missing or foreign snapshot, mismatched commit or invalid prefix fails closed
with `PROVENANCE_INTEGRITY_MISMATCH` (HTTP 409). A newer snapshot or another
repository connection never substitutes for the pinned source. No snapshot
metadata is inferred for an assessment that has no repository pin.

The exported `pins` and `auditScope` are copied from verified provenance and
included in the content fingerprint. Selected-audit mode and its requested,
ready and not-requested counts remain explicit. An export must not be presented
as a full-rule audit merely because the assessment's pinned rule set is larger
than the selected scope.

Session telemetry and histories cover the assessment's persisted runs. The
`auditScope` field describes the provenance scope; it does not claim that every
historical runtime row belongs to one audit request.

## Data contract

| JSON path                          | Source                                         | Interpretation                                                                       |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pins`                             | Verified provenance                            | Immutable rule-set and repository identities                                         |
| `auditScope`                       | Verified provenance                            | Audit mode and requested/ready/not-requested scope                                   |
| `session`                          | Runtime turns and canonical lifecycle events   | Assessment identity, lifecycle and available start/completion timestamps             |
| `repository`                       | Exact pinned snapshot and its connection       | Provider, repository, commit, snapshot, source prefix and recorded branch            |
| `agent`                            | Runtime version and persisted usage rows       | Root version and observed provider/model pairs                                       |
| `executionMetrics`                 | Runtime journal and persisted turn timestamps  | Explicit observed counts, spans and measurement coverage                             |
| `tokenUsage`                       | Persisted provider usage                       | Complete totals only when fully measured; otherwise null and separate partial totals |
| `humanInteraction`                 | Verified provenance                            | Questions, statuses, dependencies and answer history                                 |
| `inputSnapshot.humanAnswerHistory` | Verified provenance                            | Recorded human answers and their rule dependencies                                   |
| `assessmentResults`                | Verified provenance and report loader          | Accepted facts/evidence, decisions, legal context and available verified report      |
| `executionHistory`                 | Sanitized journal, turn records and usage rows | Recorded chronology, observed spans, file evidence and provider measurements         |
| `integrity`                        | Provenance and export serialization            | Provenance fingerprint and session-content fingerprint                               |

Compatibility aliases `assessment`, `decisions`, `report` and `telemetry`
remain available. They do not grant authority beyond their canonical source.

### Measurement availability

**Durations.** `session.startedAt` uses the earliest valid persisted turn start,
falling back to the runtime start only when turn starts are unavailable.
`session.lastExecutionStartedAt` preserves the runtime's most recent start.
`session.completedAt` and `wallDurationMs` require a recorded canonical COMPLETE
transition; assessment `updatedAt` is not substituted as a completion time.
Wall duration includes waiting and gaps between attempts.

A turn's `updatedAt` can reflect persistence activity and is not proof of an
active-execution boundary. Therefore `activeDurationMs` remains null. The existing
`observedRunningDurationMs` compatibility field contains only the sum of valid
observed turn spans. Those spans can include waiting or overlap and must not be
reported as authoritative active time or compared directly with another tool's
active-duration measurement.

`durationMeasurement` is `OBSERVED_TURN_SPANS`, `WALL_ONLY` or `UNAVAILABLE`.
`durationCoverage` identifies measured and missing/invalid spans and states that
active duration is not authoritative. `executionHistory.executionSegments`
retains each turn's original state and timestamps; its existing `completedAt`
field represents the recorded turn `updatedAt` observation.

**Tokens.** Only nonnegative, numerically safe provider measurements on SETTLED
usage rows contribute to totals. Each top-level metric is null unless every
observed usage row provides that metric. A measured zero remains zero; a missing
cached/reasoning/total measurement remains unknown. Total tokens are never
reconstructed from other dimensions, and cached tokens are never added twice.

`tokenUsage.observedTotals` contains partial measured sums.
`observedTotals.coverage.metrics` reports each metric's measured, missing and
invalid event counts, completeness and overflow state. Global completeness is
false whenever any dimension is incomplete. These coverage flags concern the
persisted usage rows and do not prove that every provider invocation was
captured. `executionHistory.modelUsageEvents` preserves the provider dimensions
as decimal strings, including values too large to safely aggregate as JavaScript
numbers, with null for unreported values.

**Tools and model events.** `toolCalls` counts distinct run ID + tool-call ID
pairs found in persisted semantic tool-call/result envelopes. Call, result and
replay rows for one identity count once. It is an observed minimum, and
`toolCallCoverage.exhaustive` remains false. Missing identities and unclassified
journal rows are counted explicitly. `toolExecutions` retains observed semantic
events and their recorded statuses; an absent status is not invented as success.

A generic journal row, boundary event or log is not a model call.
`modelCalls` remains null, while
`modelCallCoverage.observedModelEvents` counts recognized persisted model events.
The sanitized raw journal remains available in `executionHistory.runtimeEvents`.
The error summary list includes rows with persisted `errorSummary`; semantic
failure details can also remain in the raw journal.

**Files.** `assessmentResults.sourceEvidenceIndex` records accepted evidence
paths, commit, line range, excerpt digest and any already persisted excerpt.
`executionMetrics.observedUniqueFilesExamined` and
`executionHistory.fileAccessObservations` describe paths present in accepted
evidence; they do not enumerate every file the runtime read. Export does not fetch
repository files. `fileSha256` remains null because a whole-file digest has not
been independently verified by this aggregation.

## Report availability and integrity

An active final-report artifact is loaded through the existing report loader.
A successfully validated report sets
`assessmentResults.finalReportStatus = AVAILABLE`.

When there is no active report, or the report loader raises the canonical
`FINAL_REPORT_INVALID` conflict, the session can still export independently
verified telemetry and provenance. The report status is `UNAVAILABLE` and report
content is null. Authorization errors, provenance failures and unrelated storage
or runtime errors remain fatal; they are not converted into partial success.

The HTTP download uses private/no-store caching and forwards the upstream
attachment filename and exact bytes. Headers distinguish:

- `x-checksum-sha256`: checksum of downloaded bytes.
- `x-content-fingerprint-sha256`: fingerprint of the canonical session content.
- `etag`: the upstream download entity tag.

`integrity.contentSha256` includes pins, audit scope and exported content.
Formatting or trailing-newline changes can change the byte checksum without
changing that canonical content fingerprint.

## Operator CLI

Run these commands from `apps/api` after the normal dependency, contracts and
Prisma-client build steps. Supply database/runtime-role and artifact-storage
configuration through the caller's environment. The scripts do not load a parent
`.env`, set historical assessment defaults or supply migration credentials.
The existing Prisma startup policy still applies.

The `--help` path exits before creating a Prisma connection:

```sh
pnpm exec tsx scripts/export-session-json.ts --help
pnpm exec tsx scripts/export-t31-deliverables.ts --help
```

### Export one session

All three flags are required:

```sh
pnpm exec tsx scripts/export-session-json.ts \
  --assessment-id "<assessment UUID>" \
  --owner-id "<owner user ID>" \
  --output "/absolute/path/session.json"
```

Assessment identity must be a UUID and the owner/output values must be nonempty.
The output directory must already exist. Relative output paths resolve from the
caller's current working directory. Success prints the saved path and canonical
content SHA-256.

### Export a session and a specified final report

All five flags are required:

```sh
pnpm exec tsx scripts/export-t31-deliverables.ts \
  --assessment-id "<assessment UUID>" \
  --owner-id "<owner user ID>" \
  --artifact-id "<final report artifact UUID>" \
  --session-output "/absolute/path/session.json" \
  --report-output "/absolute/path/final-report.json"
```

The artifact UUID selects the exact report passed through the production report
loader. Both destinations must be distinct and absent. Both owner-scoped loads
must succeed before either file is written. Consequently, the paired command
fails if the specified report is unavailable even when a standalone session
export would succeed with an unavailable report.

### Files and exit status

Both scripts create files exclusively with `wx`; they never replace an existing
export or a historical evidence ledger. Invalid arguments, authorization or
integrity failure, unavailable paired report, existing destinations and write
errors produce a nonzero exit. Each script closes its own Prisma connection.

The paired filesystem writes are not an atomic transaction. A failure while
creating the second file can leave the first newly created file. The command
still exits nonzero; inspect the paths before retrying with new output names.
Neither command treats such a partial pair as successful.

## Browser download behavior

The reusable helper falls back to an ordinary same-origin attachment link when
the save picker is unsupported or unavailable. It prevents the caller's default
click action to avoid starting a second download. Picker cancellation is silent
and does not fetch the export.

After a destination is selected, the helper fetches with same-origin credentials,
checks HTTP success, writes the file and closes the writable stream. Fetch/write
failure rejects the operation and aborts an opened stream; it does not start a
second fallback download after a failed write. Localized dialog text belongs to
the calling UI.

## Verification and historical evidence

Focused tests cover owner authorization, exact snapshot/assessment/commit/prefix
binding, audit-scope fingerprinting, report availability, telemetry completeness,
semantic call deduplication, BFF authentication/validation and byte/header
preservation. Browser behavior is covered separately by the repository's real
browser regression path.

This guide describes the current implementation. Dated T31 artifacts remain
historical evidence of the runs that produced them; the operator commands do not
silently regenerate or overwrite those records.

# Release verification runbook

Current pre-merge authority is [the PR #367 correction release proof](../../reports/pr367-correction-release-proof.md) and [the acceptance matrix](../../reports/staging-acceptance-matrix.json). The current final candidate must pass the complete browser journey on its own fresh isolated staging stack; an older candidate or equivalence bridge does not satisfy that gate. Production remains outside this pre-merge verification.

The canonical physical PostgreSQL migration uses in-place renames, removes terminology compatibility maps, and preserves shared rule-set history and assessment pins. [The populated upgrade rehearsal](../../reports/pr367-physical-rename/receipt.json) must pass before the image gate. Source lifecycle routes are `/internal/legal-sources`; Legal Source activation automatically dispatches Rule Set Preparation through its durable event and CommandBus. Admin has bounded retry of a failed run and no generic Start; assessments only pin and reuse the shared immutable Compliance Rule Set.

Use purpose-based automation from the repository root:

```bash
rtk proxy deepagents/.venv/bin/python tests/release-images.py --self-check
rtk proxy deepagents/.venv/bin/python tests/release-images.py
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --self-check --image-evidence reports/release-images/<candidate>
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --image-evidence reports/release-images/<candidate>
rtk proxy deepagents/.venv/bin/python tests/staging-rule-set-preparation.py <owned-run-id> --image-evidence reports/release-images/<candidate>
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --stop <owned-run-id>
```

Pass the same repository-relative image-evidence directory to each self-check, launch, and preparation command; the selected receipt is recorded in the owned stack manifest and reused by downstream checks.
Require all four merged-rootfs audits and seven Docker integrations, with no skips, before launch.
Use only those immutable image IDs; instruction/build-input changes make earlier receipts historical.
Keep access files and provider diagnostics under private `tmp/staging/<owned-run-id>`; publish only
sanitized evidence under `reports/staging/<owned-run-id>`.

Review the actual generated packet against all six unchanged semantic dimensions. Do not edit it,
insert a fixture rule set, repair meaning in the validator, or add an approval workflow. Source/index
fixture inputs are bounded synthetic prerequisites, not official-source acquisition or live indexing proof.
After semantic success, finish the real browser flow, reconcile every frozen acceptance row, verify
current-source remote CI and enforce the existing all-suite aggregate. Read back develop ruleset 18478777: strict checks must include Require Jira issue key, Docker sandbox E2E, and V2 required release gate. One approving human review is required; new pushes dismiss stale reviews. Leave the PR open and unmerged.
Keep unaffected accepted migration/domain/deletion evidence and rerun only affected checks.

## Historical execution log

The entries below retain earlier bounded results and historical receipt links. They do not establish
current-source release acceptance or authorize running superseded commands.

# RELEASE release boundary and destructive cleanup

> Current RELEASE result: IN PROGRESS, releaseEligible=false. Legal semantic correction is being verified; two fresh exact-image attempts remain semantic FAIL. See `reports/legal-preparation-semantic-correction.json`. Earlier image/staging receipts are historical after instruction changes.


Scope: FEATURE, the frozen RELEASE Plan. CANONICAL–CUTOVER are accepted. Legacy V1 retention
is zero/no hold. V2 explicit tenant-authorized DELETE has zero content retention
and no default hold; active assessments do not expire automatically. The policy
is in `ASSESSMENT_DELETION_RETENTION_POLICY.md`.

This runbook is preparation. **Production deployment, production data mutation
and the post-deploy canary require separate user authorization.** No command
below is evidence that a deployment occurred.

## Current disposable check

The following creates its own loopback-only PostgreSQL container, databases,
synthetic checkpoints/files and stopped labeled sandbox fixtures. It accepts
no existing database target. Its sandboxes carry a unique synthetic cutover-run
label; unrelated existing containers are excluded and only containers it created
are removed. This scope is accepted only for matching synthetic fixture metadata;
normal release erasure still refuses unknown sandbox ownership.

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy env PYTHONPATH=deepagents deepagents/.venv/bin/python tests/retired-authority-migration-check.py
```

Send the complete output, exit code and printed evidence directory, plus
`postgres-errors.log` if present. Failed runs retain PostgreSQL diagnostics before
removing their owned container; SQL statement/payload lines are excluded. Evidence is
saved under `reports/w7-migration/<run>/`. A PASS proves the affected clean
install, populated synthetic post-CUTOVER upgrade, native external purge and rerun
checks. It does not replace the accepted 462-check CUTOVER receipt, prove an actual
production restore point, prove the V2 DELETE integration or close staging.

## Authorized release sequence

The disposable migration receipt `reports/w7-migration/20261009062210_313264/report.json`
passed all nine checks and is reusable. Do not rerun it merely to continue RELEASE.

The next affected canonical domain and explicit-DELETE check creates its own
loopback PostgreSQL container and synthetic assessments/checkpoints/sandboxes.
It builds the current API and runtime packages, runs the existing scripted
Assessment Root vertical, then calls the real DELETE API and native eraser HTTP
routes. It checks tenant isolation, answered/open Human Resolution content,
execution/request cancellation before erasure, native checkpoint namespaces/
blobs/writes, owned sandbox/log bytes, domain cascades, immutable report bytes,
detached accounting and repeated deletion. It removes only its own fixtures.

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh
```

Send complete output, exit code and both printed evidence directories:
`reports/w7-domain/<run>/` and `reports/w7-deletion/<run>/`.
This is provider-free affected integration, not merged-image, semantic-quality,
staging or post-deploy proof. Do not start another heavy check while awaiting it.

The first domain run `20261009070055_401359` built successfully but stopped
on a fixture-only Human Resolution revision mismatch before DELETE. The fixture
now uses the enclosing current case revision and validates both shared schemas.
For the immediate rerun, reuse that build:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build
```

This skips only the already-passed generation/package/API builds. Use the normal
command after any subsequent production/schema/contract change. The disposable
database and actual API/native deletion check still run.

The next saved domain run `20261009070844_418437` reached the deletion helper;
its report `release-deletion/20261009070907_419659` contains two completed checks
and an unlocated bare assertion. The fixture's post-delete Continue assertion
now matches the canonical refusal: 409 `RUNTIME_CONTROL_TARGET_STALE`.
Missing Assessment rejection occurs before runtime lookup; it does not permit
execution. Future failure receipts include bounded file/line/function metadata.
These fixture-only corrections use the same `--reuse-build` command above.

The corrected domain run is accepted: `reports/w7-domain/20261009071553_433748/report.json`
records exit code 0 and the returned console records 138 checks PASS. The separate
`reports/w7-deletion/20261009071618_435056/report.json` records eight checks PASS.
Reuse both receipts; the following command does not repeat them or the nine-check
migration harness.

The returned `reports/w7-canonical/20261009073901_486442/report.json` is FAIL
at the protocol's obsolete fixed-port guard. Its console records 29 portfolio
database guarantees PASS, including the corrected absent V1 column assertion.
Reuse those checks. The guard now requires the launcher's assigned port while
preserving the exact loopback/credentials/disposable database/schema target.
A stale launcher call to the already-deleted V1 runtime-turn/journal e2e spec
has also been removed. Current Root control proof stays in the HITL vertical.

The remaining group uses the same wrapper's fresh PostgreSQL container and now
starts at lifecycle migration/protocol, then legal portfolio activation/fail-closed/
pin handling, full same-thread Human Resolution/native Stop/Continue, and the
permanently-unresolvable blocker mode. It does not repeat the accepted 29
portfolio database guarantees. Worker cleanup has separate 44-test/6-test receipts.

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --remaining-canonical
```

Return complete output, exit code and the printed `reports/w7-canonical/<run>/`
evidence directory. This reuses the accepted API build and does not invoke any
provider or production target. Use the normal build mode if API executable,
schema or contract source changes. This is affected integration mechanics;
semantic quality, merged-image/browser/broad CI and staging remain separate.
No second heavy check starts while this result is pending.

The remaining canonical receipt `reports/w7-canonical/20261009074431_499009/report.json`
is accepted with exit code 0: 16 current migration constraints/lifecycle protocol,
54 legal portfolio vertical checks, 79 HITL mechanics and 72 unresolvable-fact
mechanics PASS. Native controls/crash handling use real API/PostgresSaver and
separate scripted processes. Keep this and all earlier accepted receipts.

Next broad current-source regression reuses this wrapper's owned loopback
PostgreSQL container and existing commands. It rebuilds packages/API, checks
workspace types/policies/dev scripts/lint, runs complete API unit and e2e with
separate unique schema/integration databases, full Web tests, then Python
fixtures. The API test runner uses the assigned container port. Image-gated
Python tests remain for the separate required Docker integration step; this
command does not build images or exercise staging/browser/provider semantics.

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --regression
```

Return full output, exit code, the printed `reports/w7-regression/<run>/`
directory and both printed API Jest evidence directories. The wrapper owns only
its unique fresh container; it never selects an existing target and removes only
that container on exit. Do not start a second heavy check while awaiting this
result. The accepted migration/canonical/DELETE harnesses are not repeated.

The first broad run `reports/w7-regression/20261009080113_546288/report.json`
failed at workspace typecheck (exit 2) after successful packages/API builds.
Removed the V1 status assertion from its mixed contract test, keeping the two
canonical resource/authorization checks, and deleted an unregistered V1-only
runtime-stage fixture. Current contract consumer audit has zero missing named
exports across 1,175 current TS/JS files. Full typecheck is still pending.

For this fixture-only repair, reuse the successful build:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --regression
```

Return complete output, exit code and all printed evidence directories.
Typecheck and the still-unreached broad checks run; accepted canonical/migration/
DELETE harnesses are not repeated. Use normal build mode after any subsequent
production/schema/contract change. No second heavy check starts while pending.

The next broad receipt `reports/w7-regression/20261009080755_567002/report.json`
records exit 1 at API lint. Workspace typecheck, all four static policies and ten
dev script tests passed. Repaired six test files: explicit Promise-returning
mocks, existing typed HTTP/problem helpers, unused imports/loader and obsolete
targeted-reanalysis doubles. Scoped lint has zero errors/warnings and five
focused unit suites pass all 44 tests. No production executable changed.

Continue with the same immediate reuse-build command:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --regression
```

The changed test types and remaining full lint/API/Web/Python checks still need
this user-run proof. Return full output, exit code and all evidence directories;
accepted migration/canonical/DELETE harnesses stay reused.

Broad receipt `reports/w7-regression/20261009081536_585302/report.json`
failed at five typed Jest argument assertions after the mock lint cleanup.
Explicit argument signatures now preserve those assertions and pass a focused
actual TypeScript semantic check (the exact five errors reproduced before, zero
after), scoped lint and all four deletion unit tests. Production source is
unchanged; full workspace typecheck/broad proof is still pending.

The immediate command remains:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --regression
```

Return full output, exit code and all printed evidence directories. Use normal
build mode after any later production/schema/contract change. No second heavy
check starts while this result is pending.

Current preflight is accepted from
`reports/w7-regression/20261009082014_595402/report.json` and its returned console:
workspace typecheck, four source policies, ten dev script tests, full API lint
and Web lint PASS (Web reports 38 warnings, zero errors). API unit execution then
ran 117 passing suite lines before the Node 1,536MB heap limit aborted it; no
final Jest JSON exists in `reports/w4-regression/20261009_082052_597812/`.
The aggregate remains incomplete. Full API e2e/Web/Python were not reached.

The dedicated API runner now uses one recyclable Jest worker instead of
`--runInBand`, honoring the existing 768MB idle-worker limit and preserving
serial database access. A small installed-Jest recycling probe and eight actual
canonical unit tests passed. The full resource behavior still needs the user run.

Continue at the remaining tests, reusing the accepted preflight/build:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --regression-tests
```

Return full output, exit code, the printed RELEASE directory and both API Jest
evidence directories. The tests-only receipt explicitly excludes preflight;
combine it only with the accepted current-source preflight. Use full
`--regression` again after production/schema/contracts invalidate preflight, and
normal build mode when executable source changes. No second heavy check starts
while pending. Image-gated tests remain a separate required proof.

The API unit run now passed:
`reports/w4-regression/20261009_083006_617805/api-jest-results.json`
records 129 suites / 804 tests PASS, zero failures, eight opt-in real-provider
tests skipped. Reuse this result. E2e receipt
`reports/w4-regression/20261009_083106_620958/api-jest-results.json`
records 19 passing suites and one failing owned DELETE test in the assessment
fixture; three opt-in/exact-target suites (21 tests) were skipped.

That fixture starts no Agent Server, so its existing canonical erasure port is
now explicitly doubled. The callback verifies actual owned Root identity and
committed cancellation/revocation; the test checks exact erasure delegation,
row removal, audit and GET 404. Its retired-readiness assertion no longer silently
returns on an obsolete response shape. Scoped type/lint checks pass; actual
native byte deletion remains the separate accepted eight-check RELEASE vertical.

Run only the affected e2e file, then the still-unrun Web/Python groups:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --regression-after-unit
```

Return full output, exit code and all printed evidence directories. This receipt
explicitly excludes accepted unit/preflight/unaffected e2e; combine it with those
saved receipts. It does not claim skipped live-provider/exact-target fixtures
ran. Full regression mode remains available when later source changes invalidate
that reuse. No second heavy check starts while pending.

Affected assessment e2e passed all six tests in
`reports/w4-regression/20261009_084616_654649/api-jest-results.json`.
Combine with the unchanged full e2e suites: `reports/w7-api-e2e-reconciled.json`
records 20 passing suites / 157 tests and three skipped suites / 21 tests,
explicitly not a newly executed full aggregate. API unit 129/804 remains accepted.

Web's first tier then stopped on an obsolete requirement to retain frozen
Interview CI coverage. The mixed workflow test now rejects that path and checks
the current V2 aggregate's required dependencies/failure behavior; all three
focused tests pass. Apps/web's second tier and Python have not run yet.

Continue only Web/Python, with no API or PostgreSQL/Docker fixture repeat:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --web-python
```

Return full output, exit code and the printed RELEASE evidence directory. The wrapper
requires the accepted build, records an explicit Web/Python-only scope and does
not claim skipped API/preflight/image steps ran. Use the full affected modes if
later source changes invalidate that reuse. No second heavy check starts while
pending. The command-routing probe used mocked suite calls only, not a real run.

Web receipt `reports/w7-regression/20261009090249_688328/report.json` records
exit 1: root tier 30 PASS; apps/web tier 295 PASS / seven FAIL, no skips; Python
was not reached. Removed obsolete V1 artifact/evidence-graph/readiness cases,
kept canonical repository/immutable-report coverage, and corrected the sidebar's
same-line JSX assertion. All 30 retained focused checks pass.

An orphan V1 classification/evaluator translation catalog and its sole test
consumer were also physically deleted, including its barrel and three identified
generated files. Isolated i18n build and all current named-consumer closure pass;
canonical resolver/locale/schema remain. Static retirement fence now covers
27 patterns and passes 1,116 files. This does not claim browser/image proof.

Rerun the same Web/Python-only group:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --web-python
```

The Web pretest rebuilds current packages; accepted API/domain/migration/native
DELETE results remain reused. Return full output, exit code and the printed RELEASE
evidence directory. No second heavy check starts while pending.

Current Web is accepted from
`reports/w7-regression/20261009092857_744990/report.json` and returned console:
root 30 PASS + apps/web 292 PASS = 322, no failures/skips. The aggregate exits 2
only because Python collection found one unused import of the already-deleted
_skill_value image-fixture helper. Removed that import; all 1,036 Python tests
now collect in 2.13 seconds. Collection is not test execution/image acceptance.

Run only the remaining Python fixture suite:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --python-only
```

Return full output, exit code and the printed RELEASE evidence directory. This explicit
Python-only scope invokes no Web/API/build or Docker/PostgreSQL fixture. Existing
image-backed tests are still a separate required opt-in proof. Accepted Web/API/
migration/domain/native DELETE evidence remains reused. The executable command
routing probe used mocked calls, not the actual suite. No second heavy check
starts while pending.

Python receipt `reports/w7-regression/20261009094803_784045/report.json`
records exit 1: seven stale layout assertions failed, 1,022 tests passed and
seven image-gated tests skipped. Updated the four mixed tests to preserve
canonical source/dispatch/audit/model checks and require V1 imports absent.
Identified and removed one empty V1 recovery initializer, 46 orphan V1 bytecode
files and seven retired directories after source/magic/co_filename verification;
receipt is `reports/w7-v1-namespace-bytecode-cleanup.json`. No code was executed
by that bytecode inspection, and canonical/customer runtime state was untouched.

All 11 affected focused tests pass. Static source/import checks pass, but full
Python execution still needs the user-run result:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy bash tests/run-release-domain-check.sh --reuse-build --python-only
```

Return complete output, exit code and the RELEASE evidence directory. Accepted
Web/API/native/migration/vertical checks stay reused; image-gated integrations
remain a separate required proof. No second heavy check starts while pending.

1. Close the affected canonical regressions, exhaustive source/import/API/UI/
   worker/merged-image absence and all frozen §12 acceptance rows. Obtain the
   production-shaped staging receipt against the exact release image. Required
   V2 CI suites must pass on the release head.
2. After separate production authorization, quiesce API writers, native
   execution, outbox delivery and scheduled source-change work. Use the accepted
   CUTOVER reconciliation and its actual target identities. Reconcile any pending
   canonical commands through their existing ownership; do not destroy mixed
   generic queues or billing infrastructure.
3. Before the drop, retain CUTOVER archive identities long enough for the external
   eraser to verify them. Supply the actual application/checkpoint database
   URLs through secret environment configuration, explicit database names,
   completed cutover run ID and governed absolute filesystem roots. Never print
   credentials or raw checkpoint/source/report/HITL content.
4. Run the one-off eraser's read-only preflight first. Unknown threads, mixed
   checkpoint records, container mounts, unknown/private files, hash mismatches
   and remote historical report bytes fail closed. Classify them from actual
   ownership and prove erasure before proceeding; a manual unsupported-location
   assertion is not a substitute for byte erasure.
5. Execute the verified inventory. It protects canonical Root/native task/
   transport/Legal Preparation namespaces, other assessments and canonical
   artifact chunks. Reused transport checkpoints and private logs are separated
   by the recorded cutover boundary and canonical metadata. The operation
   writes its archive-fingerprint-bound `W7_V1_PURGE` receipt only after external
   erasure verifies zero remaining legacy targets. Preserve the sanitized
   receipt outside the runtime image.
6. Apply the later RELEASE migration, then release API/worker/Web together. The API
   image's existing migration-on-start must not run ahead of external erasure.
   The SQL refuses archive-bearing targets without the matching purge receipt.
   It drops only V1-only storage and removes the legacy portion of mixed
   journals/commands/audit while preserving canonical ownership and accounting.
   The entire drop is transactional; applied historical migrations stay intact.
7. Once accepted V2 writes exist, repair forward. Do not down-migrate, restore
   V1 runtime authority or introduce fallback/dual writers.
8. Run the separately authorized post-deploy synthetic canary using the actual
   released runtime and synthetic tenants/repositories. Verify legal preparation,
   assessment creation, one Root thread, repository investigation, material
   Human Resolution only, decisions/completion, immutable report, accounting/
   events, isolation and no legacy path. Save bounded sanitized evidence.

The external operation below is **NOT authorized for production execution yet**.
Every variable must come from the actual reviewed target. Supply additional
`--artifact-root` arguments for each uniquely identified archived filesystem
root when the archive requires them; omission fails closed.

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy env PYTHONPATH=deepagents deepagents/.venv/bin/python scripts/purge-retired-assessment-state.py \
  --database-name "${RELEASE_DATABASE_NAME:?reviewed database required}" \
  --checkpoint-database-name "${RELEASE_CHECKPOINT_DATABASE_NAME:?reviewed checkpoint database required}" \
  --run-id "${RELEASE_CUTOVER_RUN_ID:?completed CUTOVER cutover required}" \
  --storage-root "${RELEASE_STORAGE_ROOT:?absolute artifact storage root required}" \
  --workspace-root "${RELEASE_WORKSPACE_ROOT:?absolute V1 workspace root required}" \
  --private-log-root "${RELEASE_PRIVATE_LOG_ROOT:?absolute private log root required}" \
  --corpus-root "${RELEASE_CORPUS_ROOT:?absolute corpus root required}" \
  --receipt "${RELEASE_PREFLIGHT_RECEIPT:?external sanitized receipt path required}" \
  --writers-quiesced
```

After preflight review and separate production authorization, the same command
with `--execute` and an execution receipt path performs erasure. Do not execute
against a database whose live legacy tables have already been dropped: the
retained CUTOVER identity ledger must precede this operation.

The ordered migration is applied by the existing Prisma deployment path,
only after the external receipt exists:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy pnpm --dir apps/api exec prisma migrate deploy
```

The current local session has not run either production command, built/deployed
a release image, completed staging or run a post-deploy canary. Commit/push/PR
and CI repair are authorized after implementation/verification; production is
a separate boundary.

### RELEASE full Python fixture receipt accepted (2026-10-09)

User-run `rtk proxy bash tests/run-release-domain-check.sh --reuse-build --python-only` returned 1,029 PASS / seven image-backed integration SKIP in 8.57 seconds. Verified `reports/w7-regression/20261009104044_884405/report.json`: scope CURRENT_RELEASE_PYTHON_FIXTURE_REGRESSION, exitCode 0. The prior seven stale layout failures are closed by actual full execution, not collection or static checks. Accepted current Web 322, API unit 129 suites/804 tests, reconciled API e2e 20 suites/157 tests with explicit opt-in skips, CUTOVER and RELEASE migration/canonical/domain/native DELETE receipts remain VALID_AND_REUSABLE. No accepted suite is rerun solely to continue this gate.

The seven skips are required Docker-backed tests across repository index/search/coverage, sandbox execution/hydration, native runtime/server dispatch and actual production Agent Server image checkpoint/restart. They remain NOT_PROVEN until the opt-in image group executes without skips. API/Web/worker/server candidate builds, merged-rootfs absence, real browser, production-shaped staging, current-head remote CI and required protection are still pending. RELEASE remains IN PROGRESS; production deployment/data mutation/post-deploy canary remain separately unauthorized.

## Next user-run group: exact candidate image proof

Accepted full Python receipt: `reports/w7-regression/20261009104044_884405/report.json`
records exit 0; returned output has 1,029 PASS / seven Docker-backed SKIP in 8.57s.
Accepted Web/API/canonical/native/migration/DELETE receipts remain reusable.

Run this single heavy group:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy deepagents/.venv/bin/python tests/release-images.py
```

It builds the four existing candidate Dockerfiles into unique tags and records
content image IDs, canonical source hashes and build/policy inputs. Each image
is audited through an owned stopped/read-only/network-disabled container export;
no audit container is started, no mounts/ports/credentials are supplied and the
API migration-on-start command never executes. The parser checks merged
application files, canonical source hashes, built runtime markers, all 461 deleted
paths/compiled variants, 27 existing retirement patterns and absence of private
state/nonempty workspaces. No tar extraction or symlink traversal occurs. It
preserves historical SQL and accepted official legal source artifacts; dependency
internals are outside the LCSP architecture proof, installed LCSP tools included.

Then it runs exactly the existing seven Docker-backed integrations using the
pinned worker/server image IDs and an environment without ambient application
settings/dotenv. The production-image fixture now requires a real checkpoint ID
and identical checkpoint/state after restart, plus the hydrated health marker.
JUnit requires all seven named cases to execute and pass, zero skips. This is
image/checkpointer/sandbox proof, not full Assessment Root staging semantics.

Send complete output, exit code and the printed evidence directory, including
report.json and any failing <role>-rootfs.json. Reports contain hashes/metadata,
not source or customer payloads. Only owned stopped audit containers/temporary
exports and the existing integration-owned resources are cleaned up; unique
candidate images and evidence remain for the later exact-image staging gate.

Local parser/mutation/source/CI checks passed; actual builds/Docker integrations
have not run. The required CI Docker job calls the same runner and uploads its
evidence, but current-head remote results/branch protection remain unproven.
Do not run another heavy group while this result is pending. Browser/staging
and frozen acceptance reconciliation follow this receipt. Production deployment,
production mutation and the post-deploy canary still require separate authorization.

### First image attempt failed; rerun after packaging repair (2026-10-09)

The preserved `reports/w7-images/20261009111650_3d1137e87495/report.json`
records API build success followed by merged-rootfs FAIL (73 private/fixture
members, 117 retired directories). Other image builds and Docker integrations
were not reached. That candidate contains private local state and is ineligible
for push/deployment/staging. Its failed receipt remains unchanged.

Root cause: root-only context exclusions missed nested state, empty V1 source
directories remained, and Prisma generated an API cache during build. Fix:
recursive private/fixture exclusions, image-only removal of the generated cache,
and verified-empty-directory removal (125 directories, zero files removed).
The stricter parser rejects empty retired roots, CLI/MCP state and private parents
of `.env.example` while allowing canonical templates. Host private state remains.
Focused parser/source/CI checks pass; rebuilt image proof is still pending.

Run this one heavy group again from the canonical checkout:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy deepagents/.venv/bin/python tests/release-images.py
```

Send complete output, exit code and the new evidence directory. Dependency layers
may be cached; all candidate image/audit receipts must be fresh for the changed
inputs. Accepted broad fixture/canonical/migration/DELETE suites do not need a
repeat for this packaging change. Browser, staging and current-head remote CI
remain later gates. Production deployment remains separately unauthorized.

### Second API attempt: private-state checks passed, empty contract roots corrected

`reports/w7-images/20261009113812_ab4646d470d5/report.json` remains FAIL.
API built successfully; its actual merged filesystem contains no private-state
violations, but three empty retired contract namespaces remained. Root cause:
the earlier directory cleanup omitted contracts. Fix: removed only verified-empty
`packages/contracts/src/{document,legacy-migration,scan}` with `rmdir`; zero files
removed. No application/build/audit code changed. The complete current forbidden
namespace census now passes 1,727 application paths with zero matches, and all
1,074 canonical source hashes match the latest build receipt.

Run the same single image group again: `rtk proxy deepagents/.venv/bin/python
tests/release-images.py` from the canonical checkout. Return full output, exit
code and the new evidence directory. The other image builds and seven Docker
integrations have not run; both failed candidates remain release-ineligible.
Do not repeat accepted broad/canonical/migration/DELETE suites for empty-directory
removal. Browser/staging/current-head remote CI remain later gates; production
deployment remains separately unauthorized.


### Four image audits passed; rerun after health dispatch repair

`reports/w7-images/20261009114514_b28756566ec0/report.json` records all four
candidate builds and merged-rootfs audits PASS (API 3,417 / Web 2,966 / worker 196 /
server 197 files). The image aggregate remains FAIL: seven Docker cases executed,
four passed and three Agent Server health dispatch cases failed, zero skips.
The production-image restart assertion was not reached successfully.

**Root cause:** the internal health boundary still expected generic dispatch to
activate a repository after RELEASE moved hydration into each owning boundary.
**Fix:** health now validates snapshot/scan identity, resolves the native thread
sandbox, hydrates its pinned synthetic snapshot and scopes its existing read/write
through the existing activation helper. Root/Legal Preparation ownership is intact.
The real native graph reproduced the error before the fix; focused sync/async,
concurrent-thread and error-path checks now pass: 25/25, zero skips, 1.617 seconds.
`reports/w7-health-dispatch-repair.json` records the bounded repair and evidence.
These focused checks mock hydration and do not establish Docker/restart acceptance.

One canonical source file changed after the four candidate builds. Keep their
successful rootfs receipts as pre-repair evidence; fresh builds/audits must match
the current health source. Run this single heavy group again:

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy deepagents/.venv/bin/python tests/release-images.py
```

Return full output, exit code and the new evidence directory. Do not start a
second heavy group while waiting or repeat accepted broad/migration/DELETE suites
for this isolated health repair. Browser, production-shaped staging and current-head
remote CI remain later gates. RELEASE is incomplete; production deployment/data mutation
and the post-deploy canary remain separately unauthorized.


### RELEASE current-source image gate accepted (2026-10-09)

User-run `rtk proxy deepagents/.venv/bin/python tests/release-images.py`
completed successfully. Verified `reports/w7-images/20261009121713_976c762ea276/report.json`:
status PASS, exitCode 0, no production deployment. All four existing candidate
Dockerfiles built and their actual merged filesystems passed: API 3,417 / Web
2,966 / worker 196 / production Agent Server 197 application files. Each rootfs
receipt has zero violations. Current workspace still matches all 1,074 canonical
source hashes and all 22 build/policy inputs in candidate-source.json.

Exact candidates for the next isolated staging gate:

| Role | Immutable image ID |
| --- | --- |
| API | `sha256:b435f935008cc14f757d22937d47d5f0add1f91157879b185cfef3e22c39c946` |
| Web | `sha256:a53a4bebb21f2c0bb1a64f06d1c4086a5dc8f859fe3a8fad7974bf0afcde7737` |
| Worker/sandbox | `sha256:3beb058cce9946882635d9f28bd9e1b7bac7b2e10f5d41982be2bcd8d329fa01` |
| Production Agent Server | `sha256:b5710ac0515de260ba840dc21198f016fec87c3cf58d9313d9722fd1e07e4527` |

Docker JUnit confirms exactly seven expected integrations PASS, zero failures,
errors or skips, 50.286 seconds. Both native Agent Server dispatch variants now
pass; the actual production image also proves a nonempty native checkpoint and
identical checkpoint/state after restart on its owned PostgreSQL database. This
closes the health dispatch failure and separately required seven skipped Docker
cases. It proves image/server/checkpointer/sandbox mechanics; it does not prove
canonical Assessment Root semantic staging, automatic official-source Legal
Preparation, the cross-assessment raw-canary matrix or browser flows. Earlier
failed receipts remain unchanged and failed candidates are not promoted.

Current static refresh: `rtk proxy env NODE_OPTIONS=--max-old-space-size=1536
pnpm run typecheck`, `rtk proxy pnpm run check:imports` and `rtk proxy pnpm run
check:contracts` all exit 0. Receipt: `reports/w7-current-source-verification.json`.
Prisma client generation/typecheck did not connect to or mutate an application
database. No accepted broad/API/Web/canonical/migration/DELETE suite was repeated.
No runtime source, Dockerfile or CI input changed after this accepted image run.

The image gate is PASS / VALID_AND_REUSABLE while those inputs remain unchanged.
Do not rerun it solely to move forward. Next RELEASE work is isolated production-shaped
canonical staging/browser acceptance against these exact images, with disposable
API/PostgreSQL/broker/native checkpoint resources and synthetic tenants/repositories.
Review all 25 Freeze §12 rows using their exact evidence scope; retain accepted
semantic receipts but do not substitute fixtures or health-graph persistence for
missing staging rows. Current-head remote CI/required protection and final frozen
acceptance reconciliation remain required. RELEASE remains IN PROGRESS; production
deployment/data mutation/post-deploy canary remain separately unauthorized.
# Isolated staging with the accepted images (2026-10-09)

The user selected an isolated disposable stack. Run the verification-only launcher below; it does not rebuild or modify the accepted images. Its default candidate is `reports/w7-images/20261009121713_976c762ea276`, and it rejects changed source/build inputs, failed or skipped Docker integrations, and failed merged-rootfs audits before creating resources.

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py
```

The launcher creates a uniquely labelled Docker network, fresh PostgreSQL application/checkpoint databases, RabbitMQ, the production API and Agent Server, a RabbitMQ bridge using the verified worker image, and the production Web image. Published API/Web/Agent Server/PostgreSQL ports bind only to loopback. The API image applies its own historical migrations; readiness checks all 29 retired tables are absent and all 14 current boundary queues have a consumer. Browser fixture accounts are registered through the real API; only the fixture administrator's role is promoted in this newly created database. No corpus, portfolio, repository, decision, or completed assessment is fabricated by the launcher.

Only `LLM7_API_KEY`, `GOOGLE_API_KEY`, and `GEMINI_API_KEY` are selected from the launching process/root `.env`; process values take precedence. The configured LLM7 primary key is required before resource creation. Other database, broker, API, tracing, credential, and model-endpoint settings are generated or fixed for this owned stack. Provider calls during subsequent semantic checks use these real keys. SMTP, OAuth and payment-provider integrations are not acceptance evidence from this launcher.

Return the sanitized terminal output and `reports/w7-staging/<runId>/report.json`. Browser URLs appear there; account passwords and stack credentials remain in the mode-600 `tmp/staging/<runId>/access.json`. Container diagnostics and native private logs also remain under that private run directory. Keep the stack running for the browser and canonical semantic checks. `READY_FOR_ACCEPTANCE` proves service/migration/consumer readiness; it does not pass the frozen 25-row staging matrix, browser acceptance or release acceptance.

The terminal prints an exact `--stop <runId>` command. Teardown verifies daemon, container/image/network ownership and removes only that run's containers/network and native sandboxes tied to its own database threads, excluding every container present before launch. The broad sandbox reaper is disabled. Private local evidence is retained for review. Production deployment, production data mutation, and a post-deployment canary remain outside this action.

Preparation verification: `rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --self-check` passed accepted-receipt/hash checks and stale-candidate, credential, loopback, private-file and cleanup-ownership mutations. No Docker stack or model was started for this self-check.

### First isolated launch failed; broker CLI repair (2026-10-09)

Run `3e99dadafc054c62` remains FAIL in its original readiness receipt. Only fresh PostgreSQL and RabbitMQ containers were created; no application service, fixture account or model call started. The 96 prelaunch containers remain protected by the private ownership manifest.

**Root cause:** The launcher ran `rabbitmq-diagnostics` as root while the image starts the broker as UID 999 (`rabbitmq`). Both use `/var/lib/rabbitmq` as HOME. The early CLI probe raced startup and created `.erlang.cookie` as root, mode `0400`; the broker then failed with `Error when reading /var/lib/rabbitmq/.erlang.cookie: eacces`. Read-only inspection confirmed cookie UID/GID 0/0, parent directory UID/GID 999/999, and the image entrypoint's switch to `rabbitmq`.

**Fix:** Both the readiness probe and queue-consumer query now use `docker exec --user rabbitmq`. The local self-check passes and rejects the original root CLI calls. No accepted application image/source/build input changed. The subsequent user-run launch passed broker readiness and created the Agent Server, then hit the separate HTTP readiness failure described below. Receipt `reports/w7-staging-broker-repair.json` records that bounded revalidation.

First remove only the failed run with its ownership-checked teardown:

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --stop 3e99dadafc054c62
```

After teardown returns `STOPPED`, run the launcher command above to create a fresh run. Preserve the original failed receipt and private diagnostics. Do not retry against the failed run's volume or rebuild the verified application images.

### Agent Server startup readiness repair (2026-10-10)

The first run's owned teardown passed: two owned containers, zero sandboxes removed; private evidence retained. The subsequent run `3d616e5b9a994237` passed PostgreSQL and RabbitMQ readiness, then failed with `ConnectionResetError` during the first Agent Server HTTP check. Its original FAIL receipt remains unchanged. No API, bridge, Web, account or assessment had been created.

**Root cause:** `Stack.wait` retried `URLError` and timeouts but did not catch `ConnectionError`, so a reset from the published port before Uvicorn finished startup aborted the launcher. Read-only diagnosis after the failure confirmed a healthy Agent Server and HTTP 200 from `/health`; logs show application startup completing after the early probe. On the latest inspection, all three owned containers are stopped but still present.

**Fix:** The shared readiness loop now catches `ConnectionError` alongside its existing retryable probe errors. The original deadline remains fixed, and container exit is still checked outside the retry block. Local self-checks prove reset then success, persistent resets reaching the deadline, and immediate failure without an HTTP probe when the container is stopped. A real disposable loopback HTTP server also proves a dropped first response is retried through `http_ok` and the next HTTP 200 succeeds. No Docker stack or provider was started by these checks. Receipt: `reports/w7-staging-http-readiness-repair.json`.

The second failed run was subsequently removed by this ownership-checked group:

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --stop 3d616e5b9a994237
```

Teardown returned `STOPPED`, three owned containers and zero sandboxes removed. The following fresh launch passed readiness as recorded below. Both original failed readiness receipts remain unchanged.

### Exact-image staging ready; bounded browser checks passed (2026-10-10)

Run `0dbb678215974a1b` returned `READY_FOR_ACCEPTANCE` using the four accepted candidate images unchanged. Read-only revalidation confirms all six owned services running, the same Docker daemon reachable from the Agent Server, 14 boundary consumers, and 29 retired tables absent. The 96 prelaunch containers remain outside cleanup ownership. Readiness receipt: `reports/w7-staging/0dbb678215974a1b/report.json`.

Playwright MCP opened the actual production Web image at `http://localhost:32772`. Owner sign-in and minimal name/description assessment creation passed with HTTP 200/201. Detail, reload and read-only PostgreSQL inspection agree on PREPARING / QUEUED, lifecycle revision 1, event sequence 1 and the same native thread; no human request or initial interview exists. Artifacts renders its empty state. A second fixture user sees zero assessments and receives `404 ASSESSMENT_NOT_FOUND` for the owner's detail, human requests and repository setup, with no owner name rendered. Administrator Legal preparation returns HTTP 200, shows an empty history and disables Start preparation without a corpus; no approval button is exposed. Receipt: `reports/w7-staging/0dbb678215974a1b/browser.json`.

The successful owner flow had zero console errors/warnings. The six later resource errors are the three expected foreign-access 404s with client retries; no unexpected JavaScript error was observed. Chrome DevTools MCP could not start because the headful browser has no X server. Playwright console/network/DOM and private screenshots were used; DevTools and complete browser acceptance remain unproven. The stack has no source corpus or active portfolio yet, and no live model has been called. Keep this stack running for the next group.

### Next single user-run group: live synthetic Legal Preparation

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-legal-preparation.py 0dbb678215974a1b
```

The verification-only runner attaches to this exact owned stack; it does not start another stack or rebuild images. It checks accepted source/image inputs, daemon/service ownership and actual published endpoints before writes. It reuses the existing reviewed synthetic source bytes, verifies every pinned source/chunk hash, and seeds only a DRAFT source corpus plus the eval's VALID retrieval-index precondition in the fresh disposable database. The manifest explicitly identifies synthetic input. It does not seed a portfolio, legal/engineering rules, preparation run or activation.

The runner starts and replays one idempotent preparation through the real API. The existing outbox, broker bridge and production Agent Server must execute the configured provider; the governed API must persist SUCCEEDED / ACTIVE / PASSED and one activation. It reads the actual ACTIVE portfolio and checks a native Agent Server checkpoint. Public output is sanitized; generated rules, logs and diagnostics stay in `tmp/staging/0dbb678215974a1b`. Return the terminal output and `reports/release-staging/0dbb678215974a1b/legal-preparation.json` before starting another heavy group. The 20-minute limit bounds observation only: a timeout leaves the runtime running, and rerunning reattaches through the same idempotency key.

Local self-check, Python syntax, exact-target guard and real PostgreSQL EXPLAIN/rollback passed; no corpus row or provider call resulted. Preparation receipt: `reports/w7-staging-legal-preparation-preparation.json`. A runtime PASS from this group is synthetic-fixture mechanics, not official-source acquisition, live retrieval-index construction or semantic acceptance. Review generated output against the existing six-dimension `deepagents/tests/fixtures/legal_preparation_eval/rubric.json` before accepting meaning. Failed-attempt preservation of earlier ACTIVE, Assessment Root/HITL/Stop/Continue/browser flows, the remaining frozen 25-row matrix and current-head remote CI are separate pending scopes. RELEASE remains IN PROGRESS and releaseEligible remains false.

### Live legal claim rejected; callback identity repair (2026-10-10)

**Root cause:** Preparation `619b8e52-c3c0-4152-8760-c012c4509fc3` remained QUEUED after its outbox became PUBLISHED. The command reached the production Agent Server, but `WorkerApiClient._post_with_retry` sent its native run ID as `x-lcsp-runtime-run-id`. The global API fence interpreted that ID as an assessment turn and rejected both legal claim and failure reporting with HTTP 409 / `RUNTIME_CONTROL_TARGET_STALE`. The legal runner returned FAILED after rejected failure reporting; the outer native run settled successfully and the broker acknowledged delivery. No model was reached. Empty queues and healthy consumers therefore do not establish successful preparation.

**Fix:** Remove the assessment turn header from the shared non-assessment callback method. Worker authentication, correlation, cancellation checks and legal domain validation remain; assessment stream callbacks retain their separate fence. Eight callback regression cases reproduced the 409 before the change; the 50-test focused client/legal/acquisition/trigger/cancellation group now passes with zero skips. Real API negative probes target a verified nonexistent UUID: the erroneous header yields 409, its absence yields `404 LEGAL_PREPARATION_RUN_NOT_FOUND`, and the patched client reaches that same legal-domain 404 under a native run context. No preparation was created or claimed by those probes. Receipt: `reports/w7-legal-callback-fence-repair.json`.

Exactly one of the 1,074 canonical source files changed; the other 1,073 and all 22 build/policy inputs match the prior accepted candidate. Original image, readiness and browser receipts remain historical evidence. The running images still contain the bug and require rebuilding. Stop the observer with Ctrl+C if it is still polling; that stops observation only. Do not reset/requeue the outbox, patch containers, or rerun the old preparation hoping for another delivery.

Next SINGLE USER-RUN GROUP:

```bash
rtk proxy deepagents/.venv/bin/python tests/release-images.py
```

Return the full output and new evidence directory. After the new gate passes, bind the staging launcher to that exact accepted receipt, tear down only owned run `0dbb678215974a1b`, and launch fresh staging as separate user-run groups. Keep the old stack for diagnostics until that handoff; its private evidence is retained by owned teardown. Live provider, semantic and frozen staging acceptance remain NOT_PROVEN; production deployment remains separately unauthorized.

### Rebuilt candidates accepted; owned teardown is next (2026-10-10)

The user-run image gate returned PASS in `reports/w7-images/20261009181442_9b189dd78d33/report.json`: four merged-rootfs audits and all seven required Docker integrations, zero failures/errors/skips, 50.908 seconds in JUnit. Read-only revalidation matches all 1,074 current source hashes and 22 build/policy inputs; all four exact images are present locally. `tests/staging-stack.py` now selects this receipt, and both staging launcher and legal-preparation runner self-checks pass. The callback repair is packaged and image-verified; real legal claim/provider/activation acceptance remains pending.

Old run `0dbb678215974a1b` still has six running services with matching saved image ownership and Docker daemon. Its 96 prelaunch containers remain protected. Teardown reads that run's original private manifest, independently of the new candidate pointer. Original readiness/browser/preparation evidence remains historical; it does not establish acceptance for these rebuilt candidates. No teardown, new stack or model invocation was run locally.

Next SINGLE USER-RUN GROUP:

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py --stop 0dbb678215974a1b
```

Return the `STOPPED` output and teardown receipt before the next group. Then launch fresh staging using the newly bound exact images; use its new run ID for preparation. Preserve private diagnostics and do not requeue the settled old delivery. Fresh staging/browser, semantic review, the full frozen 25-row matrix and current-head remote CI remain NOT_PROVEN. RELEASE is IN PROGRESS and releaseEligible is false; production deployment remains separately unauthorized.

### Old owned stack removed; fresh launch is next (2026-10-10)

The user-run teardown of `0dbb678215974a1b` returned STOPPED: six owned containers and zero sandboxes removed; private evidence retained. Read-only verification confirms the saved Docker daemon identity, absence of all six owned containers and the labelled network, and retention of the private manifest. Receipt: `reports/w7-staging/0dbb678215974a1b/teardown.json`. The launcher still selects `reports/w7-images/20261009181442_9b189dd78d33/report.json`; all 1,074 current source hashes and 22 build/policy inputs match, and all four exact candidate images remain present. No image rebuild is needed.

Next SINGLE USER-RUN GROUP:

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-stack.py
```

Return the readiness output and new run ID before the live-preparation group. No fresh stack or provider invocation was started locally. Fresh staging/browser, legal claim/provider/activation, semantic review, the frozen matrix and current-head remote CI remain NOT_PROVEN; RELEASE remains IN PROGRESS and releaseEligible is false.

### Fresh rebuilt-image readiness verified; live preparation handoff (2026-10-10)

Run `8ddd8be907b646a5` returned READY_FOR_ACCEPTANCE against `reports/w7-images/20261009181442_9b189dd78d33/report.json`. Read-only verification passes the production preparation runner's exact service/image/daemon/endpoint guard. All six owned services are running, all 14 canonical boundary queues have one consumer and zero ready/unacknowledged messages, and all 29 retired tables remain absent. The current 1,074 source hashes and 22 build/policy inputs match accepted candidates. Readiness receipt: `reports/w7-staging/8ddd8be907b646a5/report.json`. Old run `0dbb678215974a1b` is STOPPED and its original diagnostics remain historical.

Fresh legal corpus/preparation/portfolio/activation counts are all zero. The existing 15-chunk synthetic fixture passes pinned-byte checks, and the runner's local self-check passes. No corpus was seeded, preparation control created or provider invoked locally. Its prior PostgreSQL EXPLAIN/rollback result remains explicitly historical; the actual user-run command owns current fixture insertion and execution.

Next SINGLE USER-RUN GROUP:

```bash
rtk proxy deepagents/.venv/bin/python tests/staging-legal-preparation.py 8ddd8be907b646a5
```

Keep this stack running and return the terminal output plus `reports/w7-staging/8ddd8be907b646a5/legal-preparation.json` before the next group. The 20-minute observer deadline does not cancel the runtime. The runner seeds only reviewed synthetic corpus/index preconditions; the real API/outbox/broker/server/provider must produce governed portfolio activation. A PASS establishes bounded runtime mechanics; generated rules still require the existing six-dimension rubric review. Official acquisition, live index construction, prior-ACTIVE preservation on failure, fresh browser/Assessment Root/control flows, the full frozen matrix and current-head remote CI remain NOT_PROVEN. RELEASE remains IN PROGRESS and releaseEligible is false.

### RELEASE preparation model outage and direct test execution (2026-10-10)

**Root cause:** Owned run `8ddd8be907b646a5`, preparation `913f2ab6-68cf-4708-a0bc-73caf81302df`, reached the configured provider but MiniMax `minimax-m2.7` returned HTTP 400 `model_unavailable`. The real API persisted its claim and FAILED / MODEL_ERROR outcome. The original failure receipt is retained unchanged.

**Fix:** The user selected the existing Gemini route. Only `legal-preparation` now resolves to `fallback` (`google_genai:gemini-3.5-flash-lite`). A minimal live response passed; the affected routing/preparation/schema checks passed 270 tests with no failures or skips. The prior focused outage-policy group passed 304 tests. The changed candidate is undergoing the full four-image merged-rootfs and seven-Docker-integration gate before a fresh owned stack and preparation. Receipt: `reports/w7-legal-model-route-repair.json`.

The user explicitly superseded the earlier user-run-only verification constraint: the agent may now run all tests and disposable staging/provider groups directly. Production deployment/data mutation remain outside this authorization. No provider response alone establishes preparation or semantic acceptance; releaseEligible remains false.

### RELEASE Gemini packet-shape diagnostics (2026-10-10)

The four-image gate `reports/w7-images/20261009185215_bffaf5087a64/report.json` passed all filesystem audits and seven Docker integrations. Fresh owned run `215a2dd802c74591` reached readiness. Its real preparation `365ed1ef-7b5f-4576-9b06-3df25cfc97db` then persisted FAILED / NO_SUBMISSION; that original failed receipt is retained. Owner browser sign-in, minimal create and PREPARING/QUEUED reload parity were observed, but this is not a full browser receipt or Root acceptance.

**Root cause:** A separate read-only provider reproduction read the pinned corpus, then repeatedly received generic HTTP 400 for missing packet fields (relationId, explicit nullable targets and nonAssessableReason). The strict API validation endpoint omitted its existing issue-path metadata, and the worker discarded that metadata on submission. The original failed model transcript was not recovered; the reproduction identifies an independently demonstrated repair blocker.

**Fix:** Enable the existing bounded issue-path option on internal validations and forward only bounded packet paths for the legal packet-shape error. Canonical schemas, mechanical validation, activation authority and legal interpretation remain unchanged. No input values or arbitrary problem metadata are forwarded. Python routing/client/preparation checks passed 278 tests; API pipe/controller checks passed 17 tests in two suites; root typecheck passed. The updated four-image gate is running before a fresh owned stack and live preparation. Receipt: `reports/w7-legal-schema-feedback-repair.json`. No reset/requeue or synthetic portfolio activation was used. RELEASE is IN PROGRESS; semantic, full staging/browser matrix and current-head remote CI remain NOT_PROVEN, and releaseEligible is false.

### RELEASE explicit nullable-field packet requirement (2026-10-10)

The schema-feedback candidate `reports/w7-images/20261009233556_afd08ec641c5/report.json` passed all four merged-rootfs audits and all seven Docker integrations (47.885 seconds, no failures/errors/skips). Fresh run `2a36c566096f48c5` reached readiness, but real preparation `ab30912a-85ba-4c61-ae1b-b34e8506fef1` persisted FAILED / NO_SUBMISSION. Actual API logs show 14 validation requests and two rejected submission requests; no portfolio or activation was persisted. Native outer graph success does not establish preparation success. Original failure and bounded diagnostics receipts are retained under `reports/w7-staging/2a36c566096f48c5/`.

**Root cause:** Rejected submissions omitted required nullable `coverage.nonAssessableReason` and `contextRelations.*.toLegalRuleId`. The earlier path-feedback repair now exposes these missing fields, but the provider still treated nullability as optionality. This is observed in actual API rejection metadata; the model transcript itself was not recovered.

**Fix:** Clarify the existing packet instruction: every shown field is required, nullable fields must carry explicit JSON null, and empty arrays must be present. No schema defaults, packet normalization, legal interpretation, activation rule or model-route change is introduced. The 278 affected Python tests pass; a new exact-image gate is running before another fresh owned preparation. Browser checks on the schema-feedback candidate passed owner sign-in/create/reload/database parity, empty artifacts, three foreign-access 404s and admin FAILED projection with no approval buttons. Receipt `reports/w7-staging/2a36c566096f48c5/browser.json` remains PARTIAL: no live Root/HITL/control flow. Chrome DevTools could not start because the environment lacks an X server. RELEASE remains IN PROGRESS and releaseEligible is false.

### RELEASE current exact-image staging outcome (2026-10-10)

Agent-run verification is authorized for tests and disposable staging. Earlier user-command handoffs and pending statuses below are historical; this entry supersedes them. Production deployment and production data mutation are outside this scope.

The latest image receipt is `reports/w7-images/20261009235048_82d862d3af76/report.json`: all four merged-rootfs audits passed with zero retired-path violations; all seven required Docker integrations passed with zero failures/errors/skips (48.127 seconds). The nullable-contract clarification passed 278 focused Python tests. The earlier schema-feedback repair passed 17 API tests and root typecheck; no later TypeScript source change was made.

Owned run `46903a5b798b40aa` reached readiness. Real broker/production Agent Server/Gemini preparation `c1099a17-913c-477c-8e0a-871bcc1f757d` succeeded and automatically activated portfolio `a1faecfb-f443-4cdb-9573-06286052fe3e`: two LegalRules, one EngineeringRule, six context relations, 22 native checkpoints, one logical preparation and one successful activation. Corpus bytes and the VALID index were reviewed synthetic fixture preconditions. This does not prove official-source acquisition or live index construction.

**Root cause:** Earlier packets omitted required nullable keys; the strict backend schema rejected them. The explicit-null instruction and bounded field-path feedback allow the current packet through that unchanged boundary. A separate semantic failure remains: its sole engineering criterion collapses the duty to seven-day retention, dropping receipt-based timing, the test-record exception and notice-text preservation; REL-6 wrongly applies an EXCEPTION relation to Article 6, which the source expressly excludes from the exception.

**Fix:** The packet-shape repair is verified through real activation. No deterministic legal rewrite, semantic validator, new model route or approval workflow was introduced. Semantic acceptance is FAIL for this generated output; fixing its derivation and relation meaning remains necessary before RELEASE acceptance. See `reports/w7-staging/46903a5b798b40aa/legal-semantic-review.json` for the reasoned six-dimension review.

A separate intentionally REJECTED empty corpus without a valid retrieval index exercised the real broker/server/provider/submission path. Preparation `257acfe6-eba3-477a-8c28-b93a59c4a1b6` persisted FAILED / PORTFOLIO_VALIDATION_FAILED with EMPTY_PORTFOLIO and RETRIEVAL_INDEX_NOT_VALID. Its portfolio is INVALID, its successful-activation count is zero, and the prior ACTIVE API payload remains exactly unchanged. No manual failure callback, reset, requeue or runtime cancellation was used.

Playwright MCP verified real owner login, minimal name/description create (201), PREPARING/QUEUED canonical database parity and reload, pinning the active portfolio, no initial human request, empty artifacts, other-account list/detail/human-request/repository isolation, and admin success/failure projection with no approval controls. Successful owner/admin flows had zero console errors or warnings; foreign-access resource 404s were expected. The three final screenshots were visually inspected. Chrome DevTools remains unavailable because its headful browser cannot start without an X server. Browser acceptance is PARTIAL: live Root/HITL/control flows were not exercised.

Authoritative current receipt: `reports/w7-staging/46903a5b798b40aa/acceptance.json`. The complete frozen 25-row staging matrix and current-head remote CI remain NOT_PROVEN. RELEASE is IN PROGRESS and releaseEligible is false. Owned teardown completed STOPPED: six containers and zero sandboxes removed; exact owner scope and prelaunch protection were retained. Receipt: `reports/w7-staging/46903a5b798b40aa/teardown.json`. Retained private files are not public provider-transcript evidence.

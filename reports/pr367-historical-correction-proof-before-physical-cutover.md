> Historical correction proof before the final physical terminology cutover. Preserved verbatim below.

# PR #367 current correction proof

Status: **PASS_LOCAL_ACCEPTANCE_READY_FOR_PUBLICATION**. `releaseEligible=false` pending exact pushed-HEAD CI. The current correction is ready for the authorized commit/push to existing PR #367.

The current branch is `feat/LCSP-357-hard-delete-legacy-architecture-and-prove-release-readiness` and HEAD remains `7e29f3182b6cdb479d802c28b2c480770dec5edf`. It is the existing PR #367 branch. All 61 starting untracked paths remain present; no reset, stash or clean was performed.

## Actual defects and corrections

- Ignored generated `.next` types referenced deleted Legal Portfolio routes. Only generated `.next` state was removed.
- The conversation fixture repeated required usage properties before spreading the same object. The duplicate properties were removed without changing totals.
- UI constants repeated authoritative contract literals. They now reference canonical contract constants.
- Evidence invalidation selected the physical `engineeringRuleId` column without its canonical `assessmentRuleId` alias. A migrated PostgreSQL regression reproduced the missing-key failure; the one-line alias fixes it.
- Root instructions misspelled `get_pinned_rule_set`. Both occurrences now name the existing tool.
- A service integration guard searched for a renamed trigger instead of the preserved physical trigger. Its real database assertions now execute.
- Current dev-seed/runbook wording and staging helpers retained old terminology or the removed generic Start flow. Helpers now activate the Legal Source through the governed API, observe automatic preparation, and use the bounded retry UI.
- A real browser showed a misleading pause notice during Human Resolution waiting. The projection now distinguishes canonical waiting states from pause/recovery. The chat main-content landmark is restored.
- The active-card native title hint was replaced by the shared Tooltip.
- Gemini authored a packet missing a material direct definition reference and then twice failed V2 preparation with schema omissions. The user approved switching only Rule Set Preparation to the existing APX primary route.

## Source and PostgreSQL gates

| Command/proof | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm run check:imports` | PASS |
| `pnpm run check:contracts` | PASS |
| `pnpm run check:legal-v1-retired` | PASS; 1,158 files, 27 patterns, zero references |
| Existing Rule Set lifecycle integration plus SQL-alias regression | 14 PASS, zero skips |
| Rule Set service integration with physical-trigger guard enabled | 18 PASS, zero skips |
| Affected Web group | 31 PASS, zero skips |
| Tooltip/admin regression after final Tooltip edit | 3 PASS |
| Root/trigger focused group | 48 PASS |
| Preparation route/agent/provider-schema focused group | 279 PASS |
| Terminology migration rehearsal | 6 checks PASS |

PostgreSQL used one disposable container on `127.0.0.1:55446`, with lifecycle and upgrade databases inside it. The helper applied all 106 migrations for the lifecycle proof. Upgrade rehearsal deployed 105 prior migrations, seeded historical rows and all renamed enum labels, deployed the terminology migration, and verified preserved table/column/type OIDs, constraints, triggers and data. All three undelivered routing keys changed; published/cancelled history remained unchanged. The renamed coverage CHECK still rejected contradictory data; repeated deploy was a no-op. The owned test container was stopped and removed. `fogewise-*` was untouched.

Receipts: [source gates](pr367-correction-source-gates.json), [lifecycle](pr367-rule-set-lifecycle.json), [service](pr367-rule-set-service.json), [migration](pr367-terminology-migration.json), [Root tests](pr367-root-focused.xml), [route tests](pr367-preparation-route-focused.xml).

Remaining old-name hits are classified in the source receipt: physical schema mappings/SQL fixtures, retirement checks, and historical/pre-freeze documentation. Active product copy, symbols and helper descriptions use the new vocabulary. Physical schema was not recreated.

## Live-acceptance candidate before CI formatting

Candidate `20261011201401_b17f791a42ea` passed four merged-rootfs audits and seven Docker integrations, with zero failures/errors/skips. Frozen bytes still match all 1,116 source fingerprints and 23 build/policy inputs after the test-only CLI fixture repair. No additional candidate was built for that excluded test fixture.

| Role | Immutable image ID |
|---|---|
| API | `sha256:619b626197f0ad20f695f6af035d4aa6ef2f3b476bc6694caafec86c38650269` |
| Web | `sha256:132bf40dcc0e1e90758ed23efdf36da580151cb24e17145052d76ea92b1cc95d` |
| Worker | `sha256:60196789a00fef340c303b8df396715a18bd453a6fbb32acf618baa4c0a465f7` |
| Agent Server | `sha256:6d06bff851838e7f0c5a920779ae8075d79bd91315f58c1e31c9b900dcd2cb21` |

[Candidate receipt](release-images/20261011201401_b17f791a42ea/report.json). The earlier passing candidate `20261011192900_a4fb9c5af669` is historical after the governance source change.

## Preserved first-slot failure

Owned staging `9ae7757edbaf422b` reached READY_FOR_ACCEPTANCE on the corrected images. Playwright ran with `--workers=1` against the production Web image. The browser proved no generic Admin Start/source-selection control and one automatic preparation after governed source activation/replay.

Preparation `4ea63e12-4c0e-47f5-83a3-021f45f1be81` then persisted `FAILED / MODEL_ERROR`, with no rule-set or activation. APX returned HTTP 429, `insufficient_quota / allowance_exhausted`, reporting that its monthly allowance is used up. Original failure and redacted diagnostics are retained. The canonical-governance defect explains why this original run never rotated beyond slot one; the bounded retry succeeded after exact-image refresh.

Current receipts: [staging readiness](staging/9ae7757edbaf422b/report.json), [failed preparation](staging/9ae7757edbaf422b/rule-set-preparation-4ea63e12-4c0e-47f5-83a3-021f45f1be81.json), [provider diagnostic](staging/9ae7757edbaf422b/provider-diagnostics.json), [browser phases](staging/9ae7757edbaf422b/browser-full-flow.json).

## Fresh corrected acceptance

The four app services in the same owned isolated staging `9ae7757edbaf422b` were refreshed to the exact current candidate, preserving the original failed run. Its disposable database/broker and configured 7 APX / 6 Gemini / 12 Inception credential pools were retained. No duplicate app/browser stack or second PostgreSQL was created.

The retry `1f6dadac-4457-473a-87a6-3297aef9ffa8` attempted three APX slots in bounded order: the first two returned monthly allowance exhaustion once each, slot three succeeded, and later APX slots plus Gemini/Inception were untouched. Safe evidence contains counts and 12-character fingerprints only. One successful packet submission activated V1 `78261f5b-bb2e-4316-a171-bc3315ac2aa3`; its semantic review passed 6/6.

A and B were created in the UI and pinned that same V1, adding zero preparation runs. Activating source V2 via the governed API automatically produced preparation `b0ba913b-1d21-4a18-b273-ba52b3e83ef6` and ACTIVE rule set `1531de0b-29c1-4e82-8781-58c4e16f16a1`, with semantic review 6/6. A's paused V1 case and full decision rows remained byte-for-byte unchanged; new C pinned V2. The source activation replay retained its one durable event/run.

Actual Roots A and C investigated the approved immutable repository commit `c14f518437c1b8cef94b4f9a176c04b1acaff6fe`, opened one material public-service scope question each, accepted the answer inline, and persisted APPLICABLE/NON_COMPLIANT with C-1 NOT_MET and C-2/C-3/C-4 MET. C-1 cites the explicit draft-timestamp retention defect. C's complete text-processing search absence supports MET for text integrity; absence did not cause automatic non-compliance. Only persisted decisions, explanations, evidence and tool/event records were reviewed.

Twenty-three selected corrected Playwright phases passed with workers=1 on the production Web image. Real Playwright MCP confirmed one chronological conversation, compact expandable work groups, inline Human Resolution and accepted-answer history, no duplicate activity in context, Stop/reload PAUSED with zero spinners, same-thread Continue, COMPLETE/report actions, scroll-follow/Jump to latest, and a 390px responsive context Sheet. Both browser downloads matched immutable stored hashes. Expected credential reauthentication 403, tenant refusal 404, and post-delete 404 are classified; unexpected console errors/network failures are zero. Three original failed attempts remain preserved: old first-slot governance failure, an initial history-count observer bug, and C's premature completion observation before its material question was answered. Chrome DevTools was unavailable because no X server is installed.

Accounting: A 17 and C 22 SETTLED invocations, totaling 39 / 787,917 Root tokens; both duplicate usage callbacks returned 201 with unchanged totals. Preparation has 5 successful provider responses and one submission per version, totaling 10 / 211,550 provider-reported tokens from deduplicated native metadata. Overall: 49 successful provider responses / 999,467 reported tokens, plus two rejected quota attempts, matching 51 actual route requests after candidate refresh. Preparation is not attached to a customer Assessment billing ledger; no ledger entries or usage estimates were fabricated. Customer credits charged: zero. No provider usage was returned for quota rejections.

The matrix is reconciled **25/25: 20 current rows, five explicitly retained unchanged backend invariants** (crash recovery, shared-memory citation rejection, stale-case reinvestigation, concurrent execution isolation, prior restore/rollback proof). Current PostgreSQL alias/invalidation and terminology upgrade supplement those retained invariants. This is not a claim that every historical scenario was rerun. The original matrix is saved under historical staging; old staging images/browser/CI are not proof of the corrected UI or provider integration.

C's explicit UI deletion erased its domain/native state and preserved A. Final owned teardown removed six containers and one remaining sandbox. Only `fogewise-postgres`, `fogewise-redis`, and `fogewise-rabbitmq` remain running, unchanged.

Receipts: [browser acceptance](staging/9ae7757edbaf422b/browser-correction-acceptance.json), [MCP chat](staging/9ae7757edbaf422b/chat-mcp-acceptance.json), [routing](staging/9ae7757edbaf422b/preparation-provider-routing.json), [accounting](staging/9ae7757edbaf422b/live-primary-accounting-summary.json), [semantic review](staging/9ae7757edbaf422b/assessment-root-acceptance.json), [matrix](staging-acceptance-matrix.json), [teardown](staging/9ae7757edbaf422b/teardown.json).

## Preserved first-attempt evidence

Candidate `20261011181622_430ea3ff8aeb` and staging `a24cb757ce484f9d` are historical after the approved route/UI fixes. Its initial semantic review failed 5/6 because the Assessment Rule omitted Article 1 from its direct source references. Both V2 runs ended `FAILED / NO_SUBMISSION`; V1 authority and the two assessment pins remained unchanged. The deployed Gemini schema diagnostic retained required nullable fields and NULL alternatives; canonical validation was not relaxed.

Its actual Root case investigated the pinned repository, asked one material deployment-exposure question, accepted the inline answer, decided C-1 NOT_MET/C-2 MET and overall NON_COMPLIANT, paused/reloaded/resumed the same thread, completed and downloaded the immutable report. Accounting reconciled 16 SETTLED invocations / 298,889 tokens / zero charged credits, and a duplicate callback changed no totals. These facts do not establish acceptance for the corrected images. Owned teardown removed six containers and one sandbox; private evidence remains retained.

## Publication and enforcement

Local acceptance is complete. The authorized correction commit/push and PR #367 body/screenshot update follow; exact pushed-HEAD remote CI is still pending at this report snapshot. The PR body and GitHub checks will bind the published HEAD to these frozen candidate bytes. Existing PR #367 CI at `7e29f318...` remains historical.

GitHub ruleset `18478777` (`develop`) is active, with strict required checks: `Require Jira issue key`, `Docker sandbox E2E`, and `V2 required release gate`. Enforcement was verified read-only; no ruleset mutation was needed.

PR #367 remains unmerged. Production deployment, production database mutation and production canary were not performed.

## Credential governance correction

Preparation now uses the same AgentRoleMiddleware and MODEL_GOVERNANCE_MIDDLEWARE composition as Assessment Root, preserving read-only corpus tools and no subagents. The separate six-retry policy is removed. Real native Preparation graph tests prove APX rotation before Gemini, complete APX/Gemini exhaustion before Inception, immediate success short-circuit, one terminal failure, provider-reported usage attribution and one logical submission. Shared quota classification now excludes depleted monthly allowances from ordinary cooldown recovery. All 208 affected tests passed (`reports/pr367-preparation-governance.xml`); a final 6/6 focused rerun also proves the provider-free CLI fixture (`reports/pr367-preparation-cli-regression.xml`). No routing YAML change was made by this correction. Staging used all configured pools without changing their keys; safe route receipts record fingerprints only. The standalone scripted CLI fixture now omits governance only for its provider-free mock, matching the existing scripted Root fixture; actual SDK routing tests exercise production governance.

## Final publication reconciliation after CI autofix

Correction commit `cbc370e4105b060a3dbbe719eabb01851894c185` was pushed to PR #367. The CI bot then produced `74342ef5722dcb3dcbcc72169a13a19f5ebbb1a3`: formatting and redundant TypeScript non-null assertions across 21 files, including 14 embedded API source fingerprints. All 21 emitted JavaScript ASTs are identical, including flags, operators, literals and children; mutation self-checks reject let/const, boolean and operator changes. All Web/agent source bytes and all 23 build/policy inputs are unchanged. The worker's 198 and server's 199 audited application files remain byte-identical.

An exact-source refresh was necessary because the bot's formatting changes are embedded in the API/Web rootfs. Final candidate **`20261011210628_a047d4ca2aa1`** passed four rootfs audits and seven Docker integrations, zero failures/errors/skips, with all 1,116 source and 23 build/policy fingerprints current. This refresh preserves the earlier live semantic/accounting receipts and does not introduce another model run or provider selection.

Final immutable images:

| Role | Image ID |
|---|---|
| API | `sha256:03f6791f4c985e62d070ad0d4c50d24850f5f7d622106850b0c9b905ecf49ca8` |
| Web | `sha256:4c0e4ea1c43bc6292183eb6b3f318f7525304cd93133c8e1c0592a8048d5ff67` |
| Worker | `sha256:4413a4fa47f5ce3beaff31ec76c5343c5de921929ecd49c131f003f9f1d88f98` |
| Agent Server | `sha256:57c772b3bd42ab10af6ad220ac50d4c3526d8598a19de34742064dfc4d670d31` |

Current-head CI passed 10 execution jobs, then exposed two admin security tests calling the deleted generic Start endpoint and receiving 404 before guards. These test-only requests now exercise the existing bounded retry route without the obsolete Start payload. The complete focused admin suite passes **9/9**, zero skips, in `lcsp_admin_ci_regression` inside the single owned PostgreSQL of staging **`86ed6cac39c346df`**. Production code was not changed for this CI repair.

This fresh isolated staging booted the exact refreshed images, applied migrations, verified 29 retired tables absent and 14 native consumers, and registered three synthetic accounts. Playwright CLI with **workers=1** and Playwright MCP verified real admin sign-in/navigation, one main landmark, no generic Start/source selector, empty current authority and reload persistence, with zero page errors/unexpected request failures. Owned teardown stopped the six containers. No model invocation was repeated: live APX/Root semantics, 23 corrected UI phases, both 6/6 legal reviews, 25/25 qualified matrix and 999,467-token accounting remain proven by the byte-identical agent payloads and unchanged runtime semantics of the API formatting.

Receipts: [final candidate](release-images/20261011210628_a047d4ca2aa1/report.json), [formatting equivalence](pr367-ci-formatting-equivalence.json), [admin security](pr367-admin-security-regression.json), [bounded fresh staging/browser](staging/86ed6cac39c346df/post-ci-acceptance.json), [workers=1 receipt](staging/86ed6cac39c346df/post-ci-browser-playwright.json). This report records local evidence at final publication; the exact final HEAD and remote CI results are recorded in the updated PR #367 body/checks.

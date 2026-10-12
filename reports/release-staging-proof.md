# Release implementation and staging proof

Implementation + staging gate: **PASS**. Production release proof: **NOT_PROVEN**. releaseEligible remains false.

Verified at: 2026-10-11T02:03:26.096181+00:00. HEAD: `836607eb2b5e2ad89a966d06212134941ecc2cc1`; branch: `feat/LCSP-357-hard-delete-legacy-architecture-and-prove-release-readiness`. The entire dirty tree and intentional deletions are preserved. No LCSP commit, push, PR, merge, ruleset change, production deployment or production canary occurred.

## Exact candidate

Receipt: [accepted images](release-images/20261011005041_cce648aed2a3/report.json). All 1,078 source hashes and 22 build/policy inputs matched at final verification. Four merged rootfs audits PASS; Docker integrations 7 PASS / 0 FAIL / 0 ERROR / 0 SKIP.

- api: `sha256:8ccb87986add46e51b14fdca74d575c50992fda82b0563d01d7100d943f8aac5`
- web: `sha256:c6777c492da11079dcfc6a5fecb49972200bc52735977787453c32810a7595bd`
- worker: `sha256:739329fb0c4679b9c044eff7e773227341373ec74051ec05d46d6344269613d3`
- server: `sha256:43088732caa64be62138697e6d922879d61cf863116b065f7ad7d5fba33e6efa`

## Current disposable acceptance

Run: `e73734b01eff4005`. [Final handoff](staging/e73734b01eff4005/acceptance-handoff.json), [Playwright full flow](staging/e73734b01eff4005/browser-full-flow.json), [Root acceptance](staging/e73734b01eff4005/assessment-root-acceptance.json), [visual review](staging/e73734b01eff4005/browser-visual-review.json), [console/network](staging/e73734b01eff4005/browser-console-network-review.json).

Admin Start preparation, owner login/create/repository setup, investigation before the sole material deployment question, UI answer, Stop/reload/Continue on the same Root, final decisions, COMPLETE/SUCCEEDED and real report downloads all passed. A's same-thread recovery passed during investigation, human wait and after accepted answer; stale Case revision invalidated the old decision, UI removed it from final presentation, and Root authored revision 2. A/B kept the old portfolio after activation; UI-created C/D pinned the new ACTIVE portfolio. B's explicit UI deletion erased domain, checkpoints and transport journal, preserving A and generic learning.

Initial and supersession [semantic review](staging/e73734b01eff4005/legal-semantic-review.json) / [semantic review](staging/e73734b01eff4005/legal-semantic-review-supersession.json) each passed 6/6 on unchanged rubric/source pins. The supersession needed one normal UI retry after a genuine model packet omission; the 400/NO_SUBMISSION is preserved. No generated packet, answer, decision or artifact was manually inserted or edited.

The bounded negative case used authenticated complete source coverage for a Root-authored NOT_MET absence conclusion; actual gapped submissions and direct/indirect missing/truncated/gapped guard probes were rejected. Internal completion blockers and terminal cancellation are explicitly mechanical current-image checks, not customer UI actions. No visible customer Cancel control/action is claimed. Foreign-user list/assessment/Human Resolution/report navigation, canary UI/hidden/report isolation and shared-heuristic provenance rejection passed.

All four Root cases actually ran `apx:claude-sonnet-4-6-free`, no provider fallback. Legal Preparation intentionally ran Gemini. Inception and Gemini fallback routes remain configured. 73 SETTLED invocations / 1649501 tokens reconcile with UI and ledger; four duplicate callbacks were idempotent. Charged credits are zero for the configured free primary route; B's accounting receipt was captured before deletion.

| Case | Assessment ID | Root thread ID | Downloaded artifact | Browser SHA-256 |
|---|---|---|---|---|
| assessmentA | d30b6364-f031-4318-90af-9569b079c612 | de9feef0-c426-4903-b0ef-b09fb8a6e245 | 225d9da8-a2a4-508b-9638-06233acc13ae | efcd654c93d3a129126f19d447d10a4ff1122a79a8239e97db338be327930e0a |
| assessmentB | 8c91d731-eafb-4002-849e-8dd565f23e29 | 52260d30-30d3-4c59-a183-adc011d26a6a | b1191790-116c-5153-a6f8-e238f1c2574e | 427c9dbd2aea175ef3c7a2d6c7b1b0738fc433460065cf5e8df4b2f1d4adbcb4 |
| assessmentC | 34739558-2460-4312-8f17-c78d103e1112 | 47dd5f82-68ff-4a3e-8f26-29a7867c6576 | 54547223-60a0-58e8-ad54-502d93f2075c | fca0f8e051b56f97aa385a33568edaabcc31ac453f6e675fe2121ceeef518e1c |
| assessmentD | 29fd06b3-d72d-4a13-b23d-d2dd3d1c6b96 | ca45eed6-391f-4b41-aa93-ec1cbe9ef51a | b50e7a82-f198-5607-b1f4-13beeede485e | 17099e3d242426170b943a811083ce492fa9199ec42ceb0f3469de5eb0c282b9 |

Evidence: 95 screenshots, 46 page snapshots and four preserved, non-empty actual browser downloads under `staging/e73734b01eff4005/`. Raw configured Git/provider/worker/session/password values were absent from current public evidence. Expected 403 password reauthentication and explicit foreign/post-delete 404 reads are recorded; unexpected console/network errors and HTTP 500 count are zero.

## Frozen matrix

[Acceptance matrix](staging-acceptance-matrix.json): **24 PASS + 1 PASS_REUSED_UNAFFECTED = 25/25**. The reused row is unchanged migration/rollback. Row predicates were not edited. The timing-defect fixture exercises live NON_COMPLIANT and NOT_APPLICABLE, with both MET/NOT_MET criteria; no separate all-COMPLIANT live repository variant is claimed.

## Codebase convention verification

Backend: CQRS, feature layers, shared Zod and no presentation-to-Prisma remain PASS; unaffected TypeScript checks are reused. Web: feature organization, Atomic Design/shadcn, RHF + Zod, i18n and transport/session-only BFF remain PASS; no production frontend changes in this repair. Python: managed Deep Agents/native middleware remain PASS; the new correction only preserves contract-derived Gemini null types, with no defaults, relaxed canonical schema or semantic judge. Focused correction: 166 PASS; current static import/contracts/retirement and diff checks PASS. Naming: PASS, zero new task-oriented active names or compatibility aliases. Legacy rootfs absence: PASS. See [conventions](release-codebase-conventions.json), [naming](purpose-based-naming-audit.json) and [transport repair](gemini-tool-nullability-repair.json).

## Teardown and publication boundary

[Owned teardown](staging/e73734b01eff4005/teardown.json): STOPPED; six containers, three remaining sandboxes and owned network/resources removed. B's sandbox was already removed through the product deletion path. Unrelated resources were untouched; sanitized evidence remains.

[Remote CI](release-remote-ci.json): NOT_PROVEN. Current source is unpublished. After explicit authorization, review/stage the current implementation and deletions plus sanitized receipts, commit on this existing branch, push it and create/update the current-source PR. Observe required remote checks and actual V2 required-release-gate enforcement; local tests cannot prove this. Historical remote checks were Require Jira issue key and Docker sandbox E2E. Do not alter branch protection without separate authorization. Production deployment/post-deploy canary remain unauthorized and unrun.

# LCSP-360 final acceptance envelope — BLOCKED

Candidate: `bf3bc2a409944746dc0185b6afa6693b75565089`, locally frozen at `refs/lcsp360/document-provenance-20261022`. Historical failed candidate: `6f37b38c2b38a93d92cc905d3dd432c3f2f9c40a`. PR #427 remains Draft. This is a **non-executable proposal**, not an authorization or acceptance receipt. See `execution-envelope.json` for all limits, prerequisites and gate criteria.

## Current checkpoint: provenance PASS; shared admission BLOCKED

The shared seeder now requires the original source bytes and an explicit digest, validates their equality before writes, and stores the canonical `sha256:` digest. All six active callers propagate actual source bytes/digests. The frozen candidate passed 19 PostgreSQL regressions, 102 focused Python guards and the affected provider-free journeys. A new isolated database and an independent read-only PostgreSQL check establish the document binding that the earlier preflight omitted. See [new receipts](../document-provenance-20261022/independent-postgres-verification.json) and release report section 16. The historical failed database/receipt below are unchanged.

**First unresolved hard gate: shared paid-inference admission.** The existing innermost `UsageMeteringMiddleware` can host run-scoped pre-dispatch admission shared through `AgentRunState` and existing durable recovery. It currently checks identity/context/cancellation and records completed responses afterward. The provider-free [boundary probe](../document-provenance-20261022/budget-boundary.json) observes 3 synthetic dispatches but 2 completed usage records, including Producer, Auditor and an unanswered failure. It does not implement or prove a financial cap.

Before execution, add atomic attempt/token/cost reservations at that boundary, with verified conservative upper bounds and provider tariffs for every configured route; cover both sync/async paths and SDK-internal retries (currently Google has a configured retry). Application retry, rotation and fallback already wrap this shared metering boundary. Unknown or unbounded charges must reject dispatch; crashes must retain outstanding reservations; exhaustion must be terminal rather than invoke forced-finalization prompts. No new pipeline, provider price assumption or generic completion-counter shortcut is justified. The minimal shared reuse point is identified; financial enforcement remains unimplemented. Paid authorization is separately absent.

## Historical failed gate: document source-byte digest binding

**Root cause:** `fixture_chunks.py` supplies the verified source digest, but `tests/compliance-rule-set-live-eval.mjs:128` passes only the document ID and chunks into `seedLegalSource`. `tests/support/compliance-rule-set-stack.mjs:120` writes `contentHash(name)` as `LegalSourceDocument.sourceSha256`. The digest identifies a fixture name rather than the source bytes. Earlier checks verified chunks, graph support and signatures; they did not establish this document-level binding.

**Historical required fix, now completed in section 16:** Pass the independently verified source-byte digest through the seeder, persist it as the document digest, and add a focused provider-free regression. Recheck the affected provenance gate and freeze a new candidate. Existing databases and accepted/historical receipts must remain unchanged. Stop-on-blocker applies; this pass contains no runtime fix or evaluation retry.

Read-only persisted proof, `document-digest-blocker.json`:

| Value | SHA-256 |
|---|---|
| Pinned `synthetic-notice-v1.txt`, 1,185 bytes | `b69a711386e79d62e287eac4f8c447932c9a5b999e5618e623745b5c9f280cc1` |
| Stored document digest | `9f4ee581919363af294eb32196175da57961c290b68f0213581bf61e1fd846a9` |
| Hash of fixture name `pypdf-preflight-1792643354451` | `9f4ee581919363af294eb32196175da57961c290b68f0213581bf61e1fd846a9` |

Database: `lcsp360_pypdf_preflight_7a3088043efe`, owned container on loopback 55502; source version `6887d934-139f-4e16-8a05-c5f897a57661`. One SELECT ran with `default_transaction_read_only=on`. The container was then stopped; its volume is retained. No new Preparation, domain mutation, evaluation or model call occurred. Historical 55441 was not started or queried.

## Proposed one-run scope and limits

- Keep the complete existing default fixture: 15 chunks / 12 review units, with all cross-article scope, definition, exception, retention and in-person duties. No subset or smaller control replaces it. Its synthetic authority is explicit; success would not prove official-law corpus acceptance. P07/P10 remain separately named frozen controls, not silently added paid Preparations.
- Preserve independently resolved Producer/Auditor roles and their exact configured fallback chains. All reader, summarization, retry and fallback dispatches count. Existing novelty/no-progress, Validator and semantic gates remain unchanged.
- Proposed ceilings: **256 provider dispatches**, **4,000,000 input tokens including cache reads/writes**, **256,000 output tokens including reasoning**, **USD 25 aggregate provider charges**. These are proposed stop ceilings, not cost/workload estimates. Historical tokens and costs are UNAVAILABLE.
- Keep the existing worker timeout of **3,600 seconds**, provider request timeout **600 seconds**; propose **4,200 seconds total** including setup, verification and termination. Proposed worker-stage ceilings: materialization 120 s, discovery/auditing 2,400 s, freeze 180 s, authoring/Validator 720 s, persistence/activation/reopen 180 s. Setup and independent verification are outside the worker budget.
- Proposed resources: 3 GiB for the API/worker process tree, 256 MiB PostgreSQL, 1 GiB memory reserve, 200% CPU quota; 4 GiB additional disk allowance plus 4 GiB filesystem reserve. Memory/disk limits and stage supervision are **not applied or verified**. Recheck capacity immediately before any dispatch.

**No paid authorization exists:** authorized calls/tokens/spending remain **0/0/USD 0**. The latest user instruction explicitly requires stopping without approval and an enforceable budget. Quota is not spending authorization.

**Enforcement is incomplete:** the harness has timeout/kill/recovery, not a shared pre-dispatch call/token/cost reservation. `LiveUsage.record` observes completed responses. Generic `AgentRunBudgetMiddleware` is a per-agent graph/context finalizer and is not a shared financial limiter for this standalone Producer/Auditor journey. Tariffs/settlement conversion are unverified. Before a paid run, approved ceilings must be enforced atomically across every role, provider and attempt; unknown rates or usage must fail closed. Do not alter legal prompts or force a positive conclusion when a budget is exhausted. No runnable launch command is published.

Future isolation: a **new empty** PostgreSQL container on a newly verified free loopback port (proposed 55504; retained provenance resources now occupy 55503), API 3459, explicit fresh random HMAC key shared by API/worker. The helper resets its fixed database name, so it must never target retained 55441, a reused cluster or production. Run/source/version IDs are assigned only after authorization and a passing corrected preflight. No paid-evaluation database is provisioned. The task-owned provenance cluster on 55503 is stopped and retained; do not reset it for a later evaluation.

## Resource findings

The resource receipt records approximately **15.25 GiB free disk** and **4.98 GiB available RAM** at capture. Btrfs reports dynamic inodes; zero total/free inode counters are not exhaustion. Docker reports 285 images, 131 containers, 246 volumes and 1,020 cache entries; shared image/cache totals overlap. Reported reclaimability proves neither ownership nor disposability.

No cleanup occurred. Evaluation disk allocation fits without deleting evidence. A larger initial 5 GiB process-tree proposal failed the changing RAM-headroom check; the smaller proposal fails closed if it cannot fit or exceeds its cgroup limit. No actual future peak is claimed, and resource enforcement still needs verification.

Historical release images total **8.63 GiB**; the largest sequential rootfs export is **2.44 GiB**. `release-images.py` retains four images, creates intermediates and exports rootfs into RAM-backed `/tmp`. A conservative **24 GiB free-disk admission floor** is recorded for later planning, not a measured exact future peak. Current capacity does not admit that later build. Reassess cache misses, temporary storage and memory after Phase C passes. No broad prune, image removal, volume deletion or historical evidence cleanup is authorized or performed.

## Gate matrix

| Gate | Status | Evidence / limitation |
|---|---|---|
| Candidate, Draft PR, protected WIP | PASS | Exact checkpoint; all 3 WIP hashes preserved; no concurrent source edits observed |
| CI/security | PASS | All 36 checks on exact code candidate `bf3bc2a40`; new receipt `../document-provenance-20261022/ci-code-candidate.json`. Publication-head verification is recorded separately in PR checkpoint |
| Source file and 15 chunk hashes | PASS | Independent recomputation, `source-snapshot.json` |
| Stored document source-byte digest | **PASS** | Fresh frozen-candidate read-only verification; old failure remains below |
| Canonical effects, graph support, HMAC/auth | PASS | New isolated preflight: 15 chunks, 20 nodes, 18 supports, Node/Python HMAC and rejection controls |
| Novelty, independent Auditor, duplicate claim, timeout/recovery | PASS | Source inspection plus retained focused/CI evidence; real runtime behavior still unproven |
| Provider readiness | PASS | Fresh read-only quota/catalog/credential-presence check; no inference or live fallback proof |
| Paid authorization and aggregate enforcement | BLOCKED | No approved limits, global admission guard or verified cost tariff |
| Disk / memory headroom | PASS | Point-in-time proposed small-run allocation only; limits not applied, fresh admission required |
| Fresh real-model semantic/persistence/activation | NOT_RUN | No run ID or activated version; no acceptance claim |
| Release-image capacity | BLOCKED | Deferred Phase D resource admission; current capacity below proposed floor |
| Staging/browser/production | NOT_RUN | C must pass first; no production authorization |

## Commands and outcomes

- `git status --short --branch`, `git rev-parse HEAD`: exact checkpoint; only the two protected historical JSONs and orphan spec were dirty. WIP SHA-256 checks passed.
- `df -h`, `df -i`, `stat -f`, `free -h`, `docker system df`, `docker system df -v --format json`, `docker buildx du --format json`: capacity/inventory captured. Raw host-wide inventories stay local; published receipt retains their hashes and relevant aggregates.
- `PYTHONPATH=deepagents:deepagents/tests deepagents/.venv/bin/python .../pypdf-security-20261022/provider_readiness.py`: exit 0, fresh metadata only, no model endpoint. Quota remains 4,692,038 units; configured model advertised and key unexpired at capture.
- `deepagents/.venv/bin/python deepagents/tests/vertical/fixture_chunks.py`: exit 0; independently recomputed full-source and all chunk hashes agree with the fixture pin.
- `docker start lcsp360-final-20261022-pg-55502`, then `docker exec -e 'PGOPTIONS=-c default_transaction_read_only=on' ... psql ...`: SELECT succeeded and proved the document digest mismatch. Exact SQL is in the blocker receipt. `docker stop ...`: succeeded; container exited, volume retained.
- JSON/integrity self-check: retained CI identities, all WIP hashes, source/chunk hashes, proposed timing sum, zero authorized spending and disabled launch verified. This validates the evidence/proposal, not the failed source gate.

New evaluation run ID / activated version: **none / none**. New paid calls/input/output/cost: **0 / 0 / 0 / USD 0**. Historical aborted-run usage and cost remain **UNAVAILABLE**.

Next action: **implement and provider-free verify shared pre-dispatch admission using verified provider charge bounds, covering every configured retry/fallback path**. The proposed paid envelope remains blocked; do not execute it.

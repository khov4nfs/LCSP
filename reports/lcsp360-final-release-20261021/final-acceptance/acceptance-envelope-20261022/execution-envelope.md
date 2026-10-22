# LCSP-360 final acceptance envelope — BLOCKED

Candidate: `6f37b38c2b38a93d92cc905d3dd432c3f2f9c40a`, locally frozen at `refs/lcsp360/acceptance-envelope-20261022-6f37b38c2`. PR #427 remains Draft. This is a **non-executable proposal**, not an authorization or acceptance receipt. See `execution-envelope.json` for all limits, prerequisites and gate criteria.

## First failed gate: document source-byte digest binding

**Root cause:** `fixture_chunks.py` supplies the verified source digest, but `tests/compliance-rule-set-live-eval.mjs:128` passes only the document ID and chunks into `seedLegalSource`. `tests/support/compliance-rule-set-stack.mjs:120` writes `contentHash(name)` as `LegalSourceDocument.sourceSha256`. The digest identifies a fixture name rather than the source bytes. Earlier checks verified chunks, graph support and signatures; they did not establish this document-level binding.

**Required fix, not performed:** Pass the independently verified source-byte digest through the seeder, persist it as the document digest, and add a focused provider-free regression. Recheck the affected provenance gate and freeze a new candidate. Existing databases and accepted/historical receipts must remain unchanged. Stop-on-blocker applies; this pass contains no runtime fix or evaluation retry.

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

Future isolation: a **new empty** PostgreSQL container on loopback 55503, API 3459, explicit fresh random HMAC key shared by API/worker. The helper resets its fixed database name, so it must never target retained 55441, a reused cluster or production. Run/source/version IDs are assigned only after authorization and a passing corrected preflight. No database is provisioned by this proposal.

## Resource findings

The resource receipt records approximately **15.25 GiB free disk** and **4.98 GiB available RAM** at capture. Btrfs reports dynamic inodes; zero total/free inode counters are not exhaustion. Docker reports 285 images, 131 containers, 246 volumes and 1,020 cache entries; shared image/cache totals overlap. Reported reclaimability proves neither ownership nor disposability.

No cleanup occurred. Evaluation disk allocation fits without deleting evidence. A larger initial 5 GiB process-tree proposal failed the changing RAM-headroom check; the smaller proposal fails closed if it cannot fit or exceeds its cgroup limit. No actual future peak is claimed, and resource enforcement still needs verification.

Historical release images total **8.63 GiB**; the largest sequential rootfs export is **2.44 GiB**. `release-images.py` retains four images, creates intermediates and exports rootfs into RAM-backed `/tmp`. A conservative **24 GiB free-disk admission floor** is recorded for later planning, not a measured exact future peak. Current capacity does not admit that later build. Reassess cache misses, temporary storage and memory after Phase C passes. No broad prune, image removal, volume deletion or historical evidence cleanup is authorized or performed.

## Gate matrix

| Gate | Status | Evidence / limitation |
|---|---|---|
| Candidate, Draft PR, protected WIP | PASS | Exact checkpoint; all 3 WIP hashes preserved; no concurrent source edits observed |
| CI/security | PASS | Retained 39 exact-head successes; no rerun; `ci-retained-checkpoint.json` |
| Source file and 15 chunk hashes | PASS | Independent recomputation, `source-snapshot.json` |
| Stored document source-byte digest | **FAIL** | Read-only persisted mismatch, `document-digest-blocker.json` |
| Canonical effects, graph support, HMAC/auth | PASS | Retained provider-free checkpoint; does not cover failed document digest |
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

Next action: **fix document source-byte digest propagation and its focused regression before another provenance preflight**. The proposed paid envelope remains blocked; do not execute it.

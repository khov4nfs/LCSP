# T31 source-scope preflight — 2026-11-04

## Result

The authoritative T31 commit contains several projects. The approved business scenario selects only `tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot`. The historical run accepted source facts from three excluded projects, so it is unsuitable as the starting state of the next controlled run.

The Python runtime now enforces the selected subtree during production archive hydration, evidence creation and checkpoint reuse. **218 source/runtime tests and 23 limiter tests passed.** The bounded pilot launcher and fresh isolated API preparation are complete. Actual no-provider preflight correctly stops at unavailable Docker. No provider call has been dispatched. This receipt does not establish semantic acceptance.

## Root cause

The snapshot pinned the correct repository and commit but had no immutable source-path selection. Runtime hydration materialized the entire multiproject commit. Root search coverage could consequently cite TheConstruct, ScriptToImages and Dig4Dinos while the approved scenario referred exclusively to the customer-support chatbot.

Persisted assessment metadata is the source of identity. Old report headings that label the source TheConstruct, or compare assessment `14a6d06e-e021-442e-a29e-0b5406e2b8fa` as a T31 baseline, do not override it: that other assessment is for `vishal017/cheatshield`.

## Verified pins

| Item | Value |
| --- | --- |
| Historical T31 assessment | `5ec45c57-3625-4368-bedc-22824a396e5e` |
| Historical snapshot | `820a87d2-89ba-4315-8139-4a89f178f5c8` |
| Repository | `tkhudson/AI-Powered-Customer-Support-Chatbot` |
| Commit | `65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b` |
| Git commit tree | `2b1eb067b78cc556bf7c79b0d34ebc8870ab56f0` |
| Approved subtree | `tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot` |
| Approved baseline Rule Set | `97004ff3-9240-4e37-8a94-9ade8832c00a` |

The database transaction was explicitly read-only. GitHub independently resolved the repository ID, exact commit and untruncated recursive tree. The tree has 18,661 entries and 16,871 blobs: 16,724 under the chatbot prefix, 119 under Dig4Dinos, 23 under TheConstruct, four under ScriptToImages and one top-level .gitmodules file. The chatbot prefix includes a committed Python virtual environment; those dependencies are not evidence of customer operational practices. The Git tree declares 461,839,266 total blob bytes, 18,661 entries and at most 15 path segments, within current aggregate extraction limits. Six chatbot blobs exceed the 10 MiB per-file limit and three are symlinks; they remain explicit visibility limitations in a hydrated view.

The exact [approved business scenario](https://docs.google.com/document/d/1oOh1O1SDvHb1arx5KZMUiHum8CwURk9obQZ7y_Ecnmo/edit), tab `t.msvbwcgyzp1j`, version 2.0.1, was marked APPROVED / LOCKED on 2026-11-02. It expressly excludes the other projects. No new scope approval was manufactured. The operator answer contract remains outside the assessed Root's source and initial instructions.

Independent source checks verified Git blob identity and SHA-256 for the chatbot README and app.py. Exact hashes are in [the machine-readable receipt](../implementation-artifacts/t31-live-preflight-20261104.json). The pinned [GitHub commit](https://github.com/tkhudson/AI-Powered-Customer-Support-Chatbot/tree/65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b) remains the external source.

## Historical contamination

Read-only evidence inspection found seven accepted repository-source records, four accepted search-coverage records and 16 accepted human-answer records. Repository source observations include these excluded paths:

- `tkh/Astromo/TheConstruct/src/utils/aiService.js`
- `tkh/upworkProjects/ScriptToImages/generateimages.py`
- `tkh/Game/Dig4Dinos/README.md`

Search observations also included repository-root ancestors and runtime metadata. Path occurrences are not interchangeable with distinct accepted source facts. The legal review independently identified three accepted foreign-project source facts. The new pilot must start with zero inherited facts, decisions and human-request IDs; the historical assessment is preserved.

## Fix

The shared field is `sourcePathPrefix`, nullable for legacy full-repository behavior, with incoming snapshot request field `source_path_prefix`. Python validates the same literal canonical path rules as the API contract, including the 1,024 UTF-16-code-unit maximum. It rejects absolute, traversal, repeated-separator, backslash, colon, percent and control-character ambiguity without normalizing customer Unicode or interior spaces.

Hydration applies archive safety checks before subtree filtering and retains original repository-relative paths. A missing or entirely excluded target fails closed. Symlinks and hardlinks remain excluded, and runtime .git/.lcsp content cannot replace the trusted marker. Safety omissions inside the selected subtree set `coverageLimited`; intentional exclusions outside it have a separate count and at most 100 metadata samples. Root context exposes the count without sibling path names.

Cached marker and coverage scope must match before reuse. The graph index's existing marker digest changes with source scope, preventing reuse of a broader index. Root source evidence rejects foreign paths before reading content. Scoped native search coverage requires an explicit in-scope path; whole-root searches receive actionable correction feedback. Graph scopes use the verified selected prefix. Native checkpoints carry the same prefix, and a scoped run rejects legacy or foreign-scope checkpoints before graph invocation.

## Verification

The following suites passed **218 tests in 3.37 seconds**, including the existing null-scope and human-wait recovery cases:

- `deepagents/tests/test_repository_hydration_coverage.py`
- `deepagents/tests/test_assessment_root_agent.py`
- `deepagents/tests/test_codebase_memory_index.py`
- `deepagents/tests/test_repository_sandbox.py`

Focused security cases cover sibling-name collisions, malformed/Unicode path handling, archive traversal, symlink/hardlink exclusion, forged runtime metadata, missing source, stale marker and coverage scope, source reads rejected before I/O, scoped search evidence and checkpoint scope drift. These are offline production-path tests; they do not replace a live Docker/provider run.

## Bounded pilot gate

The next pilot uses a newly created isolated loopback API database and separate checkpoint database. It imports only the exact existing approved baseline and required legal-source provenance. It creates a new customer assessment, connection and scoped snapshot through supported API paths, with no historical facts or decisions. The pending corrected Rule Set candidate is not activated.

The launcher is `deepagents/scripts/run_t31_scoped_pilot.py`. Its default invocation performs no-provider preflight; actual execution additionally requires `--dispatch`, a matching reviewed runtime-code digest and a healthy mandatory Docker engine. It retains all production governance, adds a measured-input boundary immediately before UsageMetering, and requires that proof in the existing RunAdmission transaction. SDK-hidden retries are disabled or limited to one physical request.

| Limit | Meaning |
| --- | --- |
| Eight physical provider attempts | Maximum shared across Root, researchers, summaries, retry and fallback |
| 120,000 aggregate input units | Conservative run exposure, reconciled against reported cache-inclusive input |
| 90,000 per-attempt input reservation | Request UTF-8 bytes plus explicit framing must fit before admission |
| 16,384 aggregate output tokens | Shared output exposure |
| 4,096 output tokens per attempt | Verified in actual native SDK wire payloads using mock HTTP transports |
| 180 seconds | Cooperative model-work deadline beginning after hydration and lease renewal |
| 600 seconds | POSIX preparation alarm covering provider-free hydration, indexing and budget preparation |
| 45 seconds | Native SDK read/inactivity timeout |

Eight attempts are not guaranteed to be available: an unanswered 90,000-unit reservation leaves insufficient aggregate input capacity for another equal reservation. The existing configured assessment route remains Inception mercury-3 with its configured fallback chain; budget denial may stop that chain.

The production runner starts its lease-heartbeat loop before hydration. A successful authoritative heartbeat is required again after hydration and before budget creation. The 180-second cancellation scope stops governed graph/model work, but does not guarantee termination of an in-flight synchronous HTTP transport. The 45-second read timeout is not a total streaming-request duration bound. Unknown exposure remains reserved, and late reported usage may be reconciled. Total elapsed time including preparation is recorded separately. No whole-run 180-second guarantee or verified dollar cap is claimed.

The 23 limiter tests passed in 3.96 seconds. They exercise actual durable reservations, request measurement, Root/researcher/summary shared limits, unknown-exposure fallback denial, expiry, cache-inclusive usage, preparation timeout, and real OpenAI/Anthropic/Google native SDKs with mock transports in synchronous and asynchronous modes. Each native test observed one physical mock HTTP request with the 4,096 output cap and 45-second read timeout. Real provider requests remained zero. Business documentation checks passed with zero missing/invalid functions, and their five checker tests passed.

Docker Desktop 4.37.2 is installed, but both selected desktop-linux and default sockets remained absent (ENOENT) after normal startup attempts. A Docker CLI call even returned exit zero with an empty parsed server version and a daemon-connect error, so exit status is not accepted as readiness. The launcher requires a nonempty parsed server version and successful connection to the selected local Unix socket. Availability of the required `lcsp-agent-runtime:dev` image remains unverified while the engine is down. No alternate filesystem backend bypass is permitted.

The exact approved baseline was exported read-only into an ignored operator artifact: 29 tables, 45,580,451 bytes, SHA-256 `79a402afbb509668f8654a70933006843e8df4a35a0f6b6d3d84427f47233ae0`. It preserves inherited activation and source provenance without customer assessments, facts, decisions, credentials or the pending candidate. The create-only bootstrap in `operator/t31_scoped_pilot_bootstrap.mjs` completed successfully. All 29 copied tables matched canonical source rows exactly, stored Rule Set integrity passed, and all nine supported customer API requests succeeded. The bootstrap used the existing pinned GitHub CLI 2.98.0 after detecting that the system CLI was below the production minimum.

The nine owned runtime/test files and exact SHA-256 hashes are recorded in the JSON receipt. No production database migration, old assessment mutation, candidate activation, commit or push was performed by this preflight task.

## Observed prepared run and final boundary

| Item | Observed value |
| --- | --- |
| Preparation status | `PREPARED_NO_PROVIDER` |
| New assessment | `fd82c0bf-2652-4bd8-9d57-af204ef0d0c4` |
| New scoped snapshot | `9f76dbbf-0274-4ea9-aa3d-14e665d87e80` |
| New scan job | `709e0545-f1bc-439b-81a4-c35c7cdc29f0` |
| API database | `lcsp360_final_t31_mw2a6rb4_3851bb09d879` |
| Checkpoint database | `lcsp_assessment_t31_mw2a6rb4_3851bb09d879` |
| Initial case | Revision 0; zero facts, evidence and decisions; 243 coverage rows |
| Inherited legal baseline | 633 requirements, 243 rules, 2,915 chunks, eight documents |
| Actual Python preflight | Exit 0; `BLOCKED_DOCKER_UNAVAILABLE`; no dispatch flag |
| Provider calls | **0** |
| Frozen runtime code digest | `21e9d5e9bc5f2fb41f4a1d6d18841d30273951438c80900fcfaf617f3755a7fc` |

The safe bootstrap receipt is `.cache/t31/scoped-pilot-mw2a6rb4_3851bb09d879/bootstrap-receipt.json`, SHA-256 `1e3163a95d7f7056a6e8583b752229b2cd6ea2ceababa434dbafd4ca7760f096`. The actual Python preflight receipt is `.cache/t31/scoped-pilot-mw2a6rb4_3851bb09d879/pilot-preflight.json`, SHA-256 `37b2186c04b49454b8838300dffba2b445e8200103327cff8bffb0b51ac98c2d`. Their key proof, including all exact-copy table digests, is retained in the repository machine-readable receipt.

The preflight constructed and checked the actual configured native SDK identities and single-attempt settings for Inception mercury-3, MiraiAPI Claude Sonnet 5, Google Gemini 3.5 Flash Lite and APX Claude Sonnet 4-6 Free. This checks local binding and transport settings; it does not assert provider credentials were accepted by a generation endpoint.

The selected `desktop-linux` context still has no usable Docker server. No model execution was claimed and no semantic outcome was evaluated. The owned API and PostgreSQL processes have been stopped; read-only TCP checks confirmed ports 50871 and 64303 are closed with ECONNREFUSED. Both databases, the existing PostgreSQL data directory and private operator state are preserved.

## Exact continuation commands

These commands run from `/Users/nguyenanh/Documents/Capstone/LCSP`. First make the installed Docker Desktop engine available. Reuse the existing isolated PostgreSQL cluster in a separate owned process; do not run initdb or reset its databases:

```bash
/opt/homebrew/Cellar/postgresql@14/14.20/bin/postgres -D /Users/nguyenanh/Documents/Capstone/LCSP/.cache/t31-phase2-upgrade-20261104/postgres-data -h 127.0.0.1 -p 64303 -k /Users/nguyenanh/Documents/Capstone/LCSP/.cache/t31-phase2-upgrade-20261104 -c timezone=Asia/Ho_Chi_Minh -c max_connections=30 -c shared_buffers=32MB
```

Start only the prepared isolated API. Its 1,200-second lifetime accommodates the bounded preparation and model-work phases:

```bash
node operator/t31_scoped_pilot_bootstrap.mjs resume --runtime /Users/nguyenanh/Documents/Capstone/LCSP/.cache/t31/scoped-pilot-mw2a6rb4_3851bb09d879/private-runtime.json --serve-seconds 1200
```

Run the no-provider preflight and inspect its readiness result:

```bash
deepagents/.venv/bin/python -B deepagents/scripts/run_t31_scoped_pilot.py --runtime /Users/nguyenanh/Documents/Capstone/LCSP/.cache/t31/scoped-pilot-mw2a6rb4_3851bb09d879/private-runtime.json
```

Only after Docker readiness and the reviewed code binding are satisfied, the already scoped bounded pilot command is:

```bash
deepagents/.venv/bin/python -B deepagents/scripts/run_t31_scoped_pilot.py --runtime /Users/nguyenanh/Documents/Capstone/LCSP/.cache/t31/scoped-pilot-mw2a6rb4_3851bb09d879/private-runtime.json --dispatch --expected-code-sha256 21e9d5e9bc5f2fb41f4a1d6d18841d30273951438c80900fcfaf617f3755a7fc
```

The launcher refuses an existing execution marker, historical T31 resume, source-pin drift, missing measurements, changed runtime code and exhausted budget. It stops on the first native wait or technical boundary without injecting an operator answer. A successful future technical pilot still requires a separate semantic review; this preparation is not full-benchmark acceptance.
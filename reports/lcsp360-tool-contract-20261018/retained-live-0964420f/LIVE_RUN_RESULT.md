# Live disposable result: NOT_ACCEPTED (boundary RULE_AUTHORING)

Code under test: `8f0b2519c` (code identical to deployed `644c2668e`; the later commit changes only `reports/`). One disposable Preparation
(run `0964420f-ab57-4f60-833b-c7f4a3029c63`), dispatched once (`live-preparation-dispatch-reserved.json`). Stack torn down. No second run.

## What the previous failure was, and what changed

| | e6b6e2fbb run 7fefb641 | this run |
|---|---|---|
| Discovery | 48 claims, 11 SCOPE/CONDITION, one freeze | 11/11 units reviewed, 36 claims, one frozen revision, inventory validation PASSED |
| Authoring started | never (20 inventory reads, 0 `author_*`) | 6 s after the freeze (first `author_*` call 14:38:00; first Requirement authored 14:38:03) |
| Requirements authored | 0 | 10 (authored over 14:38:03 -> 14:38:50, the count dipped 10 -> 9 -> 10 once at 14:38:46-50, cause not visible in the retained events) |
| AssessmentRules | 0 | 0 |
| Real validator runs (`RULE_VALIDATION_STARTED`) | 0 | 0 (`validation_executed=false`, `rule_validation_attempt=0` on all 13 rejection events) |
| Terminal | NoProgressDetected on a repeated rejected read | NoProgressDetected on repeated rejected `author_*` calls, `failureReason=RUNTIME_ERROR`, state FAILED |

The failure the memory fix targeted (Agent unable to start authoring because compaction erased the inventory it had read) did not recur.
A different failure, later in the same phase, ended the run.

## Facts from the retained events (721 runtime events, 26 `RULE_AUTHORING_CONTEXT`, 13 rejection events)

- 12 `RULE_AUTHORING_TOOL_REJECTED` plus the terminal `NO_PROGRESS_DETECTED`: 6x `CLAIM_SCHEMA_INVALID` (two distinct gap fingerprints, `770f10…` x4 and `fc888e…` x2), 5x `CLAIM_REQUIREMENT_MISMATCH` (four fingerprints), 1x `OPERATIVE_PROPOSITION_REQUIRED`.
- The digest's outstanding-rejection state was set on a rejection and cleared after a corrected call three times (set 14:38:00, cleared 14:38:03; set 14:38:19, cleared 14:38:22; set 14:38:32-46, cleared 14:38:48). Requirements 1-9 took about 27 s.
- The 10th Requirement took about 17 s (14:38:29 -> 14:38:46) and 5 rejected calls (14:38:32.9, 35.1, 37.0, 39.5, 41.9).
- From 14:38:52 to 14:39:03 the draft was unchanged (`accounting_fingerprint 65112f73…` constant across 5 rejected calls); `770f10…` occurred at 52.7, 59.5 and 03.9. By `claim_inventory.py`'s own rule (same effective state + same gaps, repeated after NO_PROGRESS feedback) that is genuine stagnation, so the termination is correct under the existing policy.
- Authoring-memory telemetry at the end: `unreadClaimCount 19`, `inventoryPagesSurfaced 2` (this counts distinct view keys, not pages; the name overstates it), `digestBytes` 4.8-7.0 KB, `outstandingRejectionCode CLAIM_REQUIREMENT_MISMATCH`.
- Model route: the configured primary (`claude-sonnet-4-6-free` via apx) returned HTTP 429 `rate_limit_error` 19 times; all 147 model completions ran on the fallback `google_genai/gemini-3.5-flash-lite` (8 fallback calls recorded; 166 physical provider attempts). The previous failed run was also entirely on that model. This is a confound for any conclusion about the Agent's reasoning, and it was not controlled in this task.

## What is NOT known

- The rejected tool-call arguments and the exact feedback text the model saw are not retained (checkpoint holds 4 coarse states; container logs hold no tool bodies). Which field was schema-invalid, which claims mismatched, and whether the failing `author_*` calls were Requirements or the first AssessmentRule are therefore unknown. "0 rules ever, and the final stuck calls came right after Requirement 10" is consistent with the Agent failing to reach `author_assessment_rule`, but that is an inference, not an observation.
- Whether the digest's feedback for `CLAIM_SCHEMA_INVALID` was sufficient for this model to correct the call: unknown. The deterministic tests show the feedback is present in every request, not that it is sufficient.
- Why the Requirement count went 10 -> 9 -> 10.
- Earlier I attributed a 2-vs-4 Requirement-count mismatch between the monitor row and the digest to "draft-level" Requirements without evidence. That was wrong; the telemetry timeline shows the values were simply sampled at different instants (2 at 14:38:10, 4 at 14:38:14), i.e. observer skew.

## Verdict against the pre-registered criteria

NOT_ACCEPTED. Row matched: "any other terminal failure" -> exactly one boundary: **RULE_AUTHORING** (the Agent authored 10 Requirements but could not complete schema-valid, role-consistent `author_*` calls and never reached AssessmentRules or the validator).
Not AUTHORING_MEMORY: authoring began promptly, no reread loop, rejections were retained and cleared on correction. Not RULE_VALIDATION: the validator never ran. PROVIDER_RUNTIME is a confound (fallback-only model), not the terminal cause.

`DETERMINISTIC_COVERAGE = INADEQUATE`. The new suite drives the real middleware, but its probes only emit well-formed calls (plus one planted `CLAIM_REQUIREMENT_MISMATCH`); no test has a model emit repeated malformed or mismatched `author_*` calls, and none carries a model through `author_assessment_rule` under compaction. The live failure mode sits exactly in that gap.

Semantic acceptance (19/19): NOT EVALUATED. No Rule Set was produced, so there is nothing to review; no 19/19 claim is made.

## Policy

Failure policy applies: STOP. No second disposable, no patch-and-retry, no full corpus (Legal Source Version `80bcda31-d0a7-4463-9f6e-41bd6da6ff12` untouched).
Candidate next steps for a separately authorized task (not done here): retain `author_*` rejection bodies in the Agent's evidence so the next failure is diagnosable; add deterministic tests with a malformed/mismatched-call model that must reach `author_assessment_rule`; decide how to control the model route (the 429-driven fallback) for the next live attempt.

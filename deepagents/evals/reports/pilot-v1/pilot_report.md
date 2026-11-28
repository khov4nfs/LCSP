# LCSP Benchmark Pilot Report (`pilot-v1`)

- **Run ID**: `pilot-v1`
- **Mode**: `OFFLINE_FIXTURE` (offline infrastructure verification; **0 physical provider attempts**, **does not establish live model correctness**)
- **Invariant Coverage**: `authorityGate: NOT_TESTED`, `completionGate: NOT_TESTED` (exercised in `SCRIPTED`/`LIVE` modes, never defaulted to PASS in offline mode)
- **Dataset**: 36 seeded cases across 8 synthetic repositories (`SYNTHETIC_FIXTURE`, `DEV`: 20 cases, `HOLDOUT`: 16 cases; 32 semantic cases / 36 semantic case-stage units, plus 4 fault-injection/recovery cases)
- **Trials per case**: `n = 5` (independent `thread_id` and reset state per trial; complete `expectedTrialInventory` verified)

## Semantic Reliability (32 Cases / 36 Case-Stage Units; Excludes Fault Injection)

| Cohort | `pass^1` (denom) | `pass^3` (denom) | `pass^5` (denom) | Physical Attempts | Provider Cost |
| --- | --- | --- | --- | --- | --- |
| Overall Semantic | `1.0` (`36/36`) | `1.0` (`36/36`) | `1.0` (`36/36`) | `0` | `null` (offline) |

## Fault Injection / Recovery (4 Cases; Reported Separately)

| Cohort | `pass^1` (denom) | `pass^3` (denom) | `pass^5` (denom) | Physical Attempts |
| --- | --- | --- | --- | --- |
| Fault Injection / Recovery | `1.0` (`4/4`) | `1.0` (`4/4`) | `1.0` (`4/4`) | `0` |

## P15 Manual Semantic Review (Trace-Bound, Separated)

- **Expert-Verified**: `0` (`overallSemanticPassRate: null`)
- **Seeded Unverified**: `15` (`overallSemanticPassRate: 1.0`, bound to `pilot-v1` `stage` + `thread_id` + `trace_sha256`; not expert-verified ground truth)

## Artifacts

- [manifest.json](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/manifest.json)
- [report.json](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/report.json)
- [report.csv](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/report.csv)
- [trials.jsonl](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/trials.jsonl)

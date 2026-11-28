# LCSP Benchmark Pilot Report (`pilot-v1`)

- **Run ID**: `pilot-v1`
- **Mode**: `OFFLINE_FIXTURE` (offline infrastructure verification; **0 paid model calls**, **does not establish live model correctness**)
- **Manifest SHA-256**: `5d7ebd1360771d07852cb5e7f0498ca9fabcdfbd413216a107178305d5c82831`
- **Dataset**: 36 seeded cases across 8 synthetic repos (`DEV`: 20 cases, `HOLDOUT`: 16 cases, including negative controls, two-stage HITL cases, and 4 fault-injection/recovery cases)
- **Trials per case**: `n = 5` (independent `thread_id` and reset fixture state per trial)

## Semantic Reliability (Excludes Fault Injection)

| Cohort | `pass^1` (denom) | `pass^3` (denom) | `pass^5` (denom) | Authority Violations | Provider Cost |
| --- | --- | --- | --- | --- | --- |
| Overall Semantic | `1.0` (`36/36`) | `1.0` (`36/36`) | `1.0` (`36/36`) | `0` | `null` (offline) |

## Fault Injection / Recovery (Reported Separately)

| Cohort | `pass^1` (denom) | `pass^3` (denom) | `pass^5` (denom) |
| --- | --- | --- | --- |
| Fault Injection / Recovery | `1.0` (`4/4`) | `1.0` (`4/4`) | `1.0` (`4/4`) |

## P15 Manual Semantic Review

- **Total Reviewed**: `15`
- **Overall Semantic Pass Rate**: `1.0`

## Artifacts

- [manifest.json](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/manifest.json)
- [report.json](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/report.json)
- [report.csv](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/report.csv)
- [trials.jsonl](file:///home/khovan/Workplaces/LCSP/deepagents/evals/reports/pilot-v1/trials.jsonl)

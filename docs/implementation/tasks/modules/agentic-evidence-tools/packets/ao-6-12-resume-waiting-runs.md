---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-12-resume-waiting-runs
jira_issue: LCSP-213
status: DONE
---
# TASK-AO-6-12 — `resume_waiting_runs`

## Objective and tool definition

Resume only durable orchestration runs waiting for the exact newly activated compatible corpus version. `SYSTEM_ONLY` mutation, PBAC `WORKFLOW_RESUME`, driven by activation outbox; it locks/idempotently enqueues checkpoint continuation and never lets an LLM select runs.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `activationRecordRef` | yes | immutable successful activation record |
| `corpusVersionRef` | yes | exact `APPROVED` corpus version |
| `maxRuns` | yes | 1–500; server cap wins |
| `idempotencyKey` | yes | UUID for activation/resume batch |

```json
{"type":"object","additionalProperties":false,"properties":{"activationRecordRef":{"type":"string","pattern":"^corpus-approval:[A-Za-z0-9_-]{3,128}$"},"corpusVersionRef":{"type":"string","pattern":"^corpus-version:[A-Za-z0-9_-]{3,128}$"},"maxRuns":{"type":"integer","minimum":1,"maximum":500},"idempotencyKey":{"type":"string","format":"uuid"}},"required":["activationRecordRef","corpusVersionRef","maxRuns","idempotencyKey"]}
```

## Output and real example

```json
{"status":"READY","toolName":"resume_waiting_runs","toolVersion":"1.0.0","configHash":"sha256:resume-v1","correlationId":"714849c8-4339-4a67-a2a0-65bc5af9f117","artifactVersions":{"corpusVersionId":"corpus_01JQD"},"provenanceRef":"prov:resume:01","coverageState":"SUFFICIENT","evidenceRefs":["resume-batch:resume_01","workflow-checkpoint:run_01"],"limitations":[],"result":{"resumeBatchRef":"resume-batch:resume_01","eligibleRunCount":2,"resumedRunCount":2,"skippedRunCount":1,"skips":[{"runRef":"workflow-run:run_09","reason":"CORPUS_VERSION_MISMATCH"}],"outboxEventRef":"outbox:waiting-runs-resumed:01"}}
```

## Execution, registry, and LLM context

Verify activation/version binding → select only `WAITING`/`BLOCKED` runs whose typed requirement asks for exact compatible version → acquire run locks/idempotency → append checkpoint transition and outbox events → audit. `WaitingRunResumeTool`, `SYSTEM_ONLY`, mutation, 30 s timeout, one queue transient retry; per-run exhausted failures go DLQ under AO-3 policy. LLM receives no run list; it later sees its own resumed state only.

## Errors, tests, files, and open questions

Wrong/inactive version `BLOCKED`; stale checkpoint/transition conflict `CONFLICT`; no eligible runs is `READY` empty; queue failure `FAILED` with safe batch limitation. Test duplicate event, unrelated version exclusion, lock contention, exactly-once checkpoint/outbox, DLQ/retry, audit privacy. Files: graph runtime resume worker, outbox consumer, workflow contracts/tests. OQ-01: confirm compatibility rule for assessments pinned to a superseded corpus.

## Acceptance criteria

1. Only exact eligible blocked/waiting runs resume, deterministically and idempotently.
2. Every resume has checkpoint, audit and outbox trace.
3. Unrelated/stale runs are safely skipped, never mutated.

## Source authority

`shared-tool-contract.md`; `orchestration-state-machine.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.

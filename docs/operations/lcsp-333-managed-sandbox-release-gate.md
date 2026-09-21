# LCSP-333 managed sandbox release gate

LCSP-333 release readiness is blocked until a managed-sandbox proof artifact is
validated. Unit tests, mocked sandbox declarations, GitHub CI alone, or code
review PASS are not sufficient proof.

## Commands

Validate a real managed-sandbox proof:

```bash
pnpm run check:managed-sandbox-release-gate -- \
  --proof artifacts/lcsp333-managed-sandbox-proof.json \
  --out artifacts/lcsp333-managed-sandbox-gate-result.json
```

Validate the gate implementation itself:

```bash
pnpm run test:managed-sandbox-release-gate
```

For pull requests that touch the release-gate surface, CI also requires the
`Managed sandbox proof` job. It runs on a self-hosted runner carrying
the `lcsp-managed-sandbox` label. That runner must provide the
`lcsp-managed-sandbox-proof` executable. The executable is the production
proof producer: it must start the canonical PR-triggered review run, exercise
Scanner → PGE → Interview or governed no-interview → EngineeringRule → Planner
→ Investigator, observe durable runtime/Web evidence and restart
reconciliation, re-check GitHub CI/mergeability and the final PR head, sanitize
the evidence, and write `LCSP333_MANAGED_SANDBOX_PROOF_V1` to the requested
`--out` path. Missing runner capacity, a missing producer executable, or a
missing/invalid proof fails the required job; fixture proof is not accepted by
this CI path.

The self-hosted producer is scheduled only when repository variable
`LCSP_MANAGED_SANDBOX_RUNNER_ENABLED` is exactly `true`. Leave the variable
unset or false until at least one trusted runner with the required host-managed
producer and verifier binaries is registered. In that state the PR-owned
diagnostic records `BLOCKED_NO_RUNNER` on GitHub-hosted compute instead of
leaving the proof job queued indefinitely. This diagnostic is non-authoritative:
its success only means the diagnostic ran to completion, not that release
readiness passed. The authoritative release gate remains unsatisfied until the
trusted control plane publishes a valid exact-head proof, NOT_APPLICABLE, or a
governed exemption.

The privileged producer job is restricted to same-repository pull-request
branches. Fork pull requests never execute on the self-hosted managed-sandbox
runner. The PR-owned managed-sandbox diagnostic runs only on GitHub-hosted
isolated compute, so NOT_APPLICABLE and fork decisions never depend on or
execute commands on the privileged runner. A fork or unavailable sandbox fails
closed unless a separately governed trusted workflow/service supplies an
approved exemption outcome without executing fork-controlled workflow code on
the managed-sandbox host. The privileged job does not check out PR code, install
PR dependencies, or execute repository lifecycle scripts on the host. It invokes
only host-managed producer and verifier binaries with immutable PR/base/head
identifiers and writes into a fresh runner-temporary proof directory.

The host-managed verifier is the authoritative proof-validation boundary. It
validates schema, exact-head identity, lifecycle/correlation, CI/mergeability,
and privacy before any proof is uploaded to GitHub. Only a proof that passes
this trusted pre-upload verification may be persisted as an Actions artifact.
The trusted gate result must record the verifier version or hash for
auditability.

The branch-protection authority is deliberately separate from this
PR-controlled workflow. The pull-request workflow must not be the release
authority for `Managed sandbox readiness gate`; the job here is named
`Managed sandbox readiness diagnostic` and is non-authoritative. The live
develop ruleset must either bind the required readiness status to a trusted
GitHub App/external governance service by `integration_id`, or replace the
name-only status requirement with a required workflow whose definition is
resolved only from an approved protected ref or immutable SHA outside candidate
PR control. A ruleset that requires only the context string
`Managed sandbox readiness gate` is not sufficient, because a candidate
GitHub Actions workflow can emit a same-named job. The trusted control plane
must validate the host-managed proof or governed exemption for the exact head
before publishing success.

The PR-owned diagnostic treats a pull request outside the release_gate path
surface as NOT_APPLICABLE and succeeds on GitHub-hosted compute without starting
a managed sandbox, but that diagnostic cannot satisfy branch protection. For an
applicable same-repository pull request, it consumes only the gate result emitted
by the same-repository trusted producer/verifier. The pull-request workflow does
not mint exemptions or publish the authoritative required context.

The trusted control plane publishes or satisfies Managed sandbox readiness gate
only after binding its decision to the exact repository, PR, base SHA and head
SHA. It may publish NOT_APPLICABLE according to protected policy, accept a
verified managed-sandbox result, or accept a separately governed exemption.
Exemptions must originate outside candidate-PR control and fail closed when
expired, mismatched, replayed or unapproved. Fork-controlled workflow commands
must never execute on the managed-sandbox host.

If the managed sandbox is unavailable, release governance may provide a
time-boxed exemption artifact:

```bash
pnpm run check:managed-sandbox-release-gate -- \
  --exemption artifacts/lcsp333-non-sandbox-exemption.json \
  --out artifacts/lcsp333-managed-sandbox-gate-result.json
```

An exemption is not a READY verdict. It records why the sandbox proof was not
available and must be accepted separately by release governance.

## Required proof artifact

The proof JSON must use schema version
`LCSP333_MANAGED_SANDBOX_PROOF_V1` and prove one correlated production-equivalent
execution:

```json
{
  "schemaVersion": "LCSP333_MANAGED_SANDBOX_PROOF_V1",
  "run": {
    "prNumber": 338,
    "runId": "review-run-338-1",
    "generation": 1,
    "baseSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "triggerType": "webhook:synchronize",
    "triggerId": "delivery-338",
    "status": "COMPLETED",
    "terminalVerdict": "READY"
  }
}
```

The full artifact must also include:

- exact-head evidence: pinned PR head, sandbox checkout SHA, and final head
  re-check;
- one authoritative canonical run for the current PR/head/generation whose
  lifecycle state matches run.status; the run must be terminal, and READY/PASS
  is valid only with run.status=COMPLETED;
- restart reconciliation proving stale/orphaned runs were superseded, cancelled
  or failed with a reason;
- managed sandbox host kind, sanitized log refs and artifact refs;
- exact-head CI check-run IDs, pending checks and GitHub mergeability state;
- completed pipeline stages from PR trigger through terminal verdict, including
  Scanner, PGE, Interview/no-interview branch, EngineeringRule selection and
  evaluation, Planner, Investigator, runtime persistence and Web/SSE
  observability;
- correlation IDs for PR/run/head/assessment/scanner/PGE/runtime/agent/rule/tool
  and check runs;
- persisted UI-visible runtime event classes required to reconstruct the Web
  timeline after reconnect/restart;
- regression evidence for PR #335 duplicate-run cleanup, PR #338 green
  exact-head readiness, PR #336 code-PASS-but-CI-pending non-readiness, and
  selected-run cancellation isolation.

## Privacy invariants

The proof and linked logs/artifacts must already be sanitized before validation.
The validator rejects secret-like values and raw fields named like system
prompts, developer prompts, hidden reasoning, private context, unrestricted
source, credentials, API keys, passwords or access tokens unless they are
explicitly redacted.

Never include:

- credentials, token-bearing URLs or secret environment values;
- raw system/developer prompts;
- hidden chain-of-thought or hidden model reasoning;
- unrestricted customer/private context;
- unrestricted repository source.

# W3 Repository Citation Boundary Preparation

## Scope and verdict

**Preparation only — not production acceptance, not a W1 gate, and not a W3
integration-gate result.** This work adds one focused pytest module that exercises
the current repository citation/evidence-reference implementation against real,
temporary repository bytes. It does not change production code, shared contracts,
lifecycle, Prisma, entrypoints, existing tests/fixtures, services, or any other
report.

The W3 production gates remain **BLOCKED / NOT PROVEN**. This preparation proves
only the currently observable mechanical citation boundary; it does not prove
native Deep Agents task semantics, tenant/API isolation, persistence, checkpoint
restart, concurrent writes, or semantic legal/compliance decisions.

## Current source authority and call path

The architecture-freeze and domain-preparation reports were read in full before
editing. The current implementation was then traced from the production callers
and read directly:

| Source | Current behavior |
| --- | --- |
| `deepagents/tools/common/capabilities/assessment/rule_assessment/evidence_refs.py:21-35` | A process-local random `_KEY` signs `{assessmentId, first engineeringRuleId, ruleExecutionId, canonicalRef}`. |
| `evidence_refs.py:38-70` | Canonical parsing checks the shape and pinned `commitSha`, then verifies the HMAC; it returns no entry on tampering or context replay. |
| `evidence_refs.py:73-108` | A citation requires exactly one rule execution, normalizes the path/range, calls live `verify_repository_source(..., required=True)`, then mints the transient ref. |
| `deepagents/tools/common/submit_rule_assessment/code.py:112-145` | `cite_repository_source` is the model-facing caller of `cite_verified_source`; the test deliberately exercises the production function directly rather than duplicating its tool advertisement. |
| `deepagents/tools/common/codebase_memory_graph/code.py:137-156` | `get_code_snippet` is the second caller; graph output is navigation and citation is attempted only in a rule execution. |
| `deepagents/tools/common/capabilities/assessment/rule_assessment/validation.py:168-214` | Rule submission parsing accepts a MAC-bound ref only for the current context, re-verifies the live range, and persists the canonical ref/provenance. |
| `deepagents/tools/common/capabilities/assessment/claims/evidence_claim/evidence_claim_validator.py:261-342` | Path normalization and live repository verification remain mechanical and fail closed for traversal, missing files, non-UTF-8 bytes, and out-of-bounds lines. |
| `evidence_claim_validator.py:280-291, validation.py:233-240` | Production-source/source-role and claim guards remain separate mechanical checks; they were not weakened or reimplemented here. |

The current runtime context fields used by the MAC are defined at
`deepagents/orchestration/context.py:14-42`.

## Existing coverage versus new coverage

Existing `deepagents/tests/investigation/test_direct_repository_claims.py:118-267`
covers direct production-source claims, backend absence, baseline/snapshot
provenance, source-role rejection, stamped claim provenance, and closed claim
value/confidence. Existing
`deepagents/tests/test_assessment_researcher_isolation_fixtures.py:21-145` checks
synthetic W3 packet/namespace fixture structure only; it does not call the
current citation functions. No existing test directly covered
`mint_evidence_ref`, `parse_verified_evidence_ref`, or `cite_verified_source`.

The new module adds only that missing boundary:

| New test coverage | New test lines | Cases |
| --- | ---: | ---: |
| Valid live citation and parse | `deepagents/tests/test_repository_citation_boundary_preparation.py:107-122` | Real `tmp_path` source bytes, valid range, minted MAC ref, parsed canonical entry. |
| Ref mutation rejection | `...:125-133` | Tampered MAC, commit, path, and line range. |
| Context replay rejection | `...:136-152` | Cross-assessment, cross-rule, and cross-execution replay. |
| Live source input guards | `...:155-172` | Invalid range, traversal, reserved `.git`, missing source, and out-of-bounds range. |
| Rule-execution requirement | `...:175-180` | Citation is unavailable without one live rule execution. |
| Actual rule-submission re-check | `...:183-195` | `validate_rule_assessment` accepts a current minted ref, stores canonical ref, then rejects it after the real temp file is removed. |
| Process-secret boundary | `...:197-223` | A fresh interpreter cannot parse the prior process's MAC. |

The parameterization yields 17 focused tests without adding a fake validator,
native-tool packet matrix, provider call, or semantic assertion.

## Verification

Commands were run from the checkout root with the existing Deep Agents project
environment:

```text
rtk uv run --project deepagents --extra dev pytest -q deepagents/tests/test_repository_citation_boundary_preparation.py
17 passed in 1.12s

rtk uv run --project deepagents --extra dev pytest -q \
  deepagents/tests/investigation/test_direct_repository_claims.py \
  deepagents/tests/test_repository_sandbox.py
32 passed in 1.46s

rtk graphify update . --no-cluster
exit 0; AST-only graph update; 26,873 nodes, 69,280 edges
```

The graph update made no semantic/provider calls. It reported 96 SQL files with
no `tree_sitter_sql` dependency and one existing partial extraction warning for
`apps/api/test/smoke.e2e-spec.ts`; neither warning came from the new test/report
files and neither is a production acceptance result.

## Honest boundary limits

- The current MAC is **not** native root-task, tenant, root-thread, snapshot,
  case-revision, or source-hash binding. It binds only the assessment, first
  rule ID, rule execution, and canonical commit/path/range.
- The process-secret MAC is **not durable evidence**. A restart invalidates the
  transient ref, as directly demonstrated; persistence must later mint/verify a
  durable server-owned evidence record.
- Current live verification checks the supplied repository root, normalized path,
  UTF-8 decoding, and line bounds. It does not itself establish W3 server
  ownership, tenant authorization, task lineage, snapshot marker, or source hash.
- Graph/codebase-memory results, code canaries, test-source results, and fixture
  packets are navigation/isolation material only; none is accepted here as
  production legal/compliance evidence. No semantic applicability, criterion,
  compliance, absence, or report determination is made.
- No API, PostgreSQL, outbox, native `task()`, checkpoint/restart, concurrent
  assessment, cross-tenant, or production image proof was run. These remain
  future W3 boundaries and **NOT_PROVEN**.

## Untouched-file scope

Only these new files were added by this preparation:

```text
deepagents/tests/test_repository_citation_boundary_preparation.py
reports/w3-repository-citation-boundary-preparation.md
```

No production/source/shared-contract/lifecycle/Prisma/entrypoint file, existing
test or fixture, service, API/web surface, provider, database, or other report
was changed. Pre-existing untracked worktree files remain untouched. W1/W2/W3
production gates remain blocked pending their independent acceptance work.

## Correction / evidence append — 2026-10-06

### Root cause

The original `_tamper` helper in the focused test module rebuilt commit, path,
and range mutations as `source:{commit}:{path}#L{start}-{end}` (for example,
`#L2-4`). The production grammar is `#L{start}-L{end}`; therefore those three
mutations were malformed before they reached the intended commit/path/range
integrity checks. The earlier `17 passed` focused result remains historical, but
its mutation cases could pass merely because `parse_verified_evidence_ref`
returned `None` for malformed syntax; it did not prove rejection of well-formed
tampered refs.

### Fix

Only the preparation test was corrected. `_tamper` now uses native string
replacement against the minted canonical ref, preserves `#Lstart-Lend`, parses
each non-MAC mutation before rejection, and asserts the parsed entry differs from
the original only in the intended `commitSha`, `path`, or `endLine` field. The MAC
case keeps the canonical entry unchanged and mutates only the MAC. The fresh
interpreter subprocess now has a 10-second timeout. No production/shared
contract/security/lifecycle/API/web/database/provider code was changed.

### Evidence and verification

The source contract was rechecked directly: `evidence_refs.py:22` requires
`#L(\d+)-L(\d+)`; `evidence_refs.py:51-54` mints that grammar;
`evidence_refs.py:57-70` parses the canonical entry before checking commit and
MAC; `evidence_refs.py:82-108` live-verifies the supplied repository range before
minting; and `evidence_claim_validator.py:294-342` verifies actual repository
bytes and line bounds. The corrected helper is at
`deepagents/tests/test_repository_citation_boundary_preparation.py:63-96`, and
the bounded subprocess is at `:223-230`.

Commands were run from the checkout root with the existing `deepagents` project
and `dev` extra; each focused test creates a real temporary `src/service.py` and
uses the current citation functions. No service, browser, API, PostgreSQL,
provider, or toolchain change was involved, and this worker did not run
`graphify update` (the coordinator owns that shared operation).

```text
rtk uv run --project deepagents --extra dev pytest -q deepagents/tests/test_repository_citation_boundary_preparation.py
17 passed in 4.58s

rtk uv run --project deepagents --extra dev pytest -q \
  deepagents/tests/investigation/test_direct_repository_claims.py \
  deepagents/tests/test_repository_sandbox.py
32 passed in 1.95s
```

This is 49 focused/adjacent tests passing after the correction. The result is
still preparation-only mechanical proof; W1/W2/W3 production gates remain
**BLOCKED / NOT PROVEN**, including native Root/task semantics, tenant/API
isolation, durable persistence, checkpoint/restart, concurrency, and semantic
legal/compliance acceptance.

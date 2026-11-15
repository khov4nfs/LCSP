---
title: 'Detect AI dependencies during repository pre scan'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_commit: '7776c15f0f70640cd96289f9f285b1a099565429'
review_loop_iteration: 0
context:
  - 'docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deterministic repository pre-scan records AI and ML packages as manifest dependencies but does not classify common provider SDKs, orchestration libraries, or ML frameworks. Assessment Root therefore receives weaker reconnaissance hints and must rediscover obvious AI dependency signals during targeted investigation.

**Approach:** Extend the shared pre-scan framework categories and Python scanner catalogue for common JavaScript and Python AI dependencies. Emit provenance-bound candidate facts that state only that a dependency is declared while retaining the existing V1 scanner version as explicitly directed by the product owner.

## Boundaries & Constraints

**Always:** Keep scanning read-only, deterministic, offline, scope-aware, secret-redacted, and bounded. Preserve exact manifest path and line provenance. Describe dependency declarations as investigation leads; never infer reachable model invocation, production use, operator behavior, legal applicability, or compliance from package presence. Retain `LCSP_PRE_SCAN_V1`; new scans receive the catalogue, while an already cached V1 profile may remain unchanged until normal cache invalidation or a repository commit/scope change.

**Ask First:** Adding runtime dependencies, changing repository source-scope rules, changing persisted assessment decisions, or introducing source/AST execution requires separate approval.

**Never:** Execute customer code, install packages, call a model or provider, scan excluded paths, treat an AI package as proof of AI use, or add the later scan-pricing feature in this change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| JavaScript AI dependency | `package.json` declares OpenAI, Anthropic, LangChain, Google GenAI, Vercel AI SDK, TensorFlow.js, or Transformers.js packages | Framework observation uses the correct AI category and candidate fact cites the dependency line | Existing malformed or oversized manifest handling remains unchanged |
| Python AI dependency | `requirements.txt` or supported `pyproject.toml` dependency syntax declares OpenAI, Anthropic, LangChain, Google GenAI, PyTorch, TensorFlow, Transformers, or scikit-learn | Framework observation and candidate fact identify the declared package with exact manifest provenance | Unsupported syntax remains a recorded dependency gap or unclassified dependency, never a guessed fact |
| Cached V1 profile | Cache contains `LCSP_PRE_SCAN_V1` | Existing cache behavior is preserved; no forced rescan is introduced | A later explicit cache invalidation or changed repository commit/scope regenerates the profile with the new catalogue |
| Unknown dependency | Manifest declares an unlisted package | Dependency remains in manifest output without an AI classification | No false AI candidate fact is emitted |

</frozen-after-approval>

## Code Map

- `deepagents/tools/common/capabilities/platform/repository_scanner.py` -- scanner version, dependency catalogue, framework observations, and candidate facts.
- `deepagents/tests/test_repository_scanner.py` -- deterministic Python scanner regression coverage across manifest types.
- `packages/contracts/src/assessment-domain/repository-profile.ts` -- shared framework category value sets; scanner version remains V1.
- `packages/contracts/test/repository-profile.spec.ts` -- repository profile schema compatibility tests.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/assessment-domain/repository-profile.ts` -- add AI provider SDK, AI orchestration, and ML framework categories without changing the V1 scanner value.
- [x] `deepagents/tools/common/capabilities/platform/repository_scanner.py` -- classify the approved npm and Python package aliases and emit declaration-only candidate facts consistently for package.json, requirements.txt, and pyproject.toml.
- [x] Scanner and contract tests -- cover categories, exact provenance, absence of overclaiming, unknown packages, and retention of V1.

**Acceptance Criteria:**
- Given a supported manifest declares a catalogued AI package, when pre-scan runs, then its profile contains a correctly categorized framework observation and an evidence-cited candidate fact limited to the dependency declaration.
- Given only an AI dependency declaration, when the profile is produced, then no output claims that model invocation is reachable or that the application uses AI in production.
- Given a valid cached V1 profile, when the current scanner loads the same repository commit and scope, then existing cache reuse behavior remains unchanged as directed by the product owner.
- Given an unknown package or a scoped-out path, when pre-scan runs, then no AI classification is fabricated.

## Spec Change Log

## Design Notes

Use three contract categories: `AI_PROVIDER_SDK` for provider clients, `AI_ORCHESTRATION` for prompt/agent workflow libraries, and `ML_FRAMEWORK` for training/inference libraries. Catalogue entries are explicit exact package names; broad packages such as `boto3` are not classified because they do not establish AI intent.

## Verification

**Commands:**
- `cd deepagents && uv run pytest tests/test_repository_scanner.py -q` -- all scanner unit tests pass.
- `pnpm --filter @lcsp/contracts test` -- shared profile schema tests pass.
- `pnpm run check:business-logic-docs && pnpm run test:business-logic-docs` -- changed business functions retain required documentation.
- `pnpm run check:contracts` -- no forbidden contract value-set literals are introduced.

**Results:**
- Scanner tests: 18 passed, including review-driven ecosystem, PEP 621, and provenance cases.
- Contract tests: 134 passed across 9 suites (`--watchman=false` used because the sandbox blocks Watchman's state directory).
- Business-logic documentation checker and its 5 checker tests passed.
- Contract literal policy and `@lcsp/contracts` build passed.

## Suggested Review Order

**Catalogue boundaries**

- Start with ecosystem-specific aliases that prevent cross-registry false positives.
  [`repository_scanner.py:280`](../../deepagents/tools/common/capabilities/platform/repository_scanner.py#L280)

- Review shared contract categories while scanner version remains V1.
  [`repository-profile.ts:53`](../../packages/contracts/src/assessment-domain/repository-profile.ts#L53)

**Evidence extraction**

- Python normalization centralizes declaration-only facts and exact provenance.
  [`repository_scanner.py:787`](../../deepagents/tools/common/capabilities/platform/repository_scanner.py#L787)

- PEP 621 and Poetry parsing distinguish production, optional, and development dependencies.
  [`repository_scanner.py:919`](../../deepagents/tools/common/capabilities/platform/repository_scanner.py#L919)

- Section-scoped lookup prevents package.json metadata from corrupting evidence lines.
  [`repository_scanner.py:1271`](../../deepagents/tools/common/capabilities/platform/repository_scanner.py#L1271)

**Regression coverage**

- Catalogue tests verify npm/Python categories and reject runtime-use overclaims.
  [`test_repository_scanner.py:75`](../../deepagents/tests/test_repository_scanner.py#L75)

- Edge tests cover PEP 621 group names and duplicate package.json occurrences.
  [`test_repository_scanner.py:191`](../../deepagents/tests/test_repository_scanner.py#L191)

- Contract test locks AI categories to the retained V1 scanner value.
  [`repository-profile.spec.ts:146`](../../packages/contracts/test/repository-profile.spec.ts#L146)

# W2 native Legal Preparation prompt preparation

Status: **DRAFT — preparation only.** No semantic, provider, W1 integration-gate, W2
integration-gate, API activation, or production acceptance is claimed.

## Owned scope

Only these new files are owned by this task:

- `deepagents/tests/fixtures/legal_preparation_eval/native-preparation-prompt.md`
- `reports/w2-native-legal-prompt-preparation.md`

Existing legal corpus, cases, rubric, parser tests, native researcher tests, current
Triage/skill/entrypoint code, API/contracts/Prisma/web/i18n, and all other worktree
changes remain read-only. No dependency, framework, test harness, registration, source,
schema, lifecycle value, or portfolio output schema was added.

## Result

The prompt asset is the smallest reusable instruction packet for the future native Legal
Preparation owner. It requires one server-pinned corpus version and exact source/document/
locator/hash citations; preserves definitions, scope, qualifiers, exceptions and
cross-references; requires complete coverage or a source-grounded non-assessable reason;
authors both LegalRule/context meaning and bounded EngineeringRule obligations; and keeps
non-repository duties in the portfolio without inventing repository evidence.

It explicitly excludes assessment/customer/repository context, semantic regex or
deterministic legal judgment, duplicate cache/bundle authority, and human legal approval,
signoff, publish, discard, or review handoff. It leaves the W2 submit envelope and all
lifecycle/status values to the future contract owner; integrity validation may reject
identity/provenance/structure defects, then valid output activates automatically and an
invalid attempt preserves the prior `ACTIVE` pointer.

## Freeze and ledger mapping

| Draft instruction | Authority/evidence |
|---|---|
| Corpus snapshot -> Legal Preparation -> LegalRule/context -> EngineeringRule -> integrity validation -> one atomic active portfolio | Freeze §1, `reports/architecture-freeze-migration-manifest.md:13-18,33` |
| Legal interpretation owns definitions, scope, cross-references, exceptions, qualifiers and operative effect; the agent authors LegalRule and EngineeringRule | Freeze §2, `reports/architecture-freeze-migration-manifest.md:49-55,76` |
| Deterministic code validates identity, hashes, citations, structure and activation integrity only; it cannot decide legal meaning | Freeze §1-2, `reports/architecture-freeze-migration-manifest.md:39,66-72` |
| Legal Preparation is isolated from assessment/customer/repository context and shared memory | Freeze §§1,5-6, `reports/architecture-freeze-migration-manifest.md:35,199-212,220-233` |
| One pinned corpus, complete coverage, one submission, automatic activation, no approval, failed attempt leaves old `ACTIVE` unchanged | Freeze final flow, `reports/architecture-freeze-migration-manifest.md:338` |
| W2 owner replaces Triage with one Legal Preparation agent; no assessment/customer/repository context or human review handoff | Freeze W2 DAG/gate, `reports/architecture-freeze-migration-manifest.md:377-384` |
| Definitions/qualifiers/exceptions/cross-references, non-repository duty, fake/stale/repealed refs, duplicate/orphan IDs, coverage, and prior-active preservation are reviewed acceptance dimensions | Freeze W2 gate and §12, `reports/architecture-freeze-migration-manifest.md:384,438-440` |
| W1 integration gate is still pending; W2–W7 task specs follow its PASS, and production remains NOT PROVEN | Ledger, `reports/agentic-migration-coordinator-ledger.md:3-13,37` |
| This task owns only the prompt/report after accepted fixture prerequisites; no output schema or production registration | Ledger, `reports/agentic-migration-coordinator-ledger.md:197-217` |

## Accepted fixture and case mapping

The prompt references, but does not copy, the accepted corpus payloads:

- Pins and source bytes: `deepagents/tests/fixtures/legal_portfolio_context/pins.json`,
  `synthetic-notice-v1.txt`, and `synthetic-notice-v2.txt`.
- Valid review corpus: `SYNTHETIC-CORPUS-V1`, document
  `SYNTHETIC-NOTICE-INSTRUMENT`, with the accepted source SHA in `pins.json`; the
  prompt repeats only that source hash and reads the per-locator chunk hashes from the
  accepted pins. V2 is contrast-only and changes `art-5::cl-1`.
- Existing integrity test evidence: `deepagents/tests/test_legal_preparation_eval_fixtures.py:20-66`
  verifies exact pins, bytes, hashes, representative text, and the single changed
  locator; `:68-102` verifies same-version references and complete accepted coverage.
- Existing invalid-case evidence: `deepagents/tests/test_legal_preparation_eval_fixtures.py:104-199`
  retains all eight intentional invalid cases and their expected mechanical actions.
- Existing rubric boundary: `deepagents/tests/test_legal_preparation_eval_fixtures.py:201-224`
  assigns semantics to `LEGAL_PREPARATION_AGENT`, mechanics to
  `PORTFOLIO_INTEGRITY_BOUNDARY`, and keeps semantic/production acceptance `NOT_PROVEN`.

The five valid anchors are deliberately used as follows:

| Case ID | Instructional behavior |
|---|---|
| `definition-retained` | Follow the defined term as context for the operative provision; do not silently drop or invent a technical duty. |
| `qualifier-retained` | Preserve actor, scope, timing and limiting language and cite its same-version context. |
| `exception-retained` | Keep the exception attached to the qualified duty without erasing the separately operative external duty. |
| `cross-reference-context` | Resolve the referenced definition, scope and exception inside one exact corpus version. |
| `non-repository-duty-represented` | Keep the external/in-person duty in the portfolio and state why repository evidence cannot establish it. |

## Adversarial walkthrough

This is a design walkthrough against existing cases, not an executed semantic/provider
evaluation and not a claim that any production validator or activation path ran.

| Existing case | Expected prompt/owner behavior | Boundary owner |
|---|---|---|
| `fake-reference` | Do not invent or cite an unresolved locator; withhold submission. | Integrity rejects unresolved source reference; agent reports the limitation. |
| `stale-reference` | Use the declared hash only if it matches the selected version; V2's changed `art-5::cl-1` cannot stand in for V1. | Integrity rejects stale source hash. |
| `repealed-reference` | Preserve the supplied legal effect status and do not treat a repealed source as current operative authority. | Integrity rejects repealed source reference. |
| `duplicate-rule-id` | Do not emit duplicate LegalRule identities. | Integrity rejects duplicate IDs. |
| `orphan-context-relation` | Every context relation must resolve to an authored rule/source within the same pinned portfolio. | Integrity rejects orphan relation endpoints. |
| `coverage-gap` | Do not claim complete coverage while excluding `art-6::cl-1`; represent it or explicitly explain non-assessability. | Integrity rejects incomplete coverage. |
| `mixed-corpus-versions` | Refuse to combine V1 and V2 citations in one preparation. | Integrity rejects mixed corpus versions. |
| `failed-attempt-preserves-earlier-active` | A failed packet cannot replace the prior active pointer; no human publish/discard decision is introduced. | Atomic activation preserves the prior `ACTIVE` portfolio. |

## Current read-only entrypoint and replacement seams

The graph-first search located the current Triage symbols; direct source inspection
confirmed these exact seams. They are evidence for the future W2 owner, not edits made by
this preparation task.

| Current source | Observed boundary | Future W2 seam |
|---|---|---|
| `deepagents/agent.py:29,74-105` (`TRIAGE_SUBAGENT`, `create_root_agent`) and `deepagents/subagents/__init__.py:12-29` | Native root registers the current Triage specialist; the root is the current Deep Agents entrypoint. | Replace the registration only after the W2 submit contract is frozen; keep this draft as instruction input, not as a registration change. |
| `deepagents/subagents/triage/definition.py:16-22,25-141,143-162` (`TOOLS`, `SYSTEM_PROMPT`, `SUBAGENT`) | Current prompt loads `legal-rule-triage`, exposes maintenance/work-item/per-rule persist/finish tools, and omits generic runtime context. | Replace this Triage definition with the reviewed Legal Preparation instruction and a contract-owned tool binding; do not copy its per-rule schema or invent a new one here. |
| `deepagents/tools/triage/legal_rule_triage/code.py:19-143,145-203` | Current model-facing schema is per-rule `Candidate/Context/Reject`, EngineeringRule proposal, persist and finish. | Retire the per-rule surface in favor of the future single portfolio submission boundary. Preserve only contract-approved integrity inputs. |
| `deepagents/tools/triage/legal_rule_triage/service.py:22-229` | `get_work_items` loads approved catalog/chunks and paginates; `persist_result` calls `prepare_from_triage`; `finish_or_drain` releases the Triage singleton. | Rewrite around one pinned corpus and one complete portfolio submission after API contract acceptance; remove catalog/cache/per-rule assumptions. |
| `deepagents/tools/triage/legal_rule_triage/boundary.py:19-109` and `deepagents/tools/common/capabilities/agent_runtime/invocation.py:80-84` | Readiness RabbitMQ handling stores assessment waiting state and dispatches `triage`. | Replace with corpus/admin/source-change preparation; no assessment checkpoint or readiness payload may cross the Legal Preparation boundary. |
| `deepagents/schedules/legal_catalog_daily.py:5-28` and `deepagents/instructions.md:37-91` | Schedule/instructions describe Triage singleton, assessment reconciliation and per-rule work. | Point schedule/admin triggers at the single W2 preparation command once its contract is frozen; retain no second legacy prompt path. |
| `deepagents/tools/legal/corpus/engineering_rules/orchestration/service.py:46-69,174-237,295-416,490-517` | `get_or_compile`, `prepare_from_triage`, source retargeting and artifact writers maintain duplicate cache/bundle authority. | Keep source/integrity mechanics only; make the database portfolio the sole runtime authority after the W2 vertical. |

## Verification and non-claims

- Read-only discovery used the existing code knowledge graph first (`search_graph`,
  `get_code_snippet`, and `trace_path` for the root entrypoint), then direct reads for
  non-code fixture/Freeze details and graph-missed seams. No full re-index was run.
- The two new Markdown assets were checked for trailing whitespace; the one-line hashes
  and compact mapping rows are intentional. Existing fixture/parser tests were not
  modified or rerun as a production claim.
- No model/provider/API/database/browser/activation call was made. No semantic quality,
  citation correctness, tenant isolation, atomic transaction, or W2 gate PASS is claimed.
- The prompt is intentionally not a skill, framework, test harness, production
  registration, API contract, Prisma change, or semantic judge. The W2 owner must freeze
  the submit contract, bind the prompt, and run the reviewed semantic/live vertical before
  any acceptance claim.

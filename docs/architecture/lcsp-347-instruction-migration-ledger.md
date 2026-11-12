# LCSP-347 instruction migration ledger

## Current P1-I6E/F/G checkpoint

The current machine-readable verification artifact is
`deepagents/instructions/verification-report.json`. It supersedes the historical
counts below: **299 local construction records**, comprising all **98 original
records** and **201 additional AST records**, **57 VI draft sources**, and
**109 distinct local file/symbol consumers**. There are **264 shared-source
consumer records**, **8 runtime-data records**, **17 non-model-facing records**
and **10 third-party-forwarding records**. These site counts reconcile to 299;
the separately fingerprinted **19 package instruction surfaces** are not added
to the local count. There are **zero pending local source mappings**.

All local discoveries now carry final disposition evidence. Shared consumers
reference their canonical VI source; site-level references supplement the
source's actual consumer-symbol list. Tool field descriptions are checked
against the actual Pydantic declarations; every promoted tool docstring has a
keyed VI description, including all 13 claim-tool factory specs and the legacy,
authoring and direct validation/submission overrides. Python engineering
docstrings, tool schemas and allowlists remain intact for P1-I8 cutover.

New sources cover tool schemas, Root/graph tool descriptions, Preparation tool
descriptions, skill catalogs, observation/error recovery, budget finalization,
text/JSON response transformation, runtime identity context and authoring-state
reconstruction. Template locale/language parameters are closed enums with pair
validation; history counts accept only nonnegative integers. Unknown fields,
attribute traversal, format conversions, extra parameters and unsafe values
are rejected. Data such as source quotes and prior tool receipts remains data.

The compiler consumes the real inventory and reports all **57 missing EN
candidates** without output. Complete candidates will additionally require
matching VI-origin digest, EN-candidate digest and translator/revision
provenance. Compilation only produces PENDING candidates. There is no runtime
translation, approval generation or legacy fallback added.

### Framework boundary remains a technical gate

Installed dependencies: Deep Agents **0.7.17**, LangChain **1.4.2**,
langchain-core **1.6.4**, LangGraph **1.2.18**. The ledger fingerprints 19 actual
package symbols and records their override points. General-purpose/fork
defaults are inactive under the current explicit delegate setup, but remain
guarded against later activation. Active task, TodoList, filesystem and summary
injection paths are not exempt from the VI source requirement.

Public override points exist for TodoList system/tool descriptions,
FilesystemMiddleware system/custom-tool descriptions,
create_summarization_middleware(summary_prompt=...), and HarnessProfile prompt
and task overrides. Task schema fields, filesystem argument schemas, fork
preamble and call-limit message handling still need controlled adapter work
and construction-boundary tests. No public-API impossibility is asserted.
`framework_instruction_audit` rejects installed-version/symbol-expression drift;
the strict inventory gate rejects every ADAPTER_REQUIRED surface. The exact
unimplemented paths are listed in UNRESOLVED_INSTRUCTION_PATHS, not hidden by
zero local pending mappings.

Consequently P1-I6 is **PARTIAL**, with strict completion **BLOCKED** by technical
framework adapter work. These blockers are independent of external translation
approval. Runtime cutover is **NOT_RUN**; the existing agent factories still
use legacy instructions until P1-I8. No claim of EN-only runtime or semantic
equivalence is made by the inventory tests.

### Windows regressions found during validation

Root cause 1: the existing Preparation test fixture read Markdown using the
native CP1252 default, causing collection failure. Fix: use explicit UTF-8 on
the three fixture readers; assertions are unchanged.

Root cause 2: materialize_legal_source hashed UTF-8 LF content but Windows
write_text translated newlines to CRLF. refute_source_block correctly detected
different bytes, falsely blocking an otherwise intact materialization. Fix:
write generated source/index files with explicit LF so disk bytes match the
existing content hash calculation. Canonical DB source bytes/IDs are untouched.
The existing intact/broken-source assertions are retained.

### Final checkpoint validation

```powershell
cd deepagents
uv run python scripts/snapshot_instruction_migration.py --write
uv run python scripts/verify_instruction_inventory.py --output instructions/verification-report.json
uv run pytest -q tests/test_instruction_inventory_reconciliation.py tests/test_instruction_lifecycle_coverage.py tests/test_instruction_tool_coverage.py tests/test_instruction_source_inventory.py tests/test_runtime_instruction_bundle.py tests/test_runtime_instruction_bundle_build.py tests/test_assessment_prompt_locales.py tests/test_preparation_development_scope.py tests/test_preparation_skills_source_agnostic.py tests/test_assessment_skill_architecture.py tests/test_assessment_root_agent.py tests/test_rule_set_preparation_agent.py tests/test_preparation_model_manifest.py tests/test_native_researcher_task_preparation.py
```

Final result: **222 passed in 31.41s** on native Windows CPython 3.11.16.
Earlier expanded attempts recorded one collection error (CP1252 fixture read),
then 218 passed / 1 failed (LF/CRLF materialization integrity), before the fixes
above. New tool-coverage checks also caught missing base validation/submission
entries; those VI entries were added without changing assertions. Final compiler
negative controls reject stale source hashes, invalid EN UTF-8 and drive-relative
paths and never emit output for those inputs. `git diff --check` passes.

P1-I6E: source/consumer bindings delivered; no bundle runtime cutover claimed.
P1-I6F and P1-I6G remain PARTIAL because framework controls are not wired.
All local source drafts remain PENDING_INDEPENDENT_REVIEW. No test approvals,
paid evaluations, PR metadata changes, merge or deployment were performed.

Baseline: `14f281899`. Machine-readable evidence is in
`deepagents/instructions/inventory.json`, using the bundle compiler's existing
schema version. `constructionSites` records the 98 hits from the original query,
including source line, enclosing AST symbol, exact-line fingerprint and evidence.

Initial triage: 27 duplicate/reference consumers, 40 tool/schema description
sites, 5 continuation sites, 7 compaction/history sites, 3 system-instruction
sites, 2 skill-loader sites, 5 runtime-data sites and 9 implementation-only
sites. Classification is migration triage, not proof of complete runtime
coverage: `PENDING_SOURCE_MAPPING` remains explicit. In particular the discovery
query does not find every tool decorator/docstring, phase string, schema
description continued onto later lines, or framework default. Those need AST
expansion and individual source bindings before P1-I6 can pass.

`instruction_source_inventory.validate_inventory` checks declared sources and
their consumers, digest drift, duplicate IDs/paths and the committed construction
ledger. It detects a new/removed hit without relying on a fixed count of 98.
CI must never refresh the ledger automatically. The explicit snapshot command
produces a reviewable diff and must be followed by semantic classification.

Maintained template policy: trusted phase/scope/assignment parameters must be
declared separately from source text. User answers, legal excerpts, tool outputs
and historical messages remain runtime data. Existing receipts/checkpoints are
not rewritten by the migration. An unbound legacy consumer remains a cutover
blocker; the current runtime is not activated against this draft inventory.

Third-party review pending: native filesystem, TodoList, task/delegation,
ModelCallLimit and summarization prompts from installed Deep Agents/LangChain
must be inspected at their injection boundaries. Passing the ledger guard does
not imply those instructions are governed.

## Implemented source subset and evidence

43 unique source drafts are registered: two system prompts, four Preparation
phases, one development overlay, one Claim Author boundary, nine skills,
21 Assessment tool guidance/playbooks, two continuation policies, one resume
policy, one history policy and one numeric history-counts template. Eleven new
VI documents were authored and 21 existing VI tool-map entries were extracted
without semantic edits. Root/Researcher and nine VI skills are existing source
inputs. LF normalization is mechanical and enforced by `.gitattributes`.

All sources have stable IDs, draft revision, SHA-256, runtime role, legacy
reference, required flag, consumer symbol and pending independent-review status.
No EN candidate has been declared equivalent to these drafts. Compilation of
the actual inventory reports all 43 missing candidates and writes no output.
After candidates exist it also requires complete migration and matching VI
origin digests; pending source bindings cannot be published.

Current construction binding counts: 12 registered draft consumers, 14 runtime
data/implementation exclusions, 72 pending source mappings. The 27 reference
sites are provisional reference classifications, not 27 independently verified
duplicate instruction sources. Tool-schema field descriptions, base tool
docstrings, Preparation tool guidance/catalogs, observation/error guidance,
budget finalization, response-transform prompts and framework summary/task
defaults remain incomplete. New instruction-construction patterns outside the
original regex still need AST coverage expansion. These are technical work
remaining, independent of translation approval.

Dynamic template contract: `preparation.history-counts` accepts only
draft_version, requirement_count and rule_count as NONNEGATIVE_INTEGER from
PERSISTED_DRAFT_METADATA. The renderer rejects missing/extra fields, arbitrary
text, attribute traversal and formatting/conversion syntax. It is not wired to
runtime yet. Other runtime data remains outside system templates.

## Validation commands and results

On native Windows CPython 3.11.16:

```powershell
cd deepagents
uv sync --extra dev
uv run pytest -q tests/test_instruction_source_inventory.py tests/test_runtime_instruction_bundle.py tests/test_runtime_instruction_bundle_build.py tests/test_assessment_prompt_locales.py tests/test_preparation_development_scope.py tests/test_preparation_skills_source_agnostic.py tests/test_assessment_skill_architecture.py
```

Result: **90 passed**. The first new scope invariant test exposed the missing
literal FULL_SOURCE distinction in the draft overlay; the source was corrected
and the suite rerun. Existing tests were not weakened. `git diff --check` passes.
Graphify is unavailable in this worktree/environment; no graph output exists.
No paid models, approval records, deployment or PR metadata mutations were used.

Checkpoint gates: P1-I6A PARTIAL (all baseline hits recorded, broader audit still
required), P1-I6B PARTIAL (core drafts registered, independent reconciliation
and remaining dynamic instructions pending), P1-I6C PARTIAL, P1-I6D PARTIAL.
The strict completion guard intentionally raises INSTRUCTION_MIGRATION_INCOMPLETE.

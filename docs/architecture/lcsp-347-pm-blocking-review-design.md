# LCSP-347 PM blocking-review implementation design

## Status and scope

This design applies to PR #456 at baseline
`12419d213399c56fe0b7740968e344ef25d6a1c3`.  It deliberately separates
canonical legal authority, model-facing instruction material, customer-facing
localized presentation, and the Development-only catalog projection.  None of
the proposed records create legal authority or stand in for independent legal
or translation approval.

## 1. Runtime instruction bundle contract

Vietnamese source files are the sole maintained instruction source.  Each
source has a stable `sourceId`, immutable source revision, UTF-8 bytes and a
SHA-256 digest.  A checked-in inventory lists every model-facing role,
continuation/compaction prompt, governed tool playbook and skill.

The runtime accepts only an immutable English bundle that contains the complete
inventory for one Vietnamese inventory digest.  The bundle has a bundle ID,
English byte digest, per-entry digest, source inventory digest, translator
provenance, independent approver identity and approval timestamp.  The build
is deterministic from a reviewed snapshot; it never invokes a translation
model at runtime.  `responseLanguage` is presentation metadata only and must
not select a model prompt, skill or tool description.

Agent construction validates the inventory, approval state and every digest
before resolving a model.  Missing, stale, unapproved or corrupted bundles
raise a stable failure before an invocation.  Run manifests record the VI
origin revision/digest, EN bundle ID/digest, per-entry prompt/tool/skill
digests, model identity and source pins.

## 2. Translation approval and integrity contract

Translation approval is an external human fact.  The build contract represents
it as `PENDING`, `APPROVED`, `REJECTED` or `REVOKED`, never infers it from a
green test.  The runtime permits only `APPROVED`.  CI checks that a changed
Vietnamese source invalidates its English bundle and cannot be packaged as
current.  A development fixture may exercise approval mechanics but cannot be
used as production approval metadata.

## 3. Localized business-content storage contract

Canonical entities remain authoritative and unchanged.  A new append-only
localized-content revision references a stable entity identity, canonical
revision/digest, field path and locale.  It stores translated bytes, origin
digest, translation revision, provider/provenance, lifecycle state and safe
error metadata.  The unique idempotency key is the entity identity + canonical
digest + field path + locale + translation revision.

`READY` revisions are immutable.  A changed canonical digest creates a new
pending revision; it never overwrites the old one.  A durable outbox/job record
owns delivery, bounded retries and concurrency.  Read models return only the
requested READY locale plus explicit localization status; they never label a
fallback language as translated.

Exact legal quotations, source spans/locators, evidence IDs, customer answers,
canonical enum values, hashes, decision fingerprints and original report bytes
are excluded from localizable fields.  Final reports use a separate immutable
localized artifact bound to its source artifact digest.

## 4. Development-stage classification contract

The frozen semantic claim inventory remains full-source.  A reviewed
claim-level decision captures source support, actor, modality, action, target,
stage, timing, deliverable, repository verifiability, external fulfillment,
conditions, exceptions, material context, rationale and reviewer status.

Analytical states are `DEVELOPMENT`, `NON_DEVELOPMENT`, `MIXED` and
`LEGAL_REVIEW_REQUIRED`; persisted claims remain atomic so `MIXED` is split,
not stored as a new rule-level shortcut.  No unresolved claim can activate a
Development-only packet.  The server validates the persisted review ledger and
the approved scoped packet; it does not trust a scorer or title keyword.

The seven reported scenarios require independently source-pinned review
fixtures.  Until their legal labels are independently approved they are
fixtures with `LEGAL_REVIEW_REQUIRED`, not an assertion of legal meaning.

## 5. Rule grouping taxonomy contract

Groups are a server-owned, versioned presentation taxonomy with stable IDs:
`ARCHITECTURE_SAFETY_BY_DESIGN`, `DATA_MODEL_LIFECYCLE`,
`CYBERSECURITY_TECHNICAL_CONTROLS`, `TESTING_CHANGE_ASSURANCE`,
`USER_FACING_TRANSPARENCY`, and `HUMAN_OVERSIGHT_INTERVENTION`.

Membership is versioned by rule-set version and AssessmentRule identity/version,
has exactly one primary group, optional secondary tags, ordinal, localized
labels/descriptions, rationale and source references.  It cannot alter a rule's
normative criteria or authorized audit scope.  Catalog pagination is on stable
rule membership; group totals are computed from the same pinned catalog and
each rule appears once.

The customer API returns groups, memberships and exact authorized rule IDs.
Selecting a group is resolved server-side to those exact IDs and retains all
existing rule-set, digest, repository and rule-version pins.  The UI remains a
react-hook-form consumer of the existing selected-rule flow and never
preselects rules.  Full-source accounting stays available only through the
authorized administrative path.

## 6. Migration and compatibility strategy

All database work is expand-only: add localization revisions/jobs/artifacts and
group memberships without changing canonical columns.  Existing reads remain
canonical until locale-aware projections are opted into.  Backfill runs in
idempotent batches by canonical digest and records missing legacy translations
explicitly.  Cutover requires read-model and artifact consumers to understand
`PENDING`, `READY` and `FAILED`; rollback disables the new projection without
deleting immutable revisions.

## 7. Validation and release gates

Deterministic tests cover bundle integrity, UTF-8 loading, no prompt locale
selection, job idempotency, cross-replica reads, packet validation and grouping
membership.  PostgreSQL tests cover migrations, transactions and durable
artifacts.  No paid model evaluation is run without budget authorization.

Green local/CI tests prove implementation only.  Independent translation
approval, legal reviewed gold, live-model comparison, measured token/cost
reconciliation and release acceptance remain separate gates.

## Implementation order

1. Introduce the source inventory and approved EN bundle verifier, then migrate
   every model-facing runtime path away from response-locale prompt selection.
2. Add durable localization records, outbox and locale projections with
   compatibility reads.
3. Extend the existing frozen scope ledger and activation validator with
   reviewed claim-level semantic gating and unapproved fixtures.
4. Add server-owned group memberships, catalog contract and picker composition.
5. Run focused and PostgreSQL integration suites; record external approval
   blockers without manufacturing approval records.

## Phase 1 runtime coverage inventory (current baseline)

### P1-I6 implementation checkpoint

P1-I6E/F/G follow-up: the ledger now classifies 299 local expressions (98 original
and 201 AST discoveries) against 57 VI draft sources, plus 19 framework surfaces.
No local mappings remain pending, but framework adapters remain ADAPTER_REQUIRED
and strict completion is BLOCKED. See the current machine-readable verification
report and migration ledger for exact symbols, source hashes and public override
hooks. Source registration does not imply P1-I8 runtime cutover or approval.

The machine-readable source/consumer ledger is
`deepagents/instructions/inventory.json`; details and limitations are recorded in
`lcsp-347-instruction-migration-ledger.md`. The ledger has source IDs, revisions,
exact UTF-8 byte hashes, runtime roles, consumer symbols, translation backlog and
98 baseline construction records. `validate_inventory(require_complete=True)`
rejects incomplete migration; ordinary validation checks the registered subset.
The compiler accepts this same schema and reports every missing EN candidate
before writing output. All new sources remain pending independent review.

New VI drafts cover Preparation common/discovery/authoring/direct/development,
Claim Author, continuation/resume and draft-history policies. Root/Researcher
and all nine existing VI skills are registered without semantic modification.
Existing VI tool contract/playbook maps are extracted into individual maintained
draft files; the Python runtime maps remain legacy migration inputs until the
bundle cutover. Schema field descriptions and base tool docstrings are still
unmigrated. No runtime is switched to the incomplete inventory.

The numeric history template permits only nonnegative integer draft metadata;
unknown fields, attribute access, conversions, free text and missing parameters
are rejected. Legal excerpts, user answers and tool receipts stay outside the
maintained template. LF attributes make source hashes stable across Windows
and Unix checkout. Legacy checkpoints are preserved; bundle compatibility checks
on resume are still pending runtime integration.

Remaining semantic review: legacy Direct Draft contains obsolete future-scope
statements despite the persisted approval/validator path. The VI draft makes
scope conditional on server approval. Discovery treats public-authority claims
as normative source accounting, while Direct Draft creates customer requirements;
these are distinct output layers and must not be flattened into one actor policy.
The drafts require clause-by-clause independent equivalence review, including
format examples and protocol details, before becoming approved runtime assets.

Framework boundary inspected: installed Deep Agents `subagents.py` supplies
TASK_TOOL_DESCRIPTION and fork-task preamble; task_description can be overridden.
`governed_summarization_middleware` replaces the internal summary runnable but
does not itself replace every framework-generated summary template. Filesystem,
TodoList, task schema and call-limit defaults need explicit inventory/override
work before full instruction coverage can be asserted.

| Runtime path | Current model-facing source / locale branch | Required source ID → EN entry ID | Integration point / receipt |
| --- | --- | --- | --- |
| Assessment Root system | `assessment_root/instructions.md` or `instructions.vi.md` | `assessment-root.system` → same | `create_assessment_root_agent`; prompt hash |
| Repository Researcher | `researcher.en.md` or `researcher.vi.md` | `repository-researcher.system` → same | `researcher_subagent`; prompt hash |
| Root continuation | inline `AssessmentCompletionMiddleware.after_model` EN/VI branch | `assessment-root.continuation` → same | middleware message hash |
| Root governed compaction | Root/Researcher system prompts forwarded to `governed_summarization_middleware` | `assessment-root.compaction`, `repository-researcher.compaction` → same | actual system-prompt hash |
| Root tool contracts/playbooks | `assessment_root/tool_contracts.py` EN/VI maps and `describe_tool` | one `assessment-tool.<canonical-name>` per tool | tool description hashes |
| Assessment skills | `SKILL.md` or `SKILL.vi.md` selected by `skills.py` / shared loader | one `assessment-skill.<name>` per allowlisted skill | available/selected skill hashes |
| Preparation direct | `instructions-direct.md` | `preparation.direct` → same | phase prompt hash |
| Preparation common/discovery/authoring | `instructions-common.md`, `instructions-discovery.md`, `instructions-authoring.md` | `preparation.common`, `.discovery`, `.authoring` → same | phase prompt hash |
| Development overlay | `instructions-development.md` | `preparation.development-overlay` → same | composed phase hash |
| Preparation response overlay | `instructions-localization.vi.md` conditionally appended | presentation directive belongs in approved EN entries; no model VI overlay | composed phase hash |
| Claim Author | dynamic `child_prompt` plus `child_assignment` in `rule_set_preparation/agent.py` | `claim-author.system`, `claim-author.assignment` → same | child prompt hash |
| Preparation continuation/history | inline `PreparationCompletionMiddleware`, `draft_history.py`, `authoring_recorder.py` | `preparation.continuation`, `preparation.history` → same | continuation/compaction hashes |
| Preparation skills | `SKILL.md` or `SKILL.vi.md`, plus localized catalog descriptions | one `preparation-skill.<name>` per allowlisted skill and catalog/playbook entries | available/selected skill hashes |
| Preparation tool guidance | tool docstrings and playbooks built in tools modules | one `preparation-tool.<canonical-name>` per governed tool | tool description hashes |

This inventory is deliberately a migration checklist, not an assertion that
the listed English files are generated assets today.  At baseline, several
Preparation and dynamic guidance units have no Vietnamese maintained-source
counterpart.  A production bundle cannot be approved or wired until all rows
have a stable Vietnamese source and reviewed English snapshot.

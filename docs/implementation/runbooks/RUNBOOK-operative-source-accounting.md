# Operative source accounting

## Complete downstream semantic fidelity

`legalRequirementIds` bind the child to Agent-authored parent meaning. Canonical guidance and
criterion statements include the complete actor/modality/action, conditions, qualifiers,
exceptions, operative provenance, and the directed transitive context dependency closure.
Cycles are visited once by identity. `contextRelationIds` explicitly retain inherited dependency
identities; removing or reversing a dependency cannot leave an unchanged child accepted.
`legalIntent` is rendered from parent propositions. Omit these derived fields during authoring;
supplied contradictory fields are retained and rejected with `APPLICABILITY_BINDING_MISMATCH`.

`unresolvedConditionBindings` select parent context facts by requirement ID, field
(`APPLICABILITY_CONDITION`, `QUALIFIER`, `EXCEPTION`) and zero-based index. The server renders
`unresolvedConditions` from those exact facts. No selection means no separate unresolved facts,
not unconditional applicability. The complete inherited context remains authoritative.

Preserve actor direction, polarity, action/object/scope, purpose, triggers, exceptions,
temporal/transition limits, incorporated dependencies and source bindings. A child may narrow
its technical investigation through `investigationFocus` or evidence strategy within those
anchors. It may not substitute another legal predicate. Evidence hints are not legal authority.
The Gate compares authored structure and canonical projections, never interprets raw law or
tries to prove NLP equivalence. Correct source interpretation remains the Agent's responsibility.

The permanent semantic matrix covers positive specialization/aggregation, negative semantic
mutations, historical placeholder/actor/qualifier classes, dependency cycles/order and durable
read-model round trips. `tests/semantic-fidelity-gate.mjs` exercises negative cases through the
real provider-free Completion Gate and worker HTTP API. The 12-provision synthetic fixture
`tests/fixtures/semantic-closure-source.json` requires separate one-run authorization for live
acceptance. Historical accepted contracts and digests are not rewritten; no migration is needed.

## Parent-bound assessment criteria

New AssessmentRule criteria explicitly bind `legalRequirementIds`, restricted to their rule's
parents; collectively they represent all claimed parents. Omit `statement` when authoring:
the server derives the complete parent normative predicate using the same renderer as
applicability guidance. Purpose or object restrictions embedded in an operative action are
retained along with conditions, qualifiers and exceptions. Contradictory supplied statements,
missing bindings and foreign parent IDs return `APPLICABILITY_BINDING_MISMATCH`.

Optional `investigationFocus` selects a narrower technical evidence surface without replacing
the inherited legal predicate. Several focused criteria may bind the same parent, and one
criterion may aggregate several parents. The Gate checks references and canonical rendering;
it does not infer legal importance from raw source text or interpret evidence prose. Historical
stored criterion contracts remain readable without rewriting their statements or digests.

The Agent owns legal interpretation. A resolved citation proves provenance, not representation of an operative proposition. New Rule Set authoring must supply `operativePropositions` on every LegalRequirement, including NON_ASSESSABLE non-repository duties. Each proposition declares the source's actor, modality (DUTY, PROHIBITION, PERMISSION), action with object/scope, and exact source bindings. Related propositions and multiple provisions may remain aggregated in one requirement.

The deterministic validator resolves all identities/hashes as before, but coverage is discharged only by explicit operative bindings or typed context relations attached to operative requirements. AssessmentRule citations and extra requirement citations do not independently discharge source coverage. An ancestor reference no longer automatically covers its leaf descendants. Definitions, conditions, timing, exceptions and incorporated references use the existing relation model. Incorporation into an independently operative requirement uses CROSS_REFERENCE to that target requirement and must retain its operative meaning in the Agent-authored text and assessment guidance.

New actionable gaps are OPERATIVE_PROPOSITION_REQUIRED, OPERATIVE_SOURCE_NOT_DECLARED, UNACCOUNTED_REQUIREMENT_SOURCE and UNRESOLVED_OPERATIVE_CONTEXT. Existing INCOMPLETE_SOURCE_COVERAGE now identifies exact unaccounted EFFECTIVE leaves. Existing effect-status checks remain intact; repealed provisions are not required to become current duties. No law-specific words or legal classifier are evaluated.

This contract detects missing declared operative structure and provenance-only buckets. It does not certify that an Agent's semantic interpretation or contextual classification is legally correct. Semantic acceptance remains separate from deterministic Gate acceptance.

Migration `20261016050000_rule_set_operative_propositions` adds one nullable JSONB column to LegalRequirement. Historical accepted packets, child digests and source pins are immutable and are not backfilled or revalidated under the new authoring contract. Their read models omit the field when it is null. New authoring accepts the optional wire field for actionable Gate feedback, then requires nonempty operative structure before persistence. New packets persist the structure and include it in child and packet digests.

The authoring prompt and coverage feedback require reading the provisions and repairing their operative/context representation, rather than adding citations until a counter reaches zero. Explicit submit, Completion Gate rejection/repair, NO_PROGRESS and NoProgressDetected retain their existing lifecycle.

For new authoring, AssessmentRule `legalRequirementIds` bind applicability to its parent LegalRequirements. Omit `applicabilityGuidance`: the server canonically renders each linked parent's proposition, operative actor/modality/action, conditions, qualifiers and exceptions, in stable requirement-ID order. Supplied prose must equal that rendering or validation returns APPLICABILITY_BINDING_MISMATCH. It is never silently overwritten. Investigation and evidence fields remain Agent-authored. This removes a second free-text interpretation of the parent actor and condition; it does not interpret delegation or decide which legal actor owns an obligation. The Agent must preserve duty holder, delegator, fulfillment actor, recipient and continuing responsibility in the parent where the source distinguishes them. Historical stored guidance and digests are read unchanged; no database migration or backfill is needed.

`tests/fixtures/actor-fidelity-source.json` adds an eighth synthetic provision making delegation direction and retained responsibility explicit. Its live acceptance requires its own one-run authorization. The input bootstrap accepts only the seven- or eight-provision synthetic fixture shape and refuses production database identity.

The compact synthetic fixture in `tests/fixtures/rule-set-semantic-stress.json` covers definitions, direct obligation, prohibition, conditional compensation, transition, incorporation and a limited exception. It is test material, not government authority. `tests/semantic-stress-source.mjs` prepares it through existing Legal Source application services in an explicitly isolated database; it never inserts Preparation/Rule Set rows or patches statuses with SQL. Run live semantic acceptance only with separate authorization for exactly one isolated Managed Deep Agent Preparation, after deploying and safely verifying the exact candidate.

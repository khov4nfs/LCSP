## Frozen inventory -> RULE_AUTHORING

Call start_rule_authoring after finalization (author_legal_requirement can also start it). Claims,
claim types, source bindings, relevance and relations are now immutable. The accounting denominator
cannot move during Rule authoring. Reopening is a last resort that restarts the discovery of the WHOLE law: never reopen to repair a Requirement, an AssessmentRule or a validation gap of the draft (use author_*, remove_rule_candidate and get_rule_authoring_status for those). If discovery was incomplete, use reopen_semantic_claim_inventory
with a precise reason. This increments revision and invalidates ALL downstream candidates; old frozen
revisions remain auditable. Review the returned ID remapping and re-author affected work. Never try
to bypass a claim gap by changing/discarding claims in a Rule packet.

Batch your calls. Every model turn re-sends the whole conversation, so one call per turn makes a long law unaffordable.
Page the operative anchors with get_rule_authoring_context, then in ONE assistant turn emit up to 12 author_legal_requirement calls, then up to 12
author_assessment_rule calls for the assessable ones. author_legal_requirement needs only requirement_key, title and operative_claim_ids (plus
non_repository_duty and non_assessable_reason when the performance is external): the runtime binds every applicability, qualifier, exception and
context claim of the anchor's verified closure, so do not read get_semantic_closure first and do not pass binding ids unless you must narrow them.
Continue until no anchor is unbound.

Your tool history is trimmed to keep the context small, so do not rely on remembering earlier reads. From the freeze
on, every request ends with a runtime-generated RULE AUTHORING STATE message. It is authoritative: the frozen revision,
claim counts by accounting role, your Requirements with the exact legalRequirementId of each and whether it still NEEDS an
AssessmentRule, any OUTSTANDING AUTHORING REJECTION, and an index of claimId + summary for every applicability-bearing claim
and every claim not yet bound. Select claims by the exact IDs listed there. An outstanding rejection stays listed until a
corrected call succeeds, so read its invalid fields, expected values and repair, apply its requiredAction, and resend. A
rejection means the tool did NOT change your draft. Fix exactly what it names; do not resend the same call, and do not
invent tool names (a call to a tool that does not exist, or arguments that are not valid JSON, is also rejected and listed
there). author_assessment_rule takes the exact legalRequirementId values from that list; get_rule_authoring_status pages
them together with your AssessmentRules, the unbound claims by role and the next valid actions.
Page verified operative anchors with get_rule_authoring_context (pages of at most 40). For one claim's exact statement, actor/action, relations and
provenance use get_claim_inventory(kind=CLAIMS, claim_id=...). get_claim_inventory pages hold at most 20 claims:
a larger limit is capped and reported as appliedLimit, and the reply gives hasMore and nextOffset. You do not need
to read every page before authoring.

Use author_legal_requirement with an operative anchor or compatible operative aggregation; default to ONE operative claim per Requirement and aggregate only claims with the same actor, modality, assessability and modifiers. The runtime derives every reachable binding and retains branch-local conditions with their modifiers. Inspect get_semantic_closure only when resolving a specific binding problem. Optional explicit binding lists may only use that closure; unrelated role-compatible claims are refused. Guidance never serves as an operative anchor. Definitions and context are retained by typed reachability; PRESERVES facts remain context for the duty they leave intact. The tool derives external/non-assessable coverage from the committed assessability classification.

Applicability must state the actual addressee and source conditions. Preserve source-defined criteria
and any-of/all-of alternatives exactly. An assessable Requirement needs applicability claims identifying
the actual source addressee/trigger, and only SCOPE and CONDITION claims can be that authority.

All relevant claims require valid claimBindings; NON_ASSESSABLE never excuses omission of operative
actor/modality/action or claim accounting.

Set non_repository_duty truthfully. For organizational/human/physical/external performance that cannot
be established from repository evidence, provide non_assessable_reason. A compensation policy or log
cannot substitute for actual payment or delivery; do not invent a software obligation for an external
duty. The tool derives the exact coverage state; do not manually invent state values.

The runtime projects directed Requirement dependencies from your frozen claim relations and actual
claim bindings. Bind context/definition claims to the operative Requirement they affect; do not create
standalone placeholder Requirements for contextual text. Use get_claim_inventory(REQUIREMENTS) to
inspect exact candidates and UNACCOUNTED_CLAIMS to find remaining bindings. Correct a Requirement by
calling author_legal_requirement again with the same requirement_key and the full intended selection.

Use author_assessment_rule with existing assessable legal_requirement_ids. The API derives legalIntent,
applicability guidance, criteria and required evidence from those exact parent semantics. In the derived
criteria, every parent must be represented. Every criterion needs evidenceBindings; the tool supplies
these bindings so evidence requests demonstrate the linked criterion without introducing duties. Optional
investigation_focus may narrow an evidence search; it is a non-normative suggestion, never a new
mandatory capability or replacement predicate. A conditional permission does not imply automatic
blocking/unblocking or a particular technical implementation absent from the source. Evidence asks
for proof of linked legal semantics; it must not create shadow law. Correct an AssessmentRule by
calling the same typed tool with its existing assessment_rule_id. Remove a mistaken downstream candidate
with remove_rule_candidate and a reason; it invalidates dependent candidates without changing claims.

## RULE_VALIDATION -> SUBMISSION_READY -> COMPLETION

Call validate_compliance_rule_set with no packet argument. It validates the current candidates against
the exact frozen revision, returning grouped actionable gaps. Accounting is computed from bindings;
you do not declare coverage complete. UNACCOUNTED_SEMANTIC_CLAIM identifies the missing claim. Inspect
that claim/source and fix its Requirement role or dependency. Stale revision feedback requires the
current revision, never silent cross-revision accounting. The inventory need not be re-finalized for
an ordinary Requirement correction.

A passing Rule validation enters SUBMISSION_READY. Then explicitly call submit_compliance_rule_set
with no packet argument once for the exact validated draft. This is the governed completion action;
normal assistant prose is not submission. Do not send enormous free-form graphs or replacement packets.

Repeated ineffective inventory or Rule validation receives NO_PROGRESS feedback. Repeating the same
effective state/gaps after that feedback terminates the run. Source reads or cosmetic bookkeeping do
not reset phase validation convergence. Resolve a concrete gap, change strategy meaningfully, or reopen
inventory explicitly when justified. Configured run quotas pause execution without discarding committed discovery.

Record concise established source facts and material unresolved work with record_preparation_progress;
never include private reasoning. report_rule_set_source_blocked is only for truly unreadable pinned
source or inconsistent pins, with its exact /legal-source path; unfinished work, ambiguity and
validation errors are not source-blocking reasons. Chunks, inspected nodes and accounted semantic
claims remain separate observability measures. Only complete valid claim accounting permits completion.

# Live acceptance criteria (pre-registered before the single new disposable is dispatched)

The deterministic replay proves the pipeline. It does NOT prove the live model will write SCOPE/CONDITION claims:
the replay supplied the six omitted claims by script. The live run is the only test of that behavior, and only one run is authorized.
Outcomes are therefore fixed here, before dispatch, and are not reinterpreted afterwards.

| Observation | Verdict |
|---|---|
| Discovery writes SCOPE/CONDITION claims unprompted, freezes once, authors, real Rule Validator PASS, Completion Gate ACCEPTED, Preparation SUCCEEDED, semantic 19/19 | ACCEPTED |
| Finalize is refused with APPLICABILITY_AUTHORITY_MISSING / OPERATIVE_CLAIM_MISSING, the Agent reopens the owning unit(s), registers the claims, finalizes (still exactly ONE frozen revision: a refusal freezes nothing), then everything above holds | ACCEPTED. Recorded as "readiness gate engaged and recovered": the fix working as designed |
| Finalize is refused and the run ends without a successful freeze (NoProgressDetected or any terminal failure) | NOT_ACCEPTED. Boundary CLAIM_AUTHORING (discovery omitted applicability and did not repair it on actionable feedback). The gate is not the defect. DETERMINISTIC_COVERAGE is INADEQUATE only if the failing state is one the repair-flow tests should have caught |
| Mechanical success but a SCOPE/CONDITION claim is mis-typed, absent where the source states a trigger, or a trigger is left only inside a DUTY | Mechanical success is not acceptance: semantic review decides; fewer than 19/19 is NOT_ACCEPTED (boundary DOWNSTREAM_FIDELITY or AGENT_REASONING). The gate checks claim types, never prose |
| Any other terminal failure | NOT_ACCEPTED with exactly one boundary from the task's list |

Counting rules: Rule Validator attempts = RULE_VALIDATION_STARTED events. Tool rejections (CLAIM_DISCOVERY_TOOL_REJECTED,
CLAIM_INVENTORY_READ_REJECTED, RULE_AUTHORING_TOOL_REJECTED) are reported separately and are never validator attempts.

No second disposable, no retry, no patch-and-retry in any case. A NOT_ACCEPTED verdict ends the task.

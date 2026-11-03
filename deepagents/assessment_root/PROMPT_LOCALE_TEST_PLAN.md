# EN/VI assessment prompt runtime verification

Canonical business logic is language-invariant. The assessment API owns responseLanguage
(or locale); the current run context is normalized to en/vi (default vi) BEFORE graph
construction. Root and Researcher system prompts, skill selection, tool guidance,
continuation instructions and governed summarization prompts must use the SAME locale.
This is actual prompt selection, not merely translating the final user-visible text.

## Prompt resources

| Component | en | vi |
| --- | --- | --- |
| Assessment Root | instructions.md | instructions.vi.md |
| Repository Researcher | researcher.en.md | researcher.vi.md |
| Each of five skills | SKILL.md | SKILL.vi.md |
| Tool contract guidance | CONTRACTS / GRAPH_CONTRACTS | CONTRACTS_VI / GRAPH_CONTRACTS_VI |

The source-control hash of the selected skill instructions is included in the governed
skill usage result. Missing language resources must fail visibly instead of quietly
downgrading to another language. The canonical tool API schema, enums, IDs, criteria
and legal sources are NEVER translated. When operator locale changes on a new
execution of the same server thread, prompts are selected again from the persisted
context; accepted facts and decisions remain language-neutral.

## Quality gates

1. Run provider-free test_assessment_prompt_locales.py and existing Assessment Root
   and localization regressions.
2. Confirm EN and VI carry identical machine-keyed legal and lifecycle invariants.
3. Confirm Root and researcher system prompts and compaction receive the same locale.
4. Verify skills and tool-contract notes are selected by locale, without leaking
   legal authority, making new decisions or granting source write access.
5. Run model-based EN/VI parity evaluation across multiple pinned repositories with
   positive/negative controls; compare applicability, outcomes, evidence source IDs,
   HITL anchoring and selected scope. Do not declare semantic parity from static tests.

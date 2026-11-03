# LCSP Assessment Prompt Architecture

Assessment Root remains the only legal decision agent. The repository researcher
is read-only, and no coding agent is introduced.

## Stable authority separation
- Pinned effective legal provisions: source of legal duties and criteria.
- Accepted customer facts: operator practices, deployment and external policies.
- Pinned source citations: bounded technical implementation observations.
- Optional skills and graph queries: research aids, NEVER legal authority.
- Completion Gate: server-owned request completion and lifecycle checks.

## Skill routing
Call list_assessment_skills only after source reconnaissance. Use
load_assessment_skill for an allowlisted method when an observed capability and
selected criterion both justify it. The checked-in content has a SHA-256.
Five generic skills address system boundaries, automated outcomes, model
inference, data lifecycle, and technical control/claim verification.

Do not add one prompt or skill per new repository or discovered bug. Add
generalizable skills only after cross-repository regression evidence.

## Model-facing tool details
The tool_contracts module appends purpose, authority limits, and failure
conditions to existing tool descriptions without changing schemas or backend
permissions. Legal facts and code facts cannot substitute for each other.

## Evaluation protocol
Static tests prove wiring and guards only, not semantic correctness. Evaluate
multiple pinned repositories using positive and negative controls: no ML,
adversarial README, missing external governance, false legal scope, automated
decisions, model mapping and retrieval gaps. Compare applicability correctness,
criterion coverage, evidence line precision, over-questioning, false positives
and token cost before promotion. Never release based solely on prompt length
or a green structural test. No production deployment is included.


## English / Vietnamese prompt versions

Assessment Root chooses language from the server-authoritative assessment responseLanguage
(or locale) using resolve_response_language. English is stored at
assessment_root/instructions.md (kept for backwards compatibility); Vietnamese
at assessment_root/instructions.vi.md. Both encode identical governance, legal
authority, selected-scope rules, human resolution and Completion Gate contracts.
Default locale is vi. The Root's resumed native continuation and compaction
system prompt use the same language.

Repository researcher uses researcher.en.md / researcher.vi.md. The read-only
researcher and its own compaction are constructed using the Root's normalized locale;
it never has access to governed decision tools. All five checked-in skills have
SKILL.md (en) and SKILL.vi.md (vi), selected on trusted run locale, with fail-closed
missing-file handling and content hashes. list_assessment_skills and the additional
tool authority notes are also localized, while canonical tool names, JSON keys,
legal statuses, evidence IDs and enums always remain unchanged.
Runtime locale selection is NOT based on language guessed from repository text.

The localized-contents regression suite checks presence and matching legal invariants
in both language packs, build-time prompt selection, skill and graph tool binding,
and stable canonical domain enum identifiers. Provider-free tests are not evidence
of semantic equivalence in a live multi-repository assessment.

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

# Agentic Evidence Tool Implementation Tasks

This directory turns the capability targets in `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md` into implementation-ready task cards. Every card uses [the agentic tool task template](../../../templates/agentic-tool-implementation-task-template.md), which extends the standard [implementation task template](../../../templates/implementation-task-template.md).

Every packet also inherits the executable [shared tool contract](shared-tool-contract.md): request/response envelope, RBAC preflight, immutable artifact pinning, LLM context boundary, audit, privacy, status/error mapping, and definition of done.

## Ownership and Completion Rule

- Tools are worker-owned schema-validated capabilities. API code owns RBAC, audit, trusted trigger, and artifact-persistence boundaries; it does not reimplement tool logic.
- A tool is not complete until its typed request/response contract, safe failure behavior, provenance/coverage/evidence refs, result bounds, and task-specific tests pass.
- A tool task may reuse existing scanner task documentation. Do not create a duplicate implementation path for the same analyzer.

## Catalog-to-Task Map

| Catalog family | Task guide | Story |
|---|---|---|
| Mandatory baseline | [baseline-scanner-tools.md](baseline-scanner-tools.md) | AO-1 |
| Technical evidence queries | [technical-evidence-query-tools.md](technical-evidence-query-tools.md) | AO-2 |
| Artifact, Wizard, conflict | [artifact-wizard-conflict-tools.md](artifact-wizard-conflict-tools.md) | AO-3, AO-4 |
| Legal classification and gap | [legal-classification-gap-tools.md](legal-classification-gap-tools.md) | AO-3, AO-5 |
| Admin-managed corpus recovery | [legal-corpus-recovery-tools.md](legal-corpus-recovery-tools.md) | AO-3, AO-6 |

## Per-tool Packet Migration

The family guides are discovery/migration maps. Canonical build artifacts are the 52 one-file-per-capability packets in `packets/`, each based on the v2 template and the shared tool contract. A packet may move to `READY_FOR_SPRINT` only after its named open decisions are resolved and its referenced implementation/test work is ready.

| Story / family | Packet range |
|---|---|
| AO-1 mandatory scanner baseline | `ao-1-01` through `ao-1-11` |
| AO-2 evidence query and reanalysis | `ao-2-01` through `ao-2-13` |
| AO-4 Artifact, Wizard, and conflict | `ao-4-01` through `ao-4-06` |
| AO-5 legal classification and gap | `ao-5-01` through `ao-5-10` |
| AO-6 admin-managed corpus recovery | `ao-6-01` through `ao-6-12` |

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/specs/spec-agentic-evidence-orchestration/SPEC.md`
- `docs/specs/spec-agentic-evidence-orchestration/orchestration-state-machine.md`
- The AO artifact named in each task card.

---
status: ACTIVE_PLANNING_AUTHORITY
artifact_type: implementation_decision
decision_id: DEC-PBAC-RUNTIME-001
owner: Platform
resolves:
  - PBAC_ENGINE_POLICY_STORAGE_CACHE_INVALIDATION_EVALUATION_FAILURE_BEHAVIOR
---

# PBAC Runtime Decision

## Decision

LCSP MVP uses an application-owned PBAC evaluator in the NestJS API and Python Worker Platform. Role labels such as `Manager` and `Developer` are subject attributes or policy templates only; they are not authorization authority.

Every protected user or service action must evaluate:

```text
subject + organization + resource + action + runtime context + policy version + state gate
```

The default result is deny. Missing policy, missing attributes, stale policy version, cache failure, evaluator failure, or unavailable state gate is deny-by-default unless the route is explicitly classified as public unauthenticated access.

## Policy Storage

| Object                | Store      | Owner                   | Mutability                           |
| --------------------- | ---------- | ----------------------- | ------------------------------------ |
| Policy template       | PostgreSQL | Platform                | versioned append/update by migration |
| Policy assignment     | PostgreSQL | Platform                | append/update with audit             |
| Subject attributes    | PostgreSQL | Organization / Platform | mutable with audit                   |
| Policy decision audit | AuditEvent | Platform                | append-only                          |

Policy records must include `policy_id`, `policy_version`, `scope_type`, `scope_id`, `effect`, `actions`, `resource_constraints`, `subject_constraints`, `state_constraints`, `created_at`, and `activated_at`.

## Evaluation Topology

| Boundary                  | Evaluator location                      | Required behavior                                |
| ------------------------- | --------------------------------------- | ------------------------------------------------ |
| Web UI                    | Backend-projected capabilities only     | UI hints are non-authoritative                   |
| Public API                | NestJS guard + domain service recheck   | server-side deny-by-default                      |
| Internal API              | NestJS guard + service principal policy | service identity must be scoped                  |
| Worker command            | Python worker preflight                 | command principal and aggregate scope must match |
| Worker result application | NestJS or persistence-side handler      | state transition guard rechecked before commit   |
| Artifact download/export  | API guard at request time               | revocation after generation blocks download      |

## Cache and Invalidation

- API may cache compiled policy decisions for one request only.
- API may cache policy documents by `policy_id:policy_version` for up to 5 minutes.
- Assignment and subject-attribute changes must invalidate organization-scope cache keys.
- Worker commands must carry policy decision references for audit, but workers must recheck current service permission and aggregate scope before state mutation.
- A revoked Developer scope blocks new actions immediately at API boundary and blocks stale worker commands during worker preflight.

## Failure Behavior

| Failure                    | Decision | User/operator signal            | Audit                                 |
| -------------------------- | -------- | ------------------------------- | ------------------------------------- |
| policy store unavailable   | deny     | `AUTHZ_POLICY_UNAVAILABLE`      | denied PBAC event                     |
| policy version unknown     | deny     | `AUTHZ_POLICY_VERSION_UNKNOWN`  | denied PBAC event                     |
| subject attributes missing | deny     | `AUTHZ_SUBJECT_INCOMPLETE`      | denied PBAC event                     |
| organization mismatch      | deny     | `AUTHZ_TENANT_SCOPE_MISMATCH`   | denied PBAC event                     |
| resource scope mismatch    | deny     | `AUTHZ_RESOURCE_SCOPE_MISMATCH` | denied PBAC event                     |
| state gate not satisfied   | deny     | `AUTHZ_STATE_GATE_BLOCKED`      | state-gate denied event               |
| evaluator exception        | deny     | `AUTHZ_EVALUATOR_FAILURE`       | denied PBAC event with correlation ID |

## Audit Contract

Every material allow or deny must write or link an AuditEvent with:

- `actor_type`, `actor_id` or `service_principal`;
- `organization_id`;
- `resource_type`, `resource_id`;
- `action`;
- `decision`;
- `reason_code`;
- `policy_id`, `policy_version`;
- `state_before`, `state_after` when safe;
- `correlationId`;
- safe context refs only.

## Acceptance Evidence

| Requirement | Required evidence                                                            |
| ----------- | ---------------------------------------------------------------------------- |
| NFR-008     | API and worker authorization negative tests for every protected action class |
| NFR-009     | revoked Developer scope blocks read/action/download paths                    |
| FR-012      | Developer cannot perform Manager-only actions server-side                    |
| FR-043      | audit export redacts policy internals and secrets                            |

## Implementation References

- `docs/implementation/backend-implementation.md`
- `docs/implementation/tasks/modules/platform/pbac/02-evaluator-service.md`
- `docs/specs/domain-state-machines.md`
- `docs/specs/event-catalog.md`

```text
PBAC_RUNTIME_DECISION_RESOLVED
DENY_BY_DEFAULT_REQUIRED
POLICY_VERSION_AUDIT_REQUIRED
ROLE_LABELS_NOT_AUTHORITY
```

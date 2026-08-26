---
template: implementation-task
version: 0.1.0
status: ACTIVE_TEMPLATE
owner: LCSP Engineering
---

# Implementation Task Template

## Purpose

Use this template for one build task with one primary owner and one clear deliverable. A task may reference several files or services, but it must have a single accountable runtime/domain owner.

This template is for implementation planning and engineering handoff. It does not authorize implementation before readiness and sprint planning gates are satisfied.

## Task Metadata

| Field | Value |
|---|---|
| Task ID | `TASK-<epic-or-wave>-<sequence>-<slug>` |
| Status | `TODO` / `READY_FOR_PLANNING` / `READY_FOR_SPRINT` / `IN_PROGRESS` / `DONE` / `BLOCKED` |
| Epic / Story | |
| Priority | `P0` / `P1` / `P2` |
| Primary owner | |
| Supporting owners | |
| Runtime | `nestjs-api` / `deepagents` / `scanner-subprocess` / `migration` / `documentation` |
| Target wave | |
| Source authority | Active docs only; never `docs/archive/**` or redirect-only files |

## Source Authority

List only active authority documents.

| Authority type | Document / section |
|---|---|
| Product | |
| UC / FR / AC / NFR / BR | |
| ADR / Architecture | |
| Specs | |
| Implementation docs | |
| UX / story / traceability | |

## Outcome

Describe the user-visible or system-visible outcome in one short paragraph.

## Scope

- 

## Non-Goals

- 

## Architecture Boundary

| Boundary | Decision |
|---|---|
| Runtime owner | |
| Data owner | |
| Producer | |
| Consumer | |
| Synchronous surface | |
| Asynchronous surface | |
| Superseded behavior | |

## Integration Contracts

### API Contract

| Route / operation | Request | Response | Authz | Error states |
|---|---|---|---|---|
| | | | | |

### Command / Event Contract

| Direction | Name | Producer | Consumer | Payload ref | Idempotency key | Retry / DLQ |
|---|---|---|---|---|---|---|
| command | | | | | | |
| event | | | | | | |

### Data / Artifact Contract

| Object | Store | Owner | Versioning | Retention | Audit link |
|---|---|---|---|---|---|
| | | | | | |

### Security / RBAC / Audit Contract

| Requirement | Contract |
|---|---|
| RBAC decision point | |
| Tenant / organization scope | |
| Secret handling | |
| Raw source handling | |
| Audit events | |
| Redaction | |

## Implementation Steps

1. 

## Verification Intent

Execution of tests may be deferred by project direction, but every task must describe intended verification.

| AC / requirement | Verification level | Evidence expected |
|---|---|---|
| | API / worker / authz / error / UI / doc-only | |

## Failure and Recovery Behavior

| Failure | Expected behavior | User/operator signal | Audit/event |
|---|---|---|---|
| | fail closed / retry / block / degrade | | |

## Rollback / Backout

- 

## Definition of Done

- Source authority refs are active and current.
- Scope and non-goals are explicit.
- All changed integration contracts are documented.
- Failure behavior is documented.
- Verification intent is mapped to requirements.
- Removed/superseded concepts are not reintroduced.

## Open Decisions

| Decision | Status | Blocks readiness? |
|---|---|---|
| | `OPEN` / `CARRIED_FORWARD` / `RESOLVED` | `yes` / `no` |

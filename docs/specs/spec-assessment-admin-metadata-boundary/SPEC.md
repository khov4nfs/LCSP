---
id: SPEC-assessment-admin-metadata-boundary
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete contract for Prompt 2 / ASM-23 and ASM-ADMIN-01..04.

# Assessment ADMIN Metadata-Only Boundary

## Why

The shared assessment read surfaces currently deny useful ADMIN metadata while other endpoints expose customer-owned provenance and runtime content. The read boundary must become consistent: CUSTOMER owns content reads, while ADMIN receives only the operational metadata required for support.

## Capabilities

- **CAP-1**
  - **intent:** CUSTOMER can list and open only assessments they own using the existing customer content projection.
  - **success:** The first persistence predicate includes both assessment and owner identity, and foreign content never enters application memory.
- **CAP-2**
  - **intent:** ADMIN can list and open assessment operational metadata without impersonating the owner.
  - **success:** ADMIN responses contain only assessment ID, owner ID, name, lifecycle state, execution state, timestamps and correlation metadata; their queries do not hydrate customer-content relations.
- **CAP-3**
  - **intent:** Customer-owned provenance and content-rich runtime event surfaces exclude ADMIN.
  - **success:** RBAC metadata for both controllers permits CUSTOMER only, while dedicated admin operational endpoints remain unchanged.

## Constraints

- Authorization remains RBAC-only with `CUSTOMER` and `ADMIN`; no PBAC or organization model may be introduced.
- ADMIN metadata permission must not grant mutation, provenance, case, evidence, report or customer runtime-event access.
- Shared contracts must use strict schemas and preserve the existing CUSTOMER wire shapes.
- Valid RED expectations may be strengthened for exact data minimization but may not be weakened or skipped.

## Non-goals

- Adding new ADMIN mutation authority.
- Replacing the dedicated compliance-rule-set preparation activity endpoint.
- Refactoring unrelated assessment reports, audits, billing or runtime-control behavior.

## Success signal

ASM-ADMIN-01..04 and adjacent customer-isolation tests pass, the ADMIN persistence calls select only approved scalar fields, and typecheck plus architecture, import, contract and business-documentation gates remain green.

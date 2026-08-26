---
task_id: MW-auth-016
module: auth-workspace
runtime: nestjs-api
priority: P0
status: RETIRED
epic_story: 1.5
depends_on: []
---

# Retired: Developer Scoped Workspace Context Endpoint

The Developer scoped workspace context endpoint is retired from the active MVP.

No active BFF/API/client code should expose Developer task context. Workspace context is Manager-owned, with non-Manager access denied or narrowed only by future explicitly approved RBAC contracts.

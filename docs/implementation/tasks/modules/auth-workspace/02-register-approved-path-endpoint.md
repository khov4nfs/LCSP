---
task_id: MW-auth-002
module: auth-workspace
runtime: nestjs-api
priority: P0
status: RETIRED
epic_story: 1.1
depends_on: []
---

# Retired: Register Approved Path Endpoint

`POST /auth/register-approved-path` has been removed from the active LCSP runtime.

The active account path is self-signup plus Manager-owned workspace creation. Developer invitation acceptance no longer exists, and `AuthInvitation` is no longer a Prisma model/table.

Historical audit resource values may still contain `AUTH_INVITATION` for old records only.

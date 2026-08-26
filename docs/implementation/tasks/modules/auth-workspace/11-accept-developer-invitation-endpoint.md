---
task_id: MW-auth-011
module: auth-workspace
runtime: nestjs-api
priority: P0
status: RETIRED
epic_story: 1.5
depends_on: []
---

# Retired: Accept Developer Invitation Endpoint

`POST /auth/accept-invitation` is removed from the active runtime.

Self-signup is the active public account creation path. The retired invitation flow must not be used to create users, memberships, sessions, policies, or task workspaces.

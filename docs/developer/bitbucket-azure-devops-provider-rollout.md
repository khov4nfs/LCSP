# Bitbucket and Azure DevOps provider rollout

Bitbucket Cloud and Azure DevOps Services use native REST adapters. They remain
disabled by default. GitHub and GitLab keep their existing CLI integrations.

## Controlled provider activation

Apply the `provider_credential_external_identity` migration to the selected
database before starting an application configured with the schema-ready flag.
Verify the migration status and the external identity columns on that same
database; a flag does not apply or verify a migration.

Provider activation is off by default in every environment. After the migration is
applied to the application database and the required acceptance and release gates
are satisfied, deployment configuration may explicitly enable either or both REST
providers. The API verifies the external-identity columns and identity constraint
in the active database at startup; the schema-ready setting is an additional
operator assertion and does not replace that database check.

For a controlled acceptance deployment, set:

```env
BITBUCKET_REST_ENABLED=true
AZURE_DEVOPS_REST_ENABLED=true
PROVIDER_CREDENTIAL_EXTERNAL_IDENTITY_SCHEMA_READY=true
```

Use Bitbucket credentials consisting of the Atlassian account email and a user
API Token with only `read:user:bitbucket`, `read:workspace:bitbucket`, and
`read:repository:bitbucket`. Use an Azure DevOps organization-scoped PAT with
Code (Read). Do not send credentials to the Agent runtime.

Run the real-provider acceptance scenarios for authentication, repository GUID
and organization binding, immutable commit pinning, archive root and source
integrity, workspace hydration, evidence links, Assessment rerun, and GitHub /
GitLab regression before considering production activation.

Bitbucket archive delivery accepts only the exact wrapper name from the trusted
Bitbucket `Content-Disposition` response when it matches the workspace, repository
slug, and pinned commit prefix. The checked convention matched public Bitbucket
Cloud samples; verify it again against the authorized private acceptance
repository. Azure's REST documentation specifies ZIP output but does not specify
the archive root layout. Azure archives therefore remain fail-closed until the
root is verified from an authorized archive and pinned repository metadata. A
missing root is not evidence that an archive is rootless.

## Deployment order

1. Apply the migration to the intended database. It preserves numeric GitHub
   and GitLab identities and invalidates legacy Bitbucket/Azure credential
   rows that do not contain a verified external identity. Do not roll back the
   schema after saving external identities; those identities cannot be
   losslessly represented by the previous numeric column.
2. Deploy compatible API, Web, and Agent versions with Bitbucket and Azure
   disabled. Confirm the application starts against the migrated schema and
   its health checks pass.
3. Complete the mandatory real-provider, source-integrity, Assessment, evidence,
   regression, and production-equivalent runtime acceptance gates.
4. After release authorization, set the provider-specific REST flag and schema
   assertion through the deployment's approved configuration process. The
   runtime database check must also pass before customer operations are enabled.

The API does not use `NODE_ENV` as an activation override. Explicit flags are
still required, default to false, and are enforced server-side along with the
database schema check. Do not set production flags before release authorization.

# Security Policy

## Supported versions

LCSP does not publish a formal version support matrix. Security fixes are applied to the actively maintained `develop` and date-based release line. Older commits and package metadata versions are not separate supported product versions.

## Reporting a vulnerability

The repository does not publish a security email address or dedicated intake process. A private maintainer contact is required. Do not post vulnerability details, exploit steps, credentials, or customer data in a public issue. Include the affected component, impact, and a minimal reproduction when contacting a maintainer privately.

## Scope

Security reports may concern:

- authentication, session handling, authorization, and Admin operations;
- legal-source and Compliance Rule Set access or provenance;
- repository connections, tokens, snapshots, and evidence handling;
- provider credentials, model routing, and usage attribution;
- the internal Agent Runtime, checkpoints, cancellation, and activity/event transport;
- API and database access, migrations, logging, and production configuration.

Third-party model providers, identity providers, repository hosts, payment services, and hosting infrastructure are outside LCSP's control. Reports about them should explain the LCSP integration impact without sending third-party secrets.

## Secret management

Provider keys and deployment credentials are supplied through environment-managed secrets and must never be committed. Raw credentials must not appear in logs, activity streams, issue reports, or release artifacts. Operational logs may use request identifiers and non-secret credential fingerprints.

Supported provider credential names include `APX_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, and `INCEPTION_API_KEY`. A comma-separated `APX_API_KEY` pool is secret material: treat every slot and the complete value as credentials, not safe configuration. Repository tokens, OAuth secrets, encryption keys, webhook secrets, database URLs, and worker keys are also secret material.

## Proxy-provider security model

Canonical provider identity and transport protocol are separate. A route can select `provider: apx` with either `protocol: anthropic` or `protocol: openai`. The canonical provider determines credential authority and usage identity; the protocol selects the client family. An APX route always uses `APX_API_KEY`. Selecting an Anthropic or OpenAI client family for APX must never switch it to `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. Direct Anthropic, OpenAI, Google GenAI, and Inception routes retain their own credential sources.

## Model-route trust boundary

[`deepagents/config/model_routes.yaml`](deepagents/config/model_routes.yaml) is trusted, source-controlled runtime routing configuration. Its route-level `provider`, `protocol`, and `model` fields define trusted model identity; validated `options` contain inference settings only. The route validator rejects unknown route fields and disallowed credential, endpoint, and header-like option keys. User input and model output are not routing configuration and must not supply provider credentials or endpoints.

## Credential rotation and fallback

For an APX pool, LCSP selects one key per request. Permanent allowance exhaustion retires only the affected slot; transient rate limits use cooldown handling. Provider fallback follows same-provider credential handling and uses the configured route chain, currently APX to Google GenAI to Inception. SDK clients receive an individual key, not the comma-separated pool. Logs may contain provider, model, protocol, request identifiers, and safe fingerprints, but never raw key values.

## Agent Runtime safety

The Agent Runtime is an internal service. Agents and models perform semantic reasoning; the API and domain layer own persisted lifecycle state, authorization, validation, and privileged transitions. Stop and cancellation requests are checked against persisted execution state, checkpoints are bound to server-owned run identity, and runtime events are validated before they are projected to activity views.

These controls do not make model output authoritative, and LCSP does not claim isolation or sandbox guarantees beyond the permissions and execution boundaries implemented in the current code.

## Authorization and repository integrations

Admin-only operations are authorized by the server. Browser state and identifiers supplied by a client do not grant authority; the API resolves them against canonical persisted state and the authenticated request context.

Repository access should use least-privilege credentials. Integration tokens must not be logged. Fetched repository content is untrusted evidence input, not executable control. Repository evidence and provider credentials are separate trust domains.

## Legal-source and source-version integrity

Legal Source Versions, pinned source inputs, and rule-set/assessment references support provenance across preparation and assessment. Historical source references must not be silently replaced. These application-level references do not constitute a cryptographic integrity guarantee or a legal correctness guarantee.

## Database and migrations

Prisma migrations are source-controlled. Do not rewrite historical applied migrations or place credentials in migration files. Production schema changes must use the reviewed migration workflow; manual production data changes are exceptional and must be auditable. A rollback plan must account for destructive operations and retained data before a migration is applied.

## Logging and observability

Logs may contain technical metadata, provider/model/protocol identity, correlation identifiers, and safe credential fingerprints. Raw secrets must never be emitted. Operator-visible logs and Agent Stream activity must remain sanitized and must not contain credential material.

## Production deployment and dependencies

Deploy from reviewed, merged source and verify the exact target SHA. Keep secrets outside Git and scope service restarts to the affected release. Do not modify shared infrastructure or other tenants as part of an LCSP release. `pnpm-lock.yaml` and `deepagents/uv.lock` are the dependency authorities; review dependency changes and require the repository's CI checks before merge. LCSP does not claim formal SBOM, artifact-signing, or SLSA controls.

## Security limitations

LCSP assists compliance assessment; it is not a legal authority or certification service. Model output can be incorrect and requires application validation and human review. Provider availability and quota are external. Legal-source and repository content are untrusted inputs and must be interpreted within the application's validated lifecycle.

For the current migration and production verification status, see the [release report](reports/releases/2026-10-14-production-release.md).
